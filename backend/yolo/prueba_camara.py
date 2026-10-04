"""Deteccion local en vivo. Presiona q en la ventana para salir. No guarda archivos."""

from collections import Counter
from pathlib import Path
from time import perf_counter

import cv2
from ultralytics import YOLO


MODEL_PATH = Path(__file__).resolve().parent / "yolo26n.pt"
WINDOW = "Eagle Gaming - YOLO - presiona q para salir"


def open_camera():
    # Abrir source=0; probar exclusivamente source=1 si no entrega imagen.
    for source in (0, 1):
        print(f"Intentando camara source={source}...", flush=True)
        capture = cv2.VideoCapture(source)
        if capture.isOpened():
            ok, frame = capture.read()
            if ok and frame is not None:
                print(f"Camara abierta: source={source}", flush=True)
                return capture, source, frame
        capture.release()
        print(f"Camara source={source} no disponible o sin fotogramas.", flush=True)
    raise RuntimeError(
        "No se pudo obtener imagen con source=0 ni source=1. "
        "Comprueba si Windows solicita permiso de camara o si otra aplicacion la esta usando."
    )


def main():
    if not MODEL_PATH.is_file():
        raise FileNotFoundError(f"Falta el modelo local: {MODEL_PATH}")
    model = YOLO(str(MODEL_PATH))
    capture = None
    frames = 0
    inference_ms = 0.0
    confidence_ranges = {}
    previous_counts = None
    count_changes = 0
    previous_boxes = None
    box_changes = 0
    reason = "error"
    started = None
    try:
        capture, source, frame = open_camera()
        cv2.namedWindow(WINDOW, cv2.WINDOW_NORMAL)
        print("Ventana lista. Mueve objetos frente a la camara y pulsa q en la ventana para cerrar.", flush=True)
        started = perf_counter()
        last_report = started
        while True:
            result = model.predict(
                source=frame, device="cpu", conf=0.25,
                save=False, save_txt=False, save_crop=False,
                show=False, verbose=False,
            )[0]
            frames += 1
            inference_ms += result.speed["inference"]
            detections = []
            counts = Counter()
            for box in result.boxes:
                label = result.names[int(box.cls.item())]
                confidence = float(box.conf.item()) * 100
                counts[label] += 1
                detections.append(f"{label} {confidence:.1f}%")
                low, high = confidence_ranges.get(label, (confidence, confidence))
                confidence_ranges[label] = (min(low, confidence), max(high, confidence))
            boxes = tuple(tuple(round(value, 1) for value in row) for row in result.boxes.xyxy.tolist())
            if previous_counts is not None and counts != previous_counts:
                count_changes += 1
            if previous_boxes is not None and boxes != previous_boxes:
                box_changes += 1
            previous_counts, previous_boxes = counts, boxes
            rendered = result.plot(labels=True, conf=True)
            cv2.imshow(WINDOW, rendered)
            now = perf_counter()
            if frames == 1 or now - last_report >= 3:
                print(
                    f"Fotograma {frames} | {', '.join(detections) or 'sin detecciones'} | "
                    f"inferencia {result.speed['inference']:.1f} ms | "
                    f"promedio {frames / (now - started):.1f} FPS",
                    flush=True,
                )
                last_report = now
            key = cv2.waitKey(1) & 0xFF
            if key == ord("q"):
                reason = "tecla q"
                break
            if cv2.getWindowProperty(WINDOW, cv2.WND_PROP_VISIBLE) < 1:
                reason = "cierre manual de ventana"
                break
            ok, frame = capture.read()
            if not ok or frame is None:
                raise RuntimeError("La camara dejo de entregar fotogramas.")
    except KeyboardInterrupt:
        reason = "interrupcion de terminal"
    finally:
        if capture is not None:
            capture.release()
        cv2.destroyAllWindows()
        print(f"Cierre: {reason}. Camara liberada y ventanas cerradas.", flush=True)
        if frames and started is not None:
            elapsed = perf_counter() - started
            print(f"Fotogramas procesados: {frames}; FPS promedio: {frames / elapsed:.2f}", flush=True)
            print(f"Inferencia media: {inference_ms / frames:.2f} ms", flush=True)
            print(f"Cambios de clases/cantidades: {count_changes}; cambios de cuadros: {box_changes}", flush=True)
            for label, (low, high) in sorted(confidence_ranges.items()):
                print(f"Clase observada: {label}; confianza {low:.1f}%-{high:.1f}%", flush=True)


if __name__ == "__main__":
    main()