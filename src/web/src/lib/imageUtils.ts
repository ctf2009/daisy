const HEIC_EXTENSIONS = ['.heic', '.heif'];
const NEEDS_HEIC_CONVERSION = (file: File) =>
  file.type === 'image/heic' || file.type === 'image/heif' ||
  HEIC_EXTENSIONS.some(ext => file.name.toLowerCase().endsWith(ext));

// Formats the browser can render natively via <img> + canvas
const BROWSER_NATIVE = new Set([
  'image/jpeg', 'image/png', 'image/webp', 'image/gif',
  'image/bmp', 'image/avif',
]);

// Formats that need special conversion (can't be rendered by canvas)
const EXOTIC_EXTENSIONS = ['.dng', '.tiff', '.tif'];
const IS_EXOTIC = (file: File) =>
  EXOTIC_EXTENSIONS.some(ext => file.name.toLowerCase().endsWith(ext)) ||
  file.type === 'image/tiff' || file.type === 'image/x-adobe-dng' || file.type === 'image/dng';

/**
 * Converts a photo to JPEG if needed.
 * - HEIC/HEIF → converted via heic2any
 * - Browser-native formats → returned as-is
 * - Exotic formats (DNG, TIFF) → returned as-is (uploaded in original format)
 */
export async function convertToJpeg(file: File): Promise<File> {
  if (NEEDS_HEIC_CONVERSION(file)) {
    const { default: heic2any } = await import('heic2any');
    const blob = await heic2any({
      blob: file,
      toType: 'image/jpeg',
      quality: 0.85,
    });
    const converted = Array.isArray(blob) ? blob[0] : blob;
    const newName = file.name.replace(/\.heic|\.heif/i, '.jpg');
    return new File([converted], newName, { type: 'image/jpeg' });
  }

  return file;
}

/**
 * Generates a thumbnail for the photo.
 * - Browser-renderable formats → resized via canvas
 * - Exotic formats → returns a small placeholder
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
      } else {
        if (height > maxSize) {
          width = (width * maxSize) / height;
          height = maxSize;
        }
      }

      canvas.width = width;
      canvas.height = height;

      const ctx = canvas.getContext('2d');
      if (!ctx) {
        reject(new Error('Could not get canvas context'));
        return;
      }

      ctx.drawImage(img, 0, 0, width, height);
      canvas.toBlob(
        (blob) => {
          if (blob) resolve(blob);
          else reject(new Error('Failed to create thumbnail'));
        },
        'image/jpeg',
        0.7,
      );
    };

    img.onerror = () => {
      URL.revokeObjectURL(url);
      // If the browser can't render it, fall back to placeholder
      generatePlaceholderThumbnail(file.name, maxSize).then(resolve).catch(reject);
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
    if (!ctx) { reject(new Error('No canvas context')); return; }

    // Light grey background
    ctx.fillStyle = '#e8e8e8';
    ctx.fillRect(0, 0, size, size);

    // File extension label
    const ext = filename.split('.').pop()?.toUpperCase() || '?';
    ctx.fillStyle = '#999';
    ctx.font = `bold ${Math.floor(size / 6)}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(ext, size / 2, size / 2);

    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob);
        else reject(new Error('Failed to create placeholder'));
      },
      'image/jpeg',
      0.8,
    );
  });
}
