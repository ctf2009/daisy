const CLOUD_FILE_ERROR =
  'This photo could not be read from your device. It may still be downloading from iCloud or Photos. Open it in your gallery first, then try again.';

const FILE_PREVIEW_ERROR =
  'This photo could not be prepared for upload. Try opening it in Photos and uploading it again.';

const SUPPORTED_IMAGE_TYPE_BY_EXTENSION: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.heic': 'image/heic',
  '.heif': 'image/heif',
  '.avif': 'image/avif',
  '.bmp': 'image/bmp',
  '.tif': 'image/tiff',
  '.tiff': 'image/tiff',
  '.dng': 'image/x-adobe-dng',
};

const NORMALIZED_IMAGE_TYPE_BY_MIME: Record<string, string> = {
  'image/jpeg': 'image/jpeg',
  'image/jpg': 'image/jpeg',
  'image/pjpeg': 'image/jpeg',
  'image/png': 'image/png',
  'image/x-png': 'image/png',
  'image/webp': 'image/webp',
  'image/gif': 'image/gif',
  'image/heic': 'image/heic',
  'image/heif': 'image/heif',
  'image/avif': 'image/avif',
  'image/bmp': 'image/bmp',
  'image/x-ms-bmp': 'image/bmp',
  'image/tiff': 'image/tiff',
  'image/x-adobe-dng': 'image/x-adobe-dng',
  'image/dng': 'image/x-adobe-dng',
};

const HEIC_EXTENSIONS = ['.heic', '.heif'];
const EXOTIC_EXTENSIONS = ['.dng', '.tiff', '.tif'];

function getFileExtension(filename: string): string {
  const match = /\.[^.]+$/.exec(filename.toLowerCase());
  return match ? match[0] : '';
}

export function getSupportedImageMimeType(file: Pick<File, 'name' | 'type'>): string | null {
  const mimeType = file.type.toLowerCase();
  if (mimeType && NORMALIZED_IMAGE_TYPE_BY_MIME[mimeType]) {
    return NORMALIZED_IMAGE_TYPE_BY_MIME[mimeType];
  }

  const extension = getFileExtension(file.name);
  return SUPPORTED_IMAGE_TYPE_BY_EXTENSION[extension] ?? null;
}

export function isLikelySupportedImage(file: Pick<File, 'name' | 'type'>): boolean {
  return getSupportedImageMimeType(file) !== null;
}

const NEEDS_HEIC_CONVERSION = (file: File) =>
  file.type === 'image/heic' ||
  file.type === 'image/heif' ||
  HEIC_EXTENSIONS.some((ext) => file.name.toLowerCase().endsWith(ext));

const IS_EXOTIC = (file: File) =>
  EXOTIC_EXTENSIONS.some((ext) => file.name.toLowerCase().endsWith(ext)) ||
  file.type === 'image/tiff' ||
  file.type === 'image/x-adobe-dng' ||
  file.type === 'image/dng';

/**
 * Verifies a file is actually readable (not stuck downloading from iCloud/Google Photos).
 * Returns the file as an ArrayBuffer, or throws after timeout.
 */
export async function ensureFileReady(file: File, timeoutMs = 30000): Promise<ArrayBuffer> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;

  try {
    return await Promise.race([
      file.arrayBuffer().catch(() => {
        throw new Error(CLOUD_FILE_ERROR);
      }),
      new Promise<ArrayBuffer>((_, reject) => {
        timeoutId = setTimeout(() => reject(new Error(CLOUD_FILE_ERROR)), timeoutMs);
      }),
    ]);
  } catch (error) {
    if (error instanceof Error) {
      throw error;
    }
    throw new Error(CLOUD_FILE_ERROR);
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
}

/**
 * Converts a photo to JPEG if needed.
 * - HEIC/HEIF -> converted via heic2any
 * - Browser-native formats -> returned as-is
 * - Exotic formats (DNG, TIFF) -> returned as-is (uploaded in original format)
 */
export async function convertToJpeg(file: File): Promise<File> {
  if (NEEDS_HEIC_CONVERSION(file)) {
    try {
      const { default: heic2any } = await import('heic2any');
      const blob = await heic2any({
        blob: file,
        toType: 'image/jpeg',
        quality: 0.85,
      });
      const converted = Array.isArray(blob) ? blob[0] : blob;
      const newName = file.name.replace(/\.heic|\.heif/i, '.jpg');
      return new File([converted], newName, { type: 'image/jpeg' });
    } catch {
      throw new Error(
        'This HEIC photo could not be prepared for upload. Try exporting it as JPEG in Photos, then upload again.'
      );
    }
  }

  return file;
}

/**
 * Generates a thumbnail for the photo.
 * - Browser-renderable formats -> resized via canvas
 * - Exotic formats -> returns a small placeholder
 */
export async function generateThumbnail(file: File, maxSize = 400): Promise<Blob> {
  if (IS_EXOTIC(file)) {
    return generatePlaceholderThumbnail(file.name, maxSize);
  }

  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);

    img.onload = () => {
      URL.revokeObjectURL(url);

      const canvas = document.createElement('canvas');
      let { width, height } = img;

      if (width > height) {
        if (width > maxSize) {
          height = (height * maxSize) / width;
          width = maxSize;
        }
      } else if (height > maxSize) {
        width = (width * maxSize) / height;
        height = maxSize;
      }

      canvas.width = width;
      canvas.height = height;

      const ctx = canvas.getContext('2d');
      if (!ctx) {
        reject(new Error(FILE_PREVIEW_ERROR));
        return;
      }

      ctx.drawImage(img, 0, 0, width, height);
      canvas.toBlob(
        (blob) => {
          if (blob) {
            resolve(blob);
            return;
          }
          reject(new Error(FILE_PREVIEW_ERROR));
        },
        'image/jpeg',
        0.7,
      );
    };

    img.onerror = () => {
      URL.revokeObjectURL(url);
      generatePlaceholderThumbnail(file.name, maxSize)
        .then(resolve)
        .catch(() => reject(new Error(FILE_PREVIEW_ERROR)));
    };

    img.src = url;
  });
}

/**
 * Generates a simple placeholder thumbnail for formats
 * the browser can't render (DNG, TIFF, etc.)
 */
function generatePlaceholderThumbnail(filename: string, size: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      reject(new Error(FILE_PREVIEW_ERROR));
      return;
    }

    ctx.fillStyle = '#e8e8e8';
    ctx.fillRect(0, 0, size, size);

    const ext = filename.split('.').pop()?.toUpperCase() || '?';
    ctx.fillStyle = '#999';
    ctx.font = `bold ${Math.floor(size / 6)}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(ext, size / 2, size / 2);

    canvas.toBlob(
      (blob) => {
        if (blob) {
          resolve(blob);
          return;
        }
        reject(new Error(FILE_PREVIEW_ERROR));
      },
      'image/jpeg',
      0.8,
    );
  });
}
