import io
import unittest
from unittest.mock import patch
from PIL import Image
from backend.yolo.service import decode_image, ImageError, LineCrossingTracker


def image_bytes(fmt='PNG', size=(64, 48)):
    with Image.new('RGB', size) as image:
        output = io.BytesIO()
        image.save(output, format=fmt)
        return output.getvalue()


class ImageValidationTests(unittest.TestCase):
    def test_real_decoders_and_rgb(self):
        for fmt, mime in [('JPEG', 'image/jpeg'), ('PNG', 'image/png'), ('WEBP', 'image/webp')]:
            with decode_image(image_bytes(fmt), mime) as image:
                self.assertEqual(image.size, (64, 48))
                self.assertEqual(image.mode, 'RGB')

    def test_invalid_data_mime_empty_and_limit(self):
        for raw, mime in [(b'', 'image/png'), (b'not an image', 'image/png'),
                          (image_bytes(), 'image/jpeg'), (image_bytes(), 'image/svg+xml')]:
            with self.assertRaises(ImageError):
                decode_image(raw, mime)
        with patch('backend.yolo.service.MAX_BYTES', 1), self.assertRaises(ImageError):
            decode_image(image_bytes(), 'image/png')

    def test_dimensions_and_pixel_limit(self):
        for size in [(31, 64), (8193, 32)]:
            with self.assertRaises(ImageError):
                decode_image(image_bytes(size=size), 'image/png')
        with patch('backend.yolo.service.MAX_PIXELS', 100), self.assertRaises(ImageError):
            decode_image(image_bytes(), 'image/png')

    def test_animation_rejected(self):
        with Image.new('RGB', (64, 48)) as first, Image.new('RGB', (64, 48), 'red') as second:
            output = io.BytesIO()
            first.save(output, format='PNG', save_all=True, append_images=[second])
            with self.assertRaises(ImageError):
                decode_image(output.getvalue(), 'image/png')

    def test_exif_orientation_matches_returned_coordinates(self):
        with Image.new('RGB', (64, 48)) as source:
            exif = Image.Exif()
            exif[274] = 6
            output = io.BytesIO()
            source.save(output, format='JPEG', exif=exif)
        with decode_image(output.getvalue(), 'image/jpeg') as image:
            self.assertEqual(image.size, (48, 64))


