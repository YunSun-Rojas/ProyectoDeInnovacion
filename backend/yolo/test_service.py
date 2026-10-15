import io
import unittest
from unittest.mock import patch
from PIL import Image
from backend.yolo.service import decode_image, ImageError


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


if __name__ == '__main__':
    unittest.main()
