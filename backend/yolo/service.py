"""Inferencia local, sin persistir imágenes ni acceder a Supabase.

Iniciar: python backend/yolo/service.py
"""
import argparse
import base64
import tempfile
import io
import json
import logging
import os
import uuid
from datetime import datetime, timezone
from collections import deque
from pathlib import Path
import socket
import threading
import time
import warnings
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parent
MODEL_PATH = ROOT / 'runs/detect/monitores_v1/weights/best.pt'
CACHE = Path(__file__).resolve().parent / '.cache'
(CACHE / 'Ultralytics').mkdir(parents=True, exist_ok=True)
os.environ.setdefault('YOLO_CONFIG_DIR', str(CACHE))
os.environ.setdefault('YOLO_AUTOINSTALL', '0')

from PIL import Image, ImageOps, UnidentifiedImageError  # noqa: E402

LOGGER = logging.getLogger('eagle_vision')

_pil_image_open = Image.open

MAX_BYTES = 8 * 1024 * 1024
MAX_VIDEO_BYTES = 100 * 1024 * 1024
VIDEO_JOBS = {}
VIDEO_JOBS_LOCK = threading.Lock()
VIDEO_JOB_TTL = 30 * 60
MAX_PIXELS = 16_000_000
MAX_EDGE = 8192
Image.MAX_IMAGE_PIXELS = MAX_PIXELS
FORMATS = {'image/jpeg': 'JPEG', 'image/png': 'PNG', 'image/webp': 'WEBP'}


class ImageError(ValueError):
    pass


class ModelBusyError(RuntimeError):
    pass


class LineCrossingTracker:
    """Require a stable zone change across the configured line and margin."""
    def __init__(self, line_x, margin, left_to_right='SALIDA', right_to_left='ENTRADA'):
        self.line_x, self.margin = line_x, margin
        self.left_to_right, self.right_to_left = left_to_right, right_to_left
        self.history, self.last_seen, self.fired = {}, {}, set()

    def inspect(self, track_id, center_x, frame_no):
        side = -1 if center_x < self.line_x - self.margin else 1 if center_x > self.line_x + self.margin else 0
        self.last_seen[track_id] = frame_no
        samples = self.history.setdefault(track_id, deque(maxlen=8))
        if side:
            samples.append(side)
        event, reason = None, None
        candidate = -1 in samples and 1 in samples
        # Three stable positions on the new side suppress line oscillation.
        if len(samples) >= 3 and len(set(list(samples)[-3:])) == 1 and track_id not in self.fired:
            stable_side = samples[-1]
            other_side_seen = -stable_side in samples
            if other_side_seen:
                event = self.left_to_right if stable_side > 0 else self.right_to_left
                self.fired.add(track_id)
            else:
                reason = 'Se requieren posiciones estables a ambos lados de la línea.'
        elif candidate and side == 0:
            reason = 'Posible cruce detenido dentro del margen de la línea.'
        elif candidate and (len(samples) < 3 or len(set(list(samples)[-3:])) != 1):
            reason = 'Cruce observado; aún no hay tres posiciones estables al otro lado.'
        elif candidate and track_id in self.fired:
            reason = 'Este ID ya generó un cruce; se evita duplicarlo.'
        for old_id, seen in list(self.last_seen.items()):
            if frame_no - seen > 90:
                self.last_seen.pop(old_id, None)
                self.history.pop(old_id, None)
        return {'event': event, 'reason': reason, 'side': side, 'candidate': candidate}

    def update(self, track_id, center_x, frame_no):
        return self.inspect(track_id, center_x, frame_no)['event']


def _box_iou(first, second):
    x1=max(float(first[0]),float(second[0])); y1=max(float(first[1]),float(second[1]))
    x2=min(float(first[2]),float(second[2])); y2=min(float(first[3]),float(second[3]))
    intersection=max(0.0,x2-x1)*max(0.0,y2-y1)
    area_a=max(0.0,float(first[2])-float(first[0]))*max(0.0,float(first[3])-float(first[1]))
    area_b=max(0.0,float(second[2])-float(second[0]))*max(0.0,float(second[3])-float(second[1]))
    union=area_a+area_b-intersection
    return intersection/union if union else 0.0


