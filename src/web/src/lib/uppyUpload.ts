const API_BASE = import.meta.env.DEV ? 'http://localhost:8787' : '';

type ProgressCallback = (progress: number) => void;

/**
 * Uploads a file using Uppy's multipart flow, while proxying each part through our Worker.
 */
export async function uploadFileMultipart(
  uploadId: string,
  multipartUploadId: string,
  r2Key: string,
  file: File | Blob,
  onProgress?: ProgressCallback,
): Promise<void> {
  const [{ default: Uppy }, { default: AwsS3 }] = await Promise.all([
    import('@uppy/core'),
    import('@uppy/aws-s3'),
  ]);

  return new Promise((resolve, reject) => {
    const uppy = new Uppy({
      autoProceed: true,
      restrictions: {
        maxFileSize: 50 * 1024 * 1024,
        maxNumberOfFiles: 1,
      },
    });

    uppy.use(AwsS3, {
      shouldUseMultipart: true,
      getChunkSize: () => 5 * 1024 * 1024,
      retryDelays: [0, 1000, 3000, 5000, 10000],
      limit: 3,

      async createMultipartUpload() {
        return { uploadId: multipartUploadId, key: r2Key };
      },

      async listParts() {
        const res = await fetch(`${API_BASE}/api/uploads/${uploadId}/parts`);
        if (!res.ok) {
          const body = await res.json().catch(() => ({ error: 'Failed to list parts' }));
          throw new Error((body as { error?: string }).error || `HTTP ${res.status}`);
        }

        const body = await res.json() as {
          parts: Array<{ PartNumber?: number; ETag?: string }>;
        };

        return body.parts;
      },

      async signPart(_file, { partNumber }) {
        return {
          url: `${API_BASE}/api/uploads/${uploadId}/part/${partNumber}`,
          method: 'PUT' as const,
          headers: {
            'Content-Type': 'application/octet-stream',
          },
        };
      },

      async uploadPartBytes({ signature, body, size, onProgress, onComplete, signal }) {
        const xhr = new XMLHttpRequest();

        return await new Promise<{ ETag: string }>((resolveUpload, rejectUpload) => {
          xhr.open(signature.method ?? 'PUT', signature.url, true);

          if (signature.headers) {
            Object.entries(signature.headers).forEach(([key, value]) => {
              xhr.setRequestHeader(key, value);
            });
          }

          function cleanup() {
            signal?.removeEventListener('abort', abortRequest);
          }

          function abortRequest() {
            xhr.abort();
          }

          signal?.addEventListener('abort', abortRequest);

          xhr.upload.addEventListener('progress', (event) => {
            onProgress?.(event);
          });

          xhr.addEventListener('abort', () => {
            cleanup();
            rejectUpload(new DOMException('Upload aborted', 'AbortError'));
          });

          xhr.addEventListener('error', () => {
            cleanup();
            const error = new Error('Unknown error');
            (error as Error & { source?: XMLHttpRequest }).source = xhr;
            rejectUpload(error);
          });

          xhr.addEventListener('load', async () => {
            cleanup();

            if (xhr.status < 200 || xhr.status >= 300) {
              let message = `HTTP ${xhr.status}`;
              try {
                const bodyText = xhr.responseText;
                if (bodyText) {
                  const parsed = JSON.parse(bodyText) as { error?: string };
                  if (parsed.error) {
                    message = parsed.error;
                  }
                }
              } catch {
                // Ignore JSON parsing failures and keep the HTTP message.
              }

              const error = new Error(message);
              (error as Error & { source?: XMLHttpRequest }).source = xhr;
              rejectUpload(error);
              return;
            }

            onProgress?.({ loaded: size ?? (body as Blob).size, lengthComputable: true });
            const etag = xhr.getResponseHeader('etag') ?? xhr.getResponseHeader('ETag');
            if (!etag) {
              const error = new Error('Missing ETag from multipart upload response');
              (error as Error & { source?: XMLHttpRequest }).source = xhr;
              rejectUpload(error);
              return;
            }

            onComplete?.(etag);
            resolveUpload({ ETag: etag });
          });

          xhr.send(body);
        });
      },

      async completeMultipartUpload(_file, { parts }) {
        const res = await fetch(`${API_BASE}/api/uploads/${uploadId}/complete`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ parts }),
        });

        if (!res.ok) {
          const body = await res.json().catch(() => ({ error: 'Complete failed' }));
          throw new Error((body as { error?: string }).error || `HTTP ${res.status}`);
        }

        return {};
      },

      async abortMultipartUpload() {
        await fetch(`${API_BASE}/api/uploads/${uploadId}/abort`, {
          method: 'DELETE',
        }).catch(() => {});
      },
    });

    uppy.on('upload-progress', (_file, progress) => {
      if (progress.bytesTotal && progress.bytesTotal > 0) {
        const pct = Math.round((progress.bytesUploaded / progress.bytesTotal) * 100);
        onProgress?.(pct);
      }
    });

    uppy.on('upload-success', () => {
      onProgress?.(100);
      uppy.destroy();
      resolve();
    });

    uppy.on('upload-error', (_file, error) => {
      uppy.destroy();
      reject(error);
    });

    uppy.on('error', (error) => {
      uppy.destroy();
      reject(error);
    });

    const name = file instanceof File ? file.name : 'photo.jpg';
    const type = file instanceof File ? file.type : 'image/jpeg';

    try {
      uppy.addFile({
        name,
        type,
        data: file,
        source: 'daisy',
      });
    } catch (err) {
      uppy.destroy();
      reject(err);
    }
  });
}
