export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}

export function validateAccessCode(required: string | null, provided?: string): boolean {
  if (!required) return true;
  if (!provided) return false;
  return timingSafeEqual(required, provided);
}

const ALLOWED_IMAGE_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/heic',
  'image/heif',
  'image/avif',       // Newer Android phones
  'image/bmp',        // Rare but possible
  'image/tiff',       // Some camera workflows
  'image/x-adobe-dng', // iPhone ProRAW
  'image/dng',        // iPhone ProRAW (alternate mime)
]);

export function isValidImageType(contentType: string): boolean {
  return ALLOWED_IMAGE_TYPES.has(contentType);
}

export function sanitizeFilename(filename: string): string {
  return filename
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    .replace(/\.{2,}/g, '.')
    .slice(0, 255);
}