def decode_image(raw, content_type):
    if content_type not in FORMATS or not raw or len(raw) > MAX_BYTES:
        raise ImageError('Usa JPG, PNG o WebP de hasta 8 MiB.')
    try:
        with warnings.catch_warnings():
            warnings.simplefilter('error', Image.DecompressionBombWarning)
            with _pil_image_open(io.BytesIO(raw)) as source:
                if source.format != FORMATS[content_type]:
                    raise ImageError('El contenido no coincide con el formato declarado.')
                width, height = source.size
                if min(width, height) < 32 or max(width, height) > MAX_EDGE or width * height > MAX_PIXELS:
                    raise ImageError('Dimensiones permitidas: mínimo 32 px por lado, máximo 8192 px por lado y 16 megapíxeles.')
                if getattr(source, 'n_frames', 1) != 1:
                    raise ImageError('Selecciona una imagen estática, no una animación.')
                source.verify()
            with _pil_image_open(io.BytesIO(raw)) as source:
                return ImageOps.exif_transpose(source).convert('RGB')
    except ImageError:
        raise
    except (UnidentifiedImageError, OSError, ValueError, Image.DecompressionBombWarning, Image.DecompressionBombError) as error:
        raise ImageError('La imagen está dañada, es incompatible o excede los límites.') from error


