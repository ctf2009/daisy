import { describe, it, expect } from 'vitest';
import { getPhotoKey, getThumbnailKey, getExtFromContentType } from '../src/lib/r2';

describe('getPhotoKey', () => {
  it('builds a key from album id, upload id, and extension', () => {
    expect(getPhotoKey('album-1', 'upload-1', 'jpg')).toBe('album-1/upload-1.jpg');
  });

  it('works with different extensions', () => {
    expect(getPhotoKey('a', 'b', 'png')).toBe('a/b.png');
    expect(getPhotoKey('a', 'b', 'webp')).toBe('a/b.webp');
  });
});

describe('getThumbnailKey', () => {
  it('builds a thumbnail key in the thumbs subdirectory', () => {
    expect(getThumbnailKey('album-1', 'upload-1')).toBe('album-1/thumbs/upload-1.jpg');
  });
});

describe('getExtFromContentType', () => {
  it('maps common image types', () => {
    expect(getExtFromContentType('image/jpeg')).toBe('jpg');
    expect(getExtFromContentType('image/png')).toBe('png');
    expect(getExtFromContentType('image/webp')).toBe('webp');
    expect(getExtFromContentType('image/gif')).toBe('gif');
    expect(getExtFromContentType('image/heic')).toBe('heic');
    expect(getExtFromContentType('image/heif')).toBe('heif');
  });

  it('defaults to jpg for unknown types', () => {
    expect(getExtFromContentType('image/bmp')).toBe('jpg');
    expect(getExtFromContentType('application/octet-stream')).toBe('jpg');
  });
});
