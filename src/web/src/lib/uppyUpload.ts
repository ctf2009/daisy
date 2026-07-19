const API_BASE = import.meta.env.DEV ? 'http://localhost:8787' : '';

type ProgressCallback = (progress: number) => void;

type UploadPartOptions = {
  signature: { url: string; method?: string; headers?: Record<string, string> };
  body: Blob;
  size?: number;
  onProgress?: (event: { loaded: number; lengthComputable: boolean }) => void;
  onComplete?: (etag: string) => void;
  signal?: AbortSignal;
};

// Re-send delays (ms) for a chunk the server rejects as truncated
// (code: 'incomplete_upload'). Uppy's built-in retry treats any 4xx as
// permanent, so we handle this specific, recoverable case ourselves.
const INCOMPLETE_RETRY_DELAYS = [500, 1500, 4000];

// A single attempt at PUTing one chunk. Rejects with an Error that carries
// `.code` (from the server's JSON body) so the caller can decide to retry.
function sendPartOnce(options: UploadPartOptions): Promise<{ ETag: string }> {
  const { signature, body, size, onProgress, onComplete, signal } = options;
  const xhr = new XMLHttpRequest();

  return new Promise<{ ETag: string }>((resolveUpload, rejectUpload) => {
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

    xhr.addEventListener('load', () => {
      cleanup();

      if (xhr.status < 200 || xhr.status >= 300) {
        let message = `HTTP ${xhr.status}`;
        let code: string | undefined;
        try {
          const bodyText = xhr.responseText;
          if (bodyText) {
            const parsed = JSON.parse(bodyText) as { error?: string; code?: string };
            if (parsed.error) message = parsed.error;
            if (parsed.code) code = parsed.code;
          }
        } catch {
          // Ignore JSON parsing failures and keep the HTTP message.
        }

        const error = new Error(message) as Error & { source?: XMLHttpRequest; code?: string };
        error.source = xhr;
        error.code = code;
        rejectUpload(error);
        return;
      }

      onProgress?.({ loaded: size ?? body.size, lengthComputable: true });
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
}

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

      async uploadPartBytes(options) {
        // The server rejects a chunk that arrived short (code: 'incomplete_upload')
        // rather than storing a truncated photo. That's a recoverable transient —
        // re-send the chunk a few times before surfacing the failure. (Uppy's own
        // retry logic treats 4xx as permanent and would not retry this.)
        let attempt = 0;
        for (;;) {
          try {
            return await sendPartOnce(options as unknown as UploadPartOptions);
          } catch (err) {
            const code = (err as { code?: string })?.code;
            if (
              code === 'incomplete_upload' &&
              attempt < INCOMPLETE_RETRY_DELAYS.length &&
              !options.signal?.aborted
            ) {
              await new Promise((r) => setTimeout(r, INCOMPLETE_RETRY_DELAYS[attempt]));
              attempt += 1;
              continue;
            }
            throw err;
          }
        }
      },

      async completeMultipartUpload(_file, { parts }) {
        const res = await fetch(`${API_BASE}/api/uploads/${uploadId}/complete`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          // Send the total size so the server can verify the assembled object
          // matches end-to-end before finalising (catches a dropped part).
          body: JSON.stringify({ parts, total_size: file.size }),
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