class Detector:
    def __init__(self):
        if not MODEL_PATH.is_file():
            raise RuntimeError('No existe backend/yolo/runs/detect/monitores_v1/weights/best.pt. No se carga ningún modelo alternativo.')
        from ultralytics import YOLO
        import ultralytics
        self.model = YOLO(str(MODEL_PATH), task='detect')
        if self.model.task != 'detect':
            raise RuntimeError('best.pt no es un modelo de detección compatible.')
        self.lock = threading.Lock()
        self.live_crossing = LineCrossingTracker(320, 8)
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

    def reset_live(self, ratio=.5, left_to_right='SALIDA', right_to_left='ENTRADA'):
        self.reset_trackers()
        self.live_crossing=LineCrossingTracker(320,8,left_to_right,right_to_left)
        self.live_ratio=ratio

    def reset_trackers(self):
        predictor=getattr(self.model,'predictor',None)
        for tracker in getattr(predictor,'trackers',[]) or []:
            tracker.reset()

    def track_image(self, image):
        import cv2
        import numpy as np
        frame=cv2.cvtColor(np.asarray(image),cv2.COLOR_RGB2BGR)
        height,width=frame.shape[:2]
        line_x=int(width*getattr(self,'live_ratio',.5))
        if self.live_crossing.line_x!=line_x:
            self.live_crossing=LineCrossingTracker(line_x,max(8,int(width*.015)),self.live_crossing.left_to_right,self.live_crossing.right_to_left)
        tracked=self.model.track(source=frame,imgsz=640,conf=.25,max_det=100,device='cpu',persist=True,tracker='bytetrack.yaml',verbose=False)[0]
        detections=[]
        if tracked.boxes is not None and tracked.boxes.id is not None:
            rows=zip(tracked.boxes.xyxy.cpu().numpy(),tracked.boxes.id.int().cpu().tolist(),tracked.boxes.cls.int().cpu().tolist(),tracked.boxes.conf.cpu().tolist())
            for box,track_id,class_id,confidence in rows:
                movement=self.live_crossing.update(int(track_id),float((box[0]+box[2])/2),int(time.monotonic()*10))
                detections.append({'trackId':int(track_id),'classId':int(class_id),'className':self.model.names[class_id],
                    'confidence':float(confidence),'box':[float(v) for v in box],'event':movement})
        return {**self.metadata,'width':width,'height':height,'line':{'x':line_x},'detections':detections}

    def process_video_job(self, job):
        import cv2
        LOGGER.info('video_decode_open job_id=%s source=%s', job['id'], job['sourcePath'])
        self.reset_trackers()
        source_path, output_path = job['sourcePath'], job['outputPath']
        capture = cv2.VideoCapture(source_path)
        writer = None
        started = time.monotonic()
        events, frame_no = [], 0
        diagnostics = {'videoConfidenceThreshold':.05,'yoloDetections':0,'idAssignedDetections':0,'uniqueTrackIds':0,
            'framesWithDetections':0,'framesWithIds':0,'framesWithNoDetections':0,'noIdDetections':0,
            'stationaryIdObservations':0,'movingIdObservations':0,
            'crossingCandidates':0,'confirmedCrossings':0,'discardedCrossings':{},'possibleIdChanges':0,'lostTracks':0,
            'confidenceSamples':[]}
        seen_ids, last_tracks, noted_changes, lost_noted = set(), {}, set(), set()
        try:
            if not capture.isOpened():
                raise ImageError('OpenCV no pudo abrir el MP4.')
            width, height = int(capture.get(cv2.CAP_PROP_FRAME_WIDTH)), int(capture.get(cv2.CAP_PROP_FRAME_HEIGHT))
            fps, total = capture.get(cv2.CAP_PROP_FPS) or 25, int(capture.get(cv2.CAP_PROP_FRAME_COUNT))
            LOGGER.info('video_decode_ready job_id=%s width=%s height=%s fps=%s frames=%s',job['id'],width,height,fps,total)
            if min(width, height) < 32 or max(width, height) > 3840 or width * height > 8_000_000 or total < 1 or total > int(fps * 1200):
                raise ImageError('Video fuera de lÃ­mites: mÃ¡ximo 3840 px por lado, 8 MP y 20 minutos.')
            ratio = job['lineRatio']; line_x = int(width * ratio); margin = max(8, int(width * .015))
            crossing = LineCrossingTracker(line_x, margin, job['leftToRight'], job['rightToLeft'])
            writer = cv2.VideoWriter(output_path, cv2.VideoWriter_fourcc(*'mp4v'), fps, (width, height))
            if not writer.isOpened():
                raise RuntimeError('OpenCV no pudo crear el video anotado.')
            LOGGER.info('video_output_ready job_id=%s output=%s codec=mp4v',job['id'],output_path)
            job.update({'totalFrames': total, 'width': width, 'height': height, 'line': {'x': line_x, 'margin': margin}})
            while True:
                if job['cancel'].is_set():
                    raise InterruptedError('Procesamiento cancelado.')
                ok, frame = capture.read()
                if not ok: break
                frame_no += 1
                # Keep low-confidence boxes available to ByteTrack's second association pass.
                tracked = self.model.track(source=frame, imgsz=640, conf=.05, max_det=100, device='cpu', persist=True, tracker='bytetrack.yaml', verbose=False)[0]
                cv2.line(frame, (line_x, 0), (line_x, height), (0, 220, 255), 2)
                cv2.putText(frame, 'LINEA DE CRUCE', (max(5, line_x-90), 24), cv2.FONT_HERSHEY_SIMPLEX, .6, (0, 220, 255), 2)
                frame_detections=[]
                boxes=tracked.boxes
                if boxes is not None and len(boxes):
                    xyxy=boxes.xyxy.cpu().numpy(); class_ids=boxes.cls.int().cpu().tolist(); confidences=boxes.conf.cpu().tolist()
                    track_ids=boxes.id.int().cpu().tolist() if boxes.id is not None else [None]*len(xyxy)
                    diagnostics['yoloDetections']+=len(xyxy)
                    diagnostics['framesWithDetections']+=1
                    diagnostics['idAssignedDetections']+=sum(track_id is not None for track_id in track_ids)
                    diagnostics['noIdDetections']+=sum(track_id is None for track_id in track_ids)
                    if any(track_id is not None for track_id in track_ids): diagnostics['framesWithIds']+=1
                    for box, track_id, class_id, confidence in zip(xyxy,track_ids,class_ids,confidences):
                        x1,y1,x2,y2=[int(x) for x in box]
                        name=self.model.names[int(class_id)]; center_x=float((box[0]+box[2])/2)
                        detail={'class':name,'confidence':round(float(confidence),4),'trackId':int(track_id) if track_id is not None else None,'centerX':round(center_x,1)}
                        frame_detections.append(detail)
                        if len(diagnostics['confidenceSamples'])<2000: diagnostics['confidenceSamples'].append(round(float(confidence),4))
                        color=(40,230,100) if track_id is not None else (0,165,255)
                        cv2.rectangle(frame,(x1,y1),(x2,y2),color,2)
                        label=f"ID {track_id if track_id is not None else 'sin ID'} | {name} | {confidence*100:.1f}%"
                        cv2.putText(frame,label,(x1,max(18,y1-7)),cv2.FONT_HERSHEY_SIMPLEX,.5,color,2)
                        if track_id is None: continue
                        track_id=int(track_id); seen_ids.add(track_id)
                        previous=[(old_id,old) for old_id,old in last_tracks.items() if old_id!=track_id and frame_no-old['frame']<=30]
                        for old_id,old in previous:
                            if old_id not in noted_changes and _box_iou(box,old['box'])>=.5:
                                diagnostics['possibleIdChanges']+=1; noted_changes.add(old_id)
                                LOGGER.warning('video_track_id_possible_change job_id=%s frame=%s old_id=%s new_id=%s iou=%.3f',job['id'],frame_no,old_id,track_id,_box_iou(box,old['box']))
                        prior=last_tracks.get(track_id)
                        if prior and frame_no-prior['frame']==1:
                            previous_center=(prior['box'][0]+prior['box'][2])/2
                            displacement=abs(center_x-previous_center)
                            state='moving' if displacement>2 else 'stationary'
                            diagnostics['movingIdObservations' if state=='moving' else 'stationaryIdObservations']+=1
                            detail.update({'horizontalDisplacementPx':round(displacement,1),'motionState':state})
                            LOGGER.info('video_track_motion job_id=%s frame=%s track_id=%s state=%s dx=%.1f confidence=%.4f',job['id'],frame_no,track_id,state,displacement,confidence)
                        elif prior and frame_no-prior['frame']>1 and track_id not in lost_noted:
                            diagnostics['lostTracks']+=1;lost_noted.add(track_id)
                            LOGGER.warning('video_track_gap job_id=%s track_id=%s from_frame=%s to_frame=%s gap=%s',job['id'],track_id,prior['frame'],frame_no,frame_no-prior['frame']-1)
                        last_tracks[track_id]={'frame':frame_no,'box':[float(v) for v in box]}
                        crossing_result=crossing.inspect(track_id,center_x,frame_no); movement=crossing_result['event']
                        detail.update({'side':crossing_result['side'],'crossingReason':crossing_result['reason'],'event':movement})
                        if crossing_result['candidate'] and crossing_result['reason']:
                            reason=crossing_result['reason']; diagnostics['discardedCrossings'][reason]=diagnostics['discardedCrossings'].get(reason,0)+1
                        if movement:
                            diagnostics['crossingCandidates']+=1
                            diagnostics['confirmedCrossings']+=1
                        if movement and len(events)<50:
                            stamp=datetime.now(timezone.utc).isoformat()
                            cv2.rectangle(frame,(x1,y1),(x2,y2),(0,0,255),4)
                            cv2.putText(frame,f'{movement} CONFIRMADO - ID {track_id}',(12,height-18),cv2.FONT_HERSHEY_SIMPLEX,.7,(0,0,255),2)
                            cv2.putText(frame,stamp,(12,48),cv2.FONT_HERSHEY_SIMPLEX,.5,(255,255,255),2)
                            thumb=cv2.resize(frame,(min(640,width),int(height*min(640,width)/width)))
                            ok_jpg,jpeg=cv2.imencode('.jpg',thumb,[cv2.IMWRITE_JPEG_QUALITY,72])
                            events.append({'trackId':int(track_id),'type':movement,'frame':frame_no,'timeSeconds':round(frame_no/fps,2),'timestamp':stamp,
                                'classId':int(class_id),'className':self.model.names[int(class_id)],'confidence':round(float(confidence),4),
                                'box':[round(float(x),1) for x in box],'evidence':'data:image/jpeg;base64,'+base64.b64encode(jpeg).decode('ascii') if ok_jpg else None})
                else:
                    diagnostics['framesWithNoDetections']+=1
                current_ids={d['trackId'] for d in frame_detections if d['trackId'] is not None}
                for old_id,old in last_tracks.items():
                    if old_id not in current_ids and frame_no-old['frame']>1 and old_id not in lost_noted:
                        diagnostics['lostTracks']+=1;lost_noted.add(old_id)
                        LOGGER.warning('video_track_lost job_id=%s track_id=%s last_frame=%s missing_at_frame=%s',job['id'],old_id,old['frame'],frame_no)
                lost_noted.difference_update(current_ids)
                LOGGER.info('video_frame_diagnostics job_id=%s frame=%s yolo_detections=%s assigned_ids=%s detections=%s',job['id'],frame_no,len(frame_detections),sum(d['trackId'] is not None for d in frame_detections),frame_detections)
                writer.write(frame)
                job.update({'processedFrames':frame_no,'progress':round(frame_no*100/total,1),'elapsedSeconds':round(time.monotonic()-started,1)})
            if job['cancel'].is_set(): raise InterruptedError('Procesamiento cancelado.')
            diagnostics['uniqueTrackIds']=len(seen_ids)
            diagnostics['discardedCrossings']= [{'reason':reason,'count':count} for reason,count in diagnostics['discardedCrossings'].items()]
            diagnostics['crossings']=diagnostics['confirmedCrossings']
            diagnostics['averageConfidence']=round(sum(diagnostics['confidenceSamples'])/len(diagnostics['confidenceSamples']),4) if diagnostics['confidenceSamples'] else None
            diagnostics.pop('confidenceSamples',None)
            LOGGER.info('video_diagnostics_summary job_id=%s diagnostics=%s',job['id'],diagnostics)
            return {**self.metadata,'videoConfidenceThreshold':.05,'width':width,'height':height,'fps':fps,'totalFrames':total,'processedFrames':frame_no,
                'line':{'x':line_x,'margin':margin,'ratio':ratio,'leftToRight':job['leftToRight'],'rightToLeft':job['rightToLeft']},
                'diagnostics':diagnostics,
                'events':events,'counts':{'entradas':sum(e['type']=='ENTRADA' for e in events),'salidas':sum(e['type']=='SALIDA' for e in events)},
                'elapsedSeconds':round(time.monotonic()-started,1),'mode':'review'}
        finally:
            capture.release()
            if writer: writer.release()