class VideoTrackingTests(unittest.TestCase):
    def test_crossing_requires_stable_opposite_zones_and_emits_once(self):
        tracker = LineCrossingTracker(50, 5)
        self.assertEqual([tracker.update(1, 20, n) for n in range(1, 4)], [None, None, None])
        self.assertEqual([tracker.update(1, 80, n) for n in range(4, 7)], [None, None, 'SALIDA'])
        self.assertIsNone(tracker.update(1, 20, 7))
        reverse = LineCrossingTracker(50, 5, left_to_right='ENTRADA', right_to_left='SALIDA')
        for n in range(1, 4): reverse.update(9, 80, n)
        self.assertEqual([reverse.update(9, 20, n) for n in range(4, 7)], [None, None, 'SALIDA'])

    def test_line_oscillation_inside_margin_does_not_count(self):
        tracker = LineCrossingTracker(50, 8)
        for n, x in enumerate([20, 20, 20, 48, 52, 49, 51, 20, 48, 52], 1):
            self.assertIsNone(tracker.update(1, x, n))

    def test_mp4_writer_output_is_readable(self):
        import cv2
        import os
        import tempfile
        path = tempfile.mktemp(suffix='.mp4')
        try:
            writer = cv2.VideoWriter(path, cv2.VideoWriter_fourcc(*'mp4v'), 10, (64, 48))
            self.assertTrue(writer.isOpened())
            for _ in range(3): writer.write(__import__('numpy').zeros((48, 64, 3), dtype='uint8'))
            writer.release()
            capture = cv2.VideoCapture(path)
            self.assertTrue(capture.isOpened())
            ok, frame = capture.read()
            capture.release()
            self.assertTrue(ok)
            self.assertEqual(frame.shape[:2], (48, 64))
        finally:
            if os.path.exists(path): os.unlink(path)

    def test_video_processor_writes_annotations_and_one_evidence_per_crossing(self):
        import cv2
        import os
        import tempfile
        import threading
        from types import SimpleNamespace
        from backend.yolo.service import Detector

        class Tensor:
            def __init__(self, value): self.value = value
            def cpu(self): return self
            def int(self): return self
            def numpy(self): return self.value
            def tolist(self): return self.value

        class Boxes:
            def __init__(self, x):
                self.xyxy = Tensor([x])
                self.id = Tensor([3])
                self.cls = Tensor([0])
                self.conf = Tensor([.95])
            def __len__(self): return len(self.xyxy.value)

        class Model:
            names = {0: 'caja-monitor'}
            def __init__(self): self.frame = 0
            def track(self, **kwargs):
                self.last_conf=kwargs['conf']
                self.frame += 1
                x = 4 if self.frame <= 3 else 50
                return [SimpleNamespace(boxes=Boxes([x, 8, x + 8, 32]))]

        source, output = tempfile.mktemp(suffix='.mp4'), tempfile.mktemp(suffix='.mp4')
        try:
            writer = cv2.VideoWriter(source, cv2.VideoWriter_fourcc(*'mp4v'), 10, (64, 48))
            for _ in range(6): writer.write(__import__('numpy').zeros((48, 64, 3), dtype='uint8'))
            writer.release()
            detector = Detector.__new__(Detector); detector.model = Model(); detector.metadata = {'model':'test','classes':[]}
            job = {'id':'test-job','sourcePath':source,'outputPath':output,'lineRatio':.5,'leftToRight':'SALIDA','rightToLeft':'ENTRADA','cancel':threading.Event()}
            result = detector.process_video_job(job)
            self.assertEqual(result['counts']['salidas'], 1)
            self.assertEqual(len(result['events']), 1)
            self.assertEqual(result['diagnostics']['yoloDetections'],6)
            self.assertEqual(result['diagnostics']['idAssignedDetections'],6)
            self.assertEqual(result['diagnostics']['uniqueTrackIds'],1)
            self.assertEqual(result['diagnostics']['crossings'],1)
            self.assertEqual(result['diagnostics']['stationaryIdObservations'],4)
            self.assertEqual(result['diagnostics']['movingIdObservations'],1)
            self.assertEqual(detector.model.last_conf,.05)
            self.assertTrue(result['events'][0]['evidence'].startswith('data:image/jpeg;base64,'))
            self.assertEqual(result['events'][0]['trackId'], 3)
            capture = cv2.VideoCapture(output)
            ok, annotated_frame = capture.read(); capture.release()
            self.assertTrue(ok)
            self.assertTrue(annotated_frame.any())
            line_pixel=annotated_frame[10,32]
            self.assertGreater(int(line_pixel[1]),120)
            self.assertGreater(int(line_pixel[2]),150)
        finally:
            for path in (source, output):
                if os.path.exists(path): os.unlink(path)

    def test_background_job_cancellation_releases_lock_and_input_file(self):
        import os
        import threading
        import time
        from backend.yolo.service import submit_video_job, VIDEO_JOBS, VIDEO_JOBS_LOCK
        class FakeDetector:
            def __init__(self): self.lock=threading.Lock()
            def process_video_job(self, job):
                if job['cancel'].is_set(): raise InterruptedError()
                while not job['cancel'].wait(.01): pass
                raise InterruptedError()
        detector=FakeDetector()
        job=submit_video_job(detector,b'unit-test-video',.5,'SALIDA','ENTRADA')
        job['cancel'].set()
        deadline=time.time()+2
        while job['status'] not in ('cancelled','failed') and time.time()<deadline: time.sleep(.01)
        self.assertEqual(job['status'],'cancelled')
        self.assertTrue(detector.lock.acquire(blocking=False))
        detector.lock.release()
        self.assertFalse(os.path.exists(job['sourcePath']))
        with VIDEO_JOBS_LOCK: VIDEO_JOBS.pop(job['id'],None)

    def test_background_job_preserves_error_and_cleans_up(self):
        import os
        import threading
        import time
        from backend.yolo.service import submit_video_job, VIDEO_JOBS, VIDEO_JOBS_LOCK
        class FailingDetector:
            def __init__(self): self.lock=threading.Lock()
            def process_video_job(self, job): raise ModuleNotFoundError("No module named 'lap'")
        detector=FailingDetector()
        job=submit_video_job(detector,b'unit-test-video',.5,'SALIDA','ENTRADA')
        deadline=time.time()+2
        while job['status'] in ('queued','processing') and time.time()<deadline: time.sleep(.01)
        self.assertEqual(job['status'],'failed')
        self.assertEqual(job['error'],"ModuleNotFoundError: No module named 'lap'")
        while os.path.exists(job['sourcePath']) and time.time()<deadline: time.sleep(.01)
        self.assertFalse(os.path.exists(job['sourcePath']))
        self.assertFalse(os.path.exists(job['outputPath']))
        self.assertTrue(detector.lock.acquire(blocking=False))
        detector.lock.release()
        with VIDEO_JOBS_LOCK: VIDEO_JOBS.pop(job['id'],None)


if __name__ == '__main__':
    unittest.main()
