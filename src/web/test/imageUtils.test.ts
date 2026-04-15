import { describe, expect, it } from 'vitest';
import { getSupportedImageMimeType, isLikelySupportedImage } from '../src/lib/imageUtils';

describe('imageUtils', () => {
  describe('supported image detection', () => {
    it('normalizes common browser MIME variants', () => {
      expect(getSupportedImageMimeType({ type: 'image/jpg', name: 'photo.jpg' } as File)).toBe(
        'image/jpeg'
      );
      expect(getSupportedImageMimeType({ type: 'image/x-png', name: 'photo.png' } as File)).toBe(
        'image/png'
      );
      expect(
        getSupportedImageMimeType({ type: 'image/x-ms-bmp', name: 'scan.bmp' } as File)
      ).toBe('image/bmp');
    });

    it('falls back to file extension when Safari provides no MIME type', () => {
      expect(getSupportedImageMimeType({ type: '', name: 'IMG_0001.JPG' } as File)).toBe(
        'image/jpeg'
      );
      expect(getSupportedImageMimeType({ type: '', name: 'IMG_0002.HEIC' } as File)).toBe(
        'image/heic'
      );
      expect(isLikelySupportedImage({ type: '', name: 'holiday.png' } as File)).toBe(true);
    });

    it('rejects unsupported files', () => {
      expect(isLikelySupportedImage({ type: 'application/pdf', name: 'notes.pdf' } as File)).toBe(
        false
      );
      expect(getSupportedImageMimeType({ type: '', name: 'archive.zip' } as File)).toBeNull();
    });
  });

  describe('thumbnail dimension calculation', () => {
    function calcDimensions(width: number, height: number, maxSize = 400) {
      if (width > height) {
        if (width > maxSize) {
          height = (height * maxSize) / width;
          width = maxSize;
        }
      } else if (height > maxSize) {
        width = (width * maxSize) / height;
        height = maxSize;
      }

      return { width, height };
    }

    it('scales down landscape images', () => {
      const { width, height } = calcDimensions(4000, 3000);
      expect(width).toBe(400);
      expect(height).toBe(300);
    });

    it('scales down portrait images', () => {
      const { width, height } = calcDimensions(3000, 4000);
      expect(width).toBe(300);
      expect(height).toBe(400);
    });

    it('does not upscale small images', () => {
      const { width, height } = calcDimensions(200, 150);
      expect(width).toBe(200);
      expect(height).toBe(150);
    });

    it('handles square images', () => {
      const { width, height } = calcDimensions(2000, 2000);
      expect(width).toBe(400);
      expect(height).toBe(400);
    });

    it('uses custom max size', () => {
      const { width, height } = calcDimensions(1000, 500, 200);
      expect(width).toBe(200);
      expect(height).toBe(100);
    });
  });
});
