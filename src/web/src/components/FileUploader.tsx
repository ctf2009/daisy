import { useState, useRef } from 'react';
import { api } from '../lib/api';
import { convertToJpeg, generateThumbnail } from '../lib/imageUtils';

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

export function FileUploader({ slug, accessCode, onUploadComplete }: Props) {
  const [uploads, setUploads] = useState<UploadItem[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const updateItem = (id: string, updates: Partial<UploadItem>) => {
    setUploads((prev) =>
      prev.map((item) => (item.id === id ? { ...item, ...updates } : item))
    );
  };

  const processFile = async (item: UploadItem) => {
    try {
      // Convert HEIC if needed
      updateItem(item.id, { status: 'converting' });
      const converted = await convertToJpeg(item.file);

      // Generate thumbnail
      const thumbnail = await generateThumbnail(converted);

      // Request upload slot
      updateItem(item.id, { status: 'uploading', progress: 10 });
      const { upload_id } = await api.requestUpload(slug, {
        content_type: converted.type,
        filename: converted.name,
        access_code: accessCode,
      });

      // Upload file
      updateItem(item.id, { progress: 30 });
      await api.uploadFile(upload_id, converted, converted.type);

      // Upload thumbnail
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
    const imageExtensions = ['.heic', '.heif', '.dng', '.tiff', '.tif', '.avif', '.bmp'];
    const fileArray = Array.from(files).filter((f) =>
      f.type.startsWith('image/') ||
      imageExtensions.some(ext => f.name.toLowerCase().endsWith(ext))
    );

    if (fileArray.length === 0) return;

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

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    handleFiles(e.dataTransfer.files);
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
        onClick={() => fileInputRef.current?.click()}
      >
        <div className="drop-zone-content">
          <span className="drop-icon">📷</span>
          <p>Tap to select photos or drag & drop</p>
          <p className="drop-hint">Supports JPEG, PNG, HEIC, WebP, AVIF, TIFF, DNG</p>
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*,.heic,.heif,.dng,.tiff,.tif"
          multiple
          onChange={(e) => e.target.files && handleFiles(e.target.files)}
          style={{ display: 'none' }}
        />
      </div>

      {uploads.length > 0 && (
        <div className="upload-list">
          <p className="upload-summary">
            {completedCount} of {totalCount} uploaded
          </p>
          {uploads.map((item) => (
            <div key={item.id} className={`upload-item ${item.status}`}>
              <span className="upload-name">{item.file.name}</span>
              <div className="upload-status">
                {item.status === 'converting' && <span>Converting...</span>}
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
