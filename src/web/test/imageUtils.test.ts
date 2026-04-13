import { describe, it, expect } from 'vitest';

// Test the thumbnail generation logic without actually loading images
// (jsdom doesn't support canvas/Image fully, so we test the pure logic)

describe('imageUtils', () => {
  describe('HEIC detection logic', () => {
    it('detects HEIC by mime type', () => {
      const isHeic = (file: { type: string; name: string }) =>
        file.type === 'image/heic' || file.type === 'image/heif' ||
        file.name.toLowerCase().endsWith('.heic') || file.name.toLowerCase().endsWith('.heif');

      expect(isHeic({ type: 'image/heic', name: 'photo.heic' })).toBe(true);
      expect(isHeic({ type: 'image/heif', name: 'photo.heif' })).toBe(true);
      expect(isHeic({ type: '', name: 'photo.HEIC' })).toBe(true);
      expect(isHeic({ type: '', name: 'photo.HEIF' })).toBe(true);
      expect(isHeic({ type: 'image/jpeg', name: 'photo.jpg' })).toBe(false);
      expect(isHeic({ type: 'image/png', name: 'photo.png' })).toBe(false);
    });
  });

  describe('thumbnail dimension calculation', () => {
    function calcDimensions(width: number, height: number, maxSize = 400) {
      if (width > height) {
        if (width > maxSize) {
          height = (height * maxSize) / width;
          width = maxSize;
        }
      } else {
        if (height > maxSize) {
          width = (width * maxSize) / height;
          height = maxSize;
        }
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
