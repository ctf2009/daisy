import { useEffect, useRef, useState } from 'react';
import { api } from '../lib/api';
import {
  convertToJpeg,
  ensureFileReady,
  generateThumbnail,
  getSupportedImageMimeType,
  isLikelySupportedImage,
} from '../lib/imageUtils';

type UploadItem = {
  id: string;
  file: File;
  status: 'pending' | 'converting' | 'uploading' | 'done' | 'error';
  progress: number;
  error?: string;
};

type Props = {
  slug: string;
  accessCode?: string;
  onUploadComplete?: () => void;
};

const UNSUPPORTED_IMAGE_MESSAGE =
  'This item is not a supported photo. Please choose JPEG, PNG, HEIC, WebP, GIF, AVIF, BMP, TIFF, or DNG files.';

function normalizeImageFile(file: File): File {
  const mimeType = getSupportedImageMimeType(file);
  if (!mimeType) {
    throw new Error(UNSUPPORTED_IMAGE_MESSAGE);
  }

  if (file.type === mimeType) {
    return file;
  }

  return new File([file], file.name, {
    type: mimeType,
    lastModified: file.lastModified,
  });
}

export function FileUploader({ slug, accessCode, onUploadComplete }: Props) {
  const [uploads, setUploads] = useState<UploadItem[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [selectionNotice, setSelectionNotice] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const updateItem = (id: string, updates: Partial<UploadItem>) => {
    setUploads((prev) =>
      prev.map((item) => (item.id === id ? { ...item, ...updates } : item))
    );
  };

  const processFile = async (item: UploadItem) => {
    try {
      updateItem(item.id, { status: 'converting' });
      await ensureFileReady(item.file);
      const normalizedOriginal = normalizeImageFile(item.file);

      const converted = await convertToJpeg(normalizedOriginal);
      const uploadFile = normalizeImageFile(converted);

      const thumbnail = await generateThumbnail(uploadFile);

      updateItem(item.id, { status: 'uploading', progress: 10 });
      const { upload_id } = await api.requestUpload(slug, {
        content_type: uploadFile.type,
        filename: uploadFile.name,
        access_code: accessCode,
      });

      updateItem(item.id, { progress: 30 });
      await api.uploadFile(upload_id, uploadFile, uploadFile.type);

      updateItem(item.id, { progress: 80 });
      await api.uploadThumbnail(upload_id, thumbnail);

      updateItem(item.id, { status: 'done', progress: 100 });
    } catch (err) {
      updateItem(item.id, {
        status: 'error',
        error: err instanceof Error ? err.message : 'Upload failed',
      });
    }
  };

  const handleFiles = async (files: FileList | File[]) => {
    const selectedFiles = Array.from(files);
    const fileArray = selectedFiles.filter((file) => isLikelySupportedImage(file));
    const skippedCount = selectedFiles.length - fileArray.length;

    if (skippedCount > 0) {
      setSelectionNotice(
        skippedCount === 1
          ? '1 selected item was skipped because Safari did not provide a supported image file.'
          : `${skippedCount} selected items were skipped because Safari did not provide supported image files.`
      );
    } else {
      setSelectionNotice(null);
    }

    if (fileArray.length === 0) return;

    const MAX_BATCH = 15;
    if (fileArray.length > MAX_BATCH) {
      alert(`Please select up to ${MAX_BATCH} photos at a time.`);
      return;
    }

    const newItems: UploadItem[] = fileArray.map((file) => ({
      id: crypto.randomUUID(),
      file,
      status: 'pending' as const,
      progress: 0,
    }));

    setUploads((prev) => [...prev, ...newItems]);

    // Process uploads concurrently (max 3 at a time)
    const queue = [...newItems];
    const concurrency = 3;

    const runNext = async () => {
      const item = queue.shift();
      if (!item) return;
      await processFile(item);
      await runNext();
    };

    await Promise.all(
      Array.from({ length: Math.min(concurrency, queue.length) }, () => runNext())
    );

    onUploadComplete?.();
  };

  const handleInputChange = (input: HTMLInputElement) => {
    if (input.files?.length) {
      void handleFiles(input.files);
    }
    input.value = '';
  };

  useEffect(() => {
    const input = inputRef.current;
    if (!input) return;

    const handleNativeSelection = () => handleInputChange(input);

    input.addEventListener('change', handleNativeSelection);
    input.addEventListener('input', handleNativeSelection);

    return () => {
      input.removeEventListener('change', handleNativeSelection);
      input.removeEventListener('input', handleNativeSelection);
    };
  }, []);

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    void handleFiles(e.dataTransfer.files);
  };

  const completedCount = uploads.filter((u) => u.status === 'done').length;
  const totalCount = uploads.length;

  return (
    <div className="file-uploader">
      <div
        className={`drop-zone ${isDragging ? 'dragging' : ''}`}
        onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={handleDrop}
      >
        <div className="drop-zone-content">
          <span className="drop-icon">📷</span>
          <p>Tap to select photos</p>
          <p className="drop-hint">Supports JPEG, PNG, HEIC, WebP and more</p>
        </div>
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          multiple
          aria-label="Select photos to upload"
          onChange={(e) => handleInputChange(e.currentTarget)}
          className="file-input-overlay"
        />
      </div>

      {selectionNotice && <p className="drop-hint">{selectionNotice}</p>}

      {uploads.length > 0 && (
        <div className="upload-list">
          <p className="upload-summary">
            {completedCount} of {totalCount} uploaded
          </p>
          {uploads.map((item) => (
            <div key={item.id} className={`upload-item ${item.status}`}>
              <span className="upload-name">{item.file.name}</span>
              <div className="upload-status">
                {item.status === 'converting' && <span>Processing...</span>}
                {item.status === 'uploading' && (
                  <div className="progress-bar">
                    <div
                      className="progress-fill"
                      style={{ width: `${item.progress}%` }}
                    />
                  </div>
                )}
                {item.status === 'done' && <span className="check">✓</span>}
                {item.status === 'error' && (
                  <span className="error-text">{item.error}</span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
