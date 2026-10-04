"""Prueba de deteccion: YOLO preentrenado, una imagen local y CPU."""

import os
from pathlib import Path

from ultralytics import YOLO


BASE_DIR = Path(__file__).resolve().parent
IMAGE_PATH = BASE_DIR / "prueba1.jpeg"
MODEL_NAME = "yolo26n.pt"


def main():
    # Mantener las descargas y los resultados dentro de backend/yolo.
    os.chdir(BASE_DIR)
    model = YOLO(str(BASE_DIR / MODEL_NAME))
    results = model.predict(
        source=str(IMAGE_PATH),
        device="cpu",
        imgsz=640,
        conf=0.25,
        save=True,
        show=False,
        show_labels=True,
        show_conf=True,
        project=str(BASE_DIR / "runs" / "detect"),
        name="prueba1",
        exist_ok=False,
    )

    for result in results:
        print(f"\nModelo: {MODEL_NAME}")
        print(f"Objetos detectados: {len(result.boxes)}")
        for box in result.boxes:
            label = result.names[int(box.cls.item())]
            confidence = float(box.conf.item()) * 100
            print(f"  {label}: {confidence:.1f}%")
        print(f"Tiempo de inferencia: {result.speed['inference']:.2f} ms")
        output = Path(result.save_dir) / Path(result.path).with_suffix(".jpg").name
        if not output.is_file():
            raise RuntimeError(f"No se encontro la imagen resultante: {output}")
        print(f"Imagen guardada: {output}")


if __name__ == "__main__":
    main()