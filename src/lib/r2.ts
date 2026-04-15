export function getPhotoKey(albumSlug: string, uploadId: string, ext: string): string {
  return `${albumSlug}/${uploadId}.${ext}`;
}

export function getThumbnailKey(albumSlug: string, uploadId: string): string {
  return `${albumSlug}/thumbs/${uploadId}.jpg`;
}

export function getExtFromContentType(contentType: string): string {
  const map: Record<string, string> = {
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
    'image/gif': 'gif',
    'image/heic': 'heic',
    'image/heif': 'heif',
    'image/avif': 'avif',
    'image/bmp': 'bmp',
    'image/tiff': 'tiff',
    'image/x-adobe-dng': 'dng',
    'image/dng': 'dng',
  };
  return map[contentType] || 'jpg';
}
