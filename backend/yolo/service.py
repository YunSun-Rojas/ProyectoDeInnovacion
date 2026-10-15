"""Inferencia local, sin persistir imágenes ni acceder a Supabase.

Iniciar: python backend/yolo/service.py
"""
import argparse
import io
import json
import os
from pathlib import Path
import socket
import threading
import time
import warnings
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

ROOT = Path(__file__).resolve().parents[2]
MODEL_PATH = ROOT / 'runs/detect/monitores_v1/weights/best.pt'
CACHE = Path(__file__).resolve().parent / '.cache'
(CACHE / 'Ultralytics').mkdir(parents=True, exist_ok=True)
os.environ.setdefault('YOLO_CONFIG_DIR', str(CACHE))

from PIL import Image, ImageOps, UnidentifiedImageError  # noqa: E402

MAX_BYTES = 8 * 1024 * 1024
MAX_PIXELS = 16_000_000
MAX_EDGE = 8192
Image.MAX_IMAGE_PIXELS = MAX_PIXELS
FORMATS = {'image/jpeg': 'JPEG', 'image/png': 'PNG', 'image/webp': 'WEBP'}


class ImageError(ValueError):
    pass


def decode_image(raw, content_type):
    if content_type not in FORMATS or not raw or len(raw) > MAX_BYTES:
        raise ImageError('Usa JPG, PNG o WebP de hasta 8 MiB.')
    try:
        with warnings.catch_warnings():
            warnings.simplefilter('error', Image.DecompressionBombWarning)
            with Image.open(io.BytesIO(raw)) as source:
                if source.format != FORMATS[content_type]:
                    raise ImageError('El contenido no coincide con el formato declarado.')
                width, height = source.size
                if min(width, height) < 32 or max(width, height) > MAX_EDGE or width * height > MAX_PIXELS:
                    raise ImageError('Dimensiones permitidas: mínimo 32 px por lado, máximo 8192 px por lado y 16 megapíxeles.')
                if getattr(source, 'n_frames', 1) != 1:
                    raise ImageError('Selecciona una imagen estática, no una animación.')
                source.verify()
            with Image.open(io.BytesIO(raw)) as source:
                return ImageOps.exif_transpose(source).convert('RGB')
    except ImageError:
        raise
    except (UnidentifiedImageError, OSError, ValueError, Image.DecompressionBombWarning, Image.DecompressionBombError) as error:
        raise ImageError('La imagen está dañada, es incompatible o excede los límites.') from error


class Detector:
    def __init__(self):
        if not MODEL_PATH.is_file():
            raise RuntimeError('No existe runs/detect/monitores_v1/weights/best.pt. No se carga ningún modelo alternativo.')
        from ultralytics import YOLO
        import ultralytics
        self.model = YOLO(str(MODEL_PATH), task='detect')
        if self.model.task != 'detect':
            raise RuntimeError('best.pt no es un modelo de detección compatible.')
        self.lock = threading.Lock()
        self.metadata = {'model': 'monitores_v1/best.pt', 'classes': [
            {'id': int(key), 'name': value} for key, value in self.model.names.items()
        ], 'imageSize': 640, 'confidenceThreshold': 0.25, 'ultralytics': ultralytics.__version__}

    def detect(self, image):
        start = time.perf_counter()
        result = self.model.predict(source=image, imgsz=640, conf=0.25, max_det=100,
                                    device='cpu', save=False, save_txt=False, save_crop=False,
                                    verbose=False)[0]
        detections = []
        for box in result.boxes:
            class_id = int(box.cls.item())
            x1, y1, x2, y2 = box.xyxy[0].tolist()
            detections.append({'classId': class_id, 'className': self.model.names[class_id],
                               'confidence': float(box.conf.item()), 'box': [
                                   max(0.0, min(float(image.width), x1)), max(0.0, min(float(image.height), y1)),
                                   max(0.0, min(float(image.width), x2)), max(0.0, min(float(image.height), y2))]})
        return {**self.metadata, 'width': image.width, 'height': image.height,
                'elapsedMs': round((time.perf_counter() - start) * 1000), 'detections': detections}


def make_handler(detector):
    class Handler(BaseHTTPRequestHandler):
        server_version = 'EagleVision'

        def send_json(self, status, data):
            raw = json.dumps(data, ensure_ascii=False).encode('utf-8')
            self.send_response(status)
            self.send_header('Content-Type', 'application/json; charset=utf-8')
            self.send_header('Content-Length', str(len(raw)))
            self.send_header('Cache-Control', 'no-store')
            self.send_header('Connection', 'close')
            self.end_headers()
            self.close_connection = True
            try:
                self.wfile.write(raw)
            except (BrokenPipeError, ConnectionResetError):
                pass

        def do_GET(self):
            if self.path != '/health':
                return self.send_json(404, {'error': 'Ruta no disponible.'})
            self.send_json(200, detector.metadata)

        def do_POST(self):
            if self.path != '/detect':
                return self.send_json(404, {'error': 'Ruta no disponible.'})
            # No CORS ni llamadas de páginas web directamente al servicio local.
            if self.headers.get('Origin') or self.headers.get('Transfer-Encoding'):
                return self.send_json(403, {'error': 'Utiliza el backend Node autenticado.'})
            content_type = self.headers.get('Content-Type', '').split(';')[0].lower()
            if content_type not in FORMATS:
                return self.send_json(415, {'error': 'Formato no permitido.'})
            try:
                length = int(self.headers.get('Content-Length', '0'))
            except ValueError:
                length = 0
            if length < 1 or length > MAX_BYTES:
                return self.send_json(413, {'error': 'La imagen debe pesar entre 1 byte y 8 MiB.'})
            if not detector.lock.acquire(blocking=False):
                return self.send_json(429, {'error': 'El modelo está ocupado. Reintenta en unos segundos.'})
            try:
                self.connection.settimeout(10)
                raw = self.rfile.read(length)
                if len(raw) != length:
                    return self.send_json(400, {'error': 'Carga de imagen incompleta.'})
                image = decode_image(raw, content_type)
                try:
                    result = detector.detect(image)
                finally:
                    image.close()
                self.send_json(200, result)
            except ImageError as error:
                self.send_json(400, {'error': str(error)})
            except (socket.timeout, TimeoutError):
                self.send_json(408, {'error': 'La carga de imagen excedió el tiempo permitido.'})
            except Exception:
                self.send_json(500, {'error': 'Falló la inferencia del modelo. Revisa la consola de Python.'})
                import traceback
                traceback.print_exc()
            finally:
                detector.lock.release()

    return Handler


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--port', type=int, default=8001)
    args = parser.parse_args()
    detector = Detector()  # Una carga por proceso. Nunca reentrena ni usa yolov8n.pt.
    server = ThreadingHTTPServer(('127.0.0.1', args.port), make_handler(detector))
    server.daemon_threads = True
    print(json.dumps({'listening': f'http://127.0.0.1:{args.port}', **detector.metadata}), flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