def cleanup_video_jobs():
    cutoff = time.time() - VIDEO_JOB_TTL
    with VIDEO_JOBS_LOCK:
        for job_id, job in list(VIDEO_JOBS.items()):
            if job['created'] < cutoff and job['status'] in ('queued', 'processing', 'cancelling'):
                job['cancel'].set()
            if job['created'] < cutoff and job['status'] in ('completed', 'failed', 'cancelled'):
                for key in ('sourcePath', 'outputPath'):
                    try: os.unlink(job[key])
                    except OSError: pass
                VIDEO_JOBS.pop(job_id, None)


def submit_video_job(detector, raw, line_ratio, left_to_right, right_to_left):
    if not detector.lock.acquire(blocking=False):
        raise ModelBusyError('El modelo estÃ¡ ocupado. Espera a que termine el otro anÃ¡lisis.')
    source_path = output_path = None
    try:
        with tempfile.NamedTemporaryFile(suffix='.mp4', delete=False) as source:
            source_path=source.name;source.write(raw)
        output=tempfile.NamedTemporaryFile(suffix='.mp4',delete=False)
        output_path=output.name;output.close();os.unlink(output_path)
    except Exception:
        for path in (source_path,output_path):
            if path:
                try: os.unlink(path)
                except OSError: pass
        detector.lock.release()
        raise
    job_id = str(uuid.uuid4())
    job = {'id':job_id,'status':'queued','progress':0.0,'processedFrames':0,'totalFrames':0,'elapsedSeconds':0,
        'created':time.time(),'sourcePath':source_path,'outputPath':output_path,'lineRatio':line_ratio,
        'leftToRight':left_to_right,'rightToLeft':right_to_left,'cancel':threading.Event(),'result':None,'error':None}
    with VIDEO_JOBS_LOCK: VIDEO_JOBS[job_id] = job
    def worker():
        job['status']='processing'
        try:
            job['result']=detector.process_video_job(job)
            job['status']='completed';job['progress']=100.0
        except InterruptedError:
            job['status']='cancelled'
        except Exception as error:
            job['error']=f'{type(error).__name__}: {error}'
            job['status']='failed'
            LOGGER.exception('video_job_failed job_id=%s',job_id)
        finally:
            try: os.unlink(job['sourcePath'])
            except OSError: pass
            if job['status'] != 'completed':
                try: os.unlink(job['outputPath'])
                except OSError: pass
            detector.lock.release()
    threading.Thread(target=worker,daemon=True,name=f'vision-{job_id[:8]}').start()
    LOGGER.info('video_job_queued job_id=%s bytes=%s line_ratio=%s left_to_right=%s right_to_left=%s',job_id,len(raw),line_ratio,left_to_right,right_to_left)
    return job


