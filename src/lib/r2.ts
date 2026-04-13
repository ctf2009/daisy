export function getPhotoKey(albumId: string, uploadId: string, ext: string): string {
  return `${albumId}/${uploadId}.${ext}`;
}

export function getThumbnailKey(albumId: string, uploadId: string): string {
  return `${albumId}/thumbs/${uploadId}.jpg`;
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