def video_job_cleaner():
    while True:
        time.sleep(60)
        cleanup_video_jobs()


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

        def send_file(self, path):
            self.send_response(200)
            self.send_header('Content-Type', 'video/mp4')
            self.send_header('Content-Length', str(os.path.getsize(path)))
            self.send_header('Cache-Control', 'no-store')
            self.end_headers()
            with open(path, 'rb') as output:
                while True:
                    chunk=output.read(1024*1024)
                    if not chunk: break
                    self.wfile.write(chunk)

        def do_GET(self):
            cleanup_video_jobs()
            parsed=urlparse(self.path)
            if parsed.path == '/health': return self.send_json(200, detector.metadata)
            parts=parsed.path.strip('/').split('/')
            if len(parts)==3 and parts[0]=='video' and parts[1] in VIDEO_JOBS:
                job=VIDEO_JOBS[parts[1]]
                if parts[2]=='status':
                    return self.send_json(200,{k:job[k] for k in ('id','status','progress','processedFrames','totalFrames','elapsedSeconds','error')})
                if parts[2]=='result' and job['status']=='completed': return self.send_json(200,job['result'])
                if parts[2]=='output' and job['status']=='completed': return self.send_file(job['outputPath'])
                return self.send_json(409,{'error':'El resultado no estÃ¡ disponible en este estado.'})
            self.send_json(404, {'error': 'Ruta no disponible.'})

        def do_POST(self):
            parsed=urlparse(self.path); parts=parsed.path.strip('/').split('/')
            if parsed.path == '/live/reset':
                if self.headers.get('Origin') or self.headers.get('Transfer-Encoding'):
                    return self.send_json(403,{'error':'Utiliza el backend autenticado.'})
                try:
                    length=int(self.headers.get('Content-Length','0'))
                    if length<2 or length>2048: return self.send_json(400,{'error':'Configuración de cámara inválida.'})
                    config=json.loads(self.rfile.read(length))
                    ratio=float(config.get('lineRatio',.5));left=config.get('leftToRight','SALIDA');right=config.get('rightToLeft','ENTRADA')
                    if not .1<=ratio<=.9 or {left,right}!={'ENTRADA','SALIDA'}: return self.send_json(400,{'error':'Configuración de línea inválida.'})
                except (ValueError,TypeError): return self.send_json(400,{'error':'Configuración de cámara inválida.'})
                if not detector.lock.acquire(blocking=False): return self.send_json(429,{'error':'El modelo está ocupado.'})
                try:
                    detector.reset_live(ratio,left,right);detector.live_ratio=ratio
                    return self.send_json(200,{'status':'ready','classes':detector.metadata['classes']})
                finally: detector.lock.release()
            if len(parts)==3 and parts[0]=='video' and parts[2]=='cancel' and parts[1] in VIDEO_JOBS:
                job=VIDEO_JOBS[parts[1]]
                if job['status'] in ('queued','processing'):
                    job['cancel'].set();job['status']='cancelling'
                return self.send_json(200,{'id':job['id'],'status':job['status']})
            if parsed.path not in ('/detect', '/video', '/track'):
                return self.send_json(404, {'error': 'Ruta no disponible.'})
            # No CORS ni llamadas de páginas web directamente al servicio local.
            if self.headers.get('Origin') or self.headers.get('Transfer-Encoding'):
                return self.send_json(403, {'error': 'Utiliza el backend Node autenticado.'})
            content_type = self.headers.get('Content-Type', '').split(';')[0].lower()
            is_video = parsed.path == '/video'
            if (content_type != 'video/mp4') if is_video else (content_type not in FORMATS):
                return self.send_json(415, {'error': 'Formato no permitido.'})
            try:
                length = int(self.headers.get('Content-Length', '0'))
            except ValueError:
                length = 0
            limit = MAX_VIDEO_BYTES if is_video else MAX_BYTES
            if length < 1 or length > limit:
                return self.send_json(413, {'error': 'El video debe pesar entre 1 byte y 100 MiB.' if is_video else 'La imagen debe pesar entre 1 byte y 8 MiB.'})
            locked = False
            if not is_video and not detector.lock.acquire(blocking=False):
                return self.send_json(429, {'error': 'El modelo está ocupado. Reintenta en unos segundos.'})
            elif not is_video:
                locked = True
            try:
                self.connection.settimeout(60 if is_video else 10)
                raw = self.rfile.read(length)
                if len(raw) != length:
                    return self.send_json(400, {'error': 'Carga de imagen incompleta.'})
                if is_video:
                    if len(raw)<12 or raw[4:8]!=b'ftyp': return self.send_json(415,{'error':'El archivo no es un MP4 vÃ¡lido.'})
                    query=__import__('urllib.parse',fromlist=['parse_qs']).parse_qs(parsed.query)
                    try: ratio=float(query.get('lineRatio',['0.5'])[0])
                    except ValueError: return self.send_json(400,{'error':'PosiciÃ³n de lÃ­nea no vÃ¡lida.'})
                    if not .1<=ratio<=.9: return self.send_json(400,{'error':'La posiciÃ³n de lÃ­nea debe estar entre 10 % y 90 %.'})
                    direction_in=query.get('leftToRight',['SALIDA'])[0]
                    direction_out=query.get('rightToLeft',['ENTRADA'])[0]
                    if {direction_in,direction_out}!={'ENTRADA','SALIDA'}: return self.send_json(400,{'error':'Configura una entrada y una salida opuestas.'})
                    cleanup_video_jobs()
                    job=submit_video_job(detector,raw,ratio,direction_in,direction_out)
                    return self.send_json(202,{'jobId':job['id'],'status':job['status']})
                image = decode_image(raw, content_type)
                try:
                    result = detector.track_image(image) if parsed.path=='/track' else detector.detect(image)
                finally:
                    image.close()
                self.send_json(200, result)
            except ModelBusyError as error:
                self.send_json(429, {'error': str(error)})
            except ImageError as error:
                self.send_json(400, {'error': str(error)})
            except (socket.timeout, TimeoutError):
                self.send_json(408, {'error': 'La carga de imagen excedió el tiempo permitido.'})
            except Exception as error:
                LOGGER.exception('vision_request_failed path=%s',parsed.path)
                if parsed.path == '/video':
                    self.send_json(500,{'error':f'{type(error).__name__}: {error}'})
                else:
                    self.send_json(500, {'error': 'Falló la inferencia del modelo. Revisa la consola de Python.'})
            finally:
                if locked:
                    detector.lock.release()

    return Handler


if __name__ == '__main__':
    logging.basicConfig(level=logging.INFO,format='%(asctime)s %(levelname)s %(name)s %(message)s')
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--port', type=int, default=8001)
    args = parser.parse_args()
    detector = Detector()  # Una carga por proceso. Nunca reentrena ni usa yolov8n.pt.
    threading.Thread(target=video_job_cleaner,daemon=True,name='vision-job-cleaner').start()
    server = ThreadingHTTPServer(('127.0.0.1', args.port), make_handler(detector))
    server.daemon_threads = True
    print(json.dumps({'listening': f'http://127.0.0.1:{args.port}', **detector.metadata}), flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
