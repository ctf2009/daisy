import { Hono } from 'hono';
import type { Bindings } from '../types';
import {
  extractBearerToken,
  issueAlbumAssetsToken,
  verifyAlbumAssetsToken,
  verifyAuthToken,
} from '../lib/auth';
import { generateId } from '../lib/tokens';
import { getPhotoKey, getThumbnailKey, getExtFromContentType } from '../lib/r2';
import { validateAccessCode, isValidImageType, sanitizeFilename } from '../lib/validation';

const MAX_PHOTO_SIZE = 50 * 1024 * 1024; // 50MB (accommodates ProRAW/DNG)
const MAX_THUMB_SIZE = 500 * 1024;       // 500KB
const MAX_PART_SIZE = 10 * 1024 * 1024;  // 10MB per multipart chunk
const ASSET_CACHE_CONTROL = 'private, max-age=21600';

export const uploadRoutes = new Hono<{ Bindings: Bindings }>();

async function deleteUploadRecord(c: { env: Bindings }, uploadId: string) {
  const upload = await c.env.DB.prepare(
    'SELECT r2_key, thumbnail_key FROM uploads WHERE id = ?'
  ).bind(uploadId).first<{ r2_key: string; thumbnail_key: string }>();

  if (!upload) {
    return;
  }

  await Promise.all([
    c.env.PHOTOS.delete(upload.r2_key),
    c.env.PHOTOS.delete(upload.thumbnail_key),
    c.env.DB.prepare('DELETE FROM upload_parts WHERE upload_id = ?').bind(uploadId).run(),
    c.env.DB.prepare('DELETE FROM uploads WHERE id = ?').bind(uploadId).run(),
  ]);
}

async function saveUploadedPart(
  c: { env: Bindings },
  uploadId: string,
  partNumber: number,
  etag: string,
) {
  const recordId = `${uploadId}:${partNumber}`;
  const existing = await c.env.DB.prepare(
    'SELECT id FROM upload_parts WHERE id = ?'
  ).bind(recordId).first<{ id: string }>();

  if (existing) {
    await c.env.DB.prepare(
      'UPDATE upload_parts SET etag = ? WHERE id = ?'
    ).bind(etag, recordId).run();
    return;
  }

  await c.env.DB.prepare(
    'INSERT INTO upload_parts (id, upload_id, part_number, etag) VALUES (?, ?, ?, ?)'
  ).bind(recordId, uploadId, partNumber, etag).run();
}

async function requireAssetAccess(
  c: { req: { header(name: string): string | undefined; query(key: string): string | undefined }; env: Bindings },
  albumSlug: string
) {
  const bearerToken = extractBearerToken(c.req.header('Authorization'));
  if (bearerToken) {
    await verifyAuthToken(bearerToken, c.env);
    return;
  }

  const assetToken = c.req.query('token');
  if (!assetToken) {
    throw new Error('Unauthorized');
  }

  await verifyAlbumAssetsToken(assetToken, albumSlug, c.env);
}

// Request upload URL (guest-facing, validates access code if needed)
uploadRoutes.post('/albums/:slug/upload', async (c) => {
  const slug = c.req.param('slug');
  const { access_code, content_type, filename, content_hash } = await c.req.json<{
    access_code?: string;
    content_type: string;
    filename: string;
    content_hash?: string;
  }>();

  if (!content_type || !filename) {
    return c.json({ error: 'content_type and filename required' }, 400);
  }

  if (!isValidImageType(content_type)) {
    return c.json({ error: 'Unsupported image type' }, 400);
  }

  const album = await c.env.DB.prepare(
    'SELECT id, access_code, is_open FROM albums WHERE slug = ?'
  ).bind(slug).first<{ id: string; access_code: string | null; is_open: number }>();

  if (!album) {
    return c.json({ error: 'Album not found' }, 404);
  }

  if (!album.is_open) {
    return c.json({ error: 'This album is no longer accepting photos' }, 403);
  }

  if (!validateAccessCode(album.access_code, access_code)) {
    return c.json({ error: 'Invalid access code' }, 403);
  }

  // Check for duplicate
  if (content_hash) {
    const existing = await c.env.DB.prepare(
      'SELECT id FROM uploads WHERE album_id = ? AND content_hash = ? AND file_size IS NOT NULL'
    ).bind(album.id, content_hash).first<{ id: string }>();

    if (existing) {
      return c.json({ duplicate: true, existing_id: existing.id }, 200);
    }
  }

  const safeName = sanitizeFilename(filename);
  const uploadId = generateId();
  const ext = getExtFromContentType(content_type);
  const r2Key = getPhotoKey(slug, uploadId, ext);
  const thumbnailKey = getThumbnailKey(slug, uploadId);

  // Initiate R2 multipart upload
  const multipart = await c.env.PHOTOS.createMultipartUpload(r2Key, {
    httpMetadata: { contentType: content_type },
  });

  await c.env.DB.prepare(
    `INSERT INTO uploads (id, album_id, r2_key, thumbnail_key, original_filename, content_type, content_hash, multipart_upload_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(uploadId, album.id, r2Key, thumbnailKey, safeName, content_type, content_hash || null, multipart.uploadId).run();

  return c.json({
    upload_id: uploadId,
    r2_key: r2Key,
    thumbnail_key: thumbnailKey,
    multipart_upload_id: multipart.uploadId,
  });
});

// Upload the actual photo file
uploadRoutes.put('/uploads/:uploadId/file', async (c) => {
  const uploadId = c.req.param('uploadId');

  const upload = await c.env.DB.prepare(
    'SELECT r2_key, content_type FROM uploads WHERE id = ?'
  ).bind(uploadId).first<{ r2_key: string; content_type: string }>();

  if (!upload) {
    return c.json({ error: 'Upload not found' }, 404);
  }

  const contentLength = parseInt(c.req.header('Content-Length') || '0');
  if (contentLength > MAX_PHOTO_SIZE) {
    await deleteUploadRecord(c, uploadId);
    return c.json({ error: `File too large. Max ${MAX_PHOTO_SIZE / 1024 / 1024}MB` }, 413);
  }

  const body = c.req.raw.body;
  if (!body) {
    await deleteUploadRecord(c, uploadId);
    return c.json({ error: 'No file body' }, 400);
  }

  // Read and verify actual size
  const arrayBuf = await c.req.arrayBuffer();
  if (arrayBuf.byteLength > MAX_PHOTO_SIZE) {
    await deleteUploadRecord(c, uploadId);
    return c.json({ error: `File too large. Max ${MAX_PHOTO_SIZE / 1024 / 1024}MB` }, 413);
  }

  try {
    await c.env.PHOTOS.put(upload.r2_key, arrayBuf, {
      httpMetadata: { contentType: upload.content_type },
    });

    await c.env.DB.prepare(
      'UPDATE uploads SET file_size = ? WHERE id = ?'
    ).bind(arrayBuf.byteLength, uploadId).run();
  } catch (err) {
    await deleteUploadRecord(c, uploadId);
    throw err;
  }

  return c.json({ ok: true });
});

// Upload a multipart chunk
uploadRoutes.put('/uploads/:uploadId/part/:partNumber', async (c) => {
  const uploadId = c.req.param('uploadId');
  const partNumber = parseInt(c.req.param('partNumber'));

  if (!partNumber || partNumber < 1) {
    return c.json({ error: 'Invalid part number' }, 400);
  }

  const upload = await c.env.DB.prepare(
    'SELECT r2_key, multipart_upload_id FROM uploads WHERE id = ?'
  ).bind(uploadId).first<{ r2_key: string; multipart_upload_id: string | null }>();

  if (!upload || !upload.multipart_upload_id) {
    return c.json({ error: 'Upload not found or not multipart' }, 404);
  }

  const contentLength = parseInt(c.req.header('Content-Length') || '0');
  if (contentLength > MAX_PART_SIZE) {
    return c.json({ error: `Part too large. Max ${MAX_PART_SIZE / 1024 / 1024}MB` }, 413);
  }

  const body = c.req.raw.body;
  if (!body) {
    return c.json({ error: 'No body' }, 400);
  }

  const arrayBuf = await c.req.arrayBuffer();

  const multipart = c.env.PHOTOS.resumeMultipartUpload(upload.r2_key, upload.multipart_upload_id);
  const part = await multipart.uploadPart(partNumber, arrayBuf);
  await saveUploadedPart(c, uploadId, part.partNumber, part.etag);

  return new Response(null, {
    status: 204,
    headers: {
      ETag: part.etag,
    },
  });
});

// List uploaded parts for a multipart upload
uploadRoutes.get('/uploads/:uploadId/parts', async (c) => {
  const uploadId = c.req.param('uploadId');

  const upload = await c.env.DB.prepare(
    'SELECT multipart_upload_id FROM uploads WHERE id = ?'
  ).bind(uploadId).first<{ multipart_upload_id: string | null }>();

  if (!upload || !upload.multipart_upload_id) {
    return c.json({ error: 'Upload not found or not multipart' }, 404);
  }

  const result = await c.env.DB.prepare(
    'SELECT part_number, etag FROM upload_parts WHERE upload_id = ?'
  ).bind(uploadId).all<{
    part_number: number;
    etag: string;
  }>();

  const parts = result.results
    .map((part) => ({
      PartNumber: part.part_number,
      ETag: part.etag,
    }))
    .sort((a, b) => a.PartNumber - b.PartNumber);

  return c.json({ parts });
});

// Complete multipart upload
uploadRoutes.post('/uploads/:uploadId/complete', async (c) => {
  const uploadId = c.req.param('uploadId');
  const body = await c.req.json<{
    parts: Array<{ partNumber?: number; PartNumber?: number; etag?: string; ETag?: string }>;
  }>();

  if (!body.parts?.length) {
    return c.json({ error: 'Parts array required' }, 400);
  }

  const normalizedParts = body.parts.map((p) => ({
    partNumber: p.partNumber ?? p.PartNumber ?? 0,
    etag: p.etag ?? p.ETag ?? '',
  })).filter((part) => part.partNumber > 0 && part.etag);

  if (normalizedParts.length === 0) {
    return c.json({ error: 'Valid parts are required' }, 400);
  }

  const upload = await c.env.DB.prepare(
    'SELECT r2_key, multipart_upload_id FROM uploads WHERE id = ?'
  ).bind(uploadId).first<{ r2_key: string; multipart_upload_id: string | null }>();

  if (!upload || !upload.multipart_upload_id) {
    return c.json({ error: 'Upload not found or not multipart' }, 404);
  }

  const multipart = c.env.PHOTOS.resumeMultipartUpload(upload.r2_key, upload.multipart_upload_id);
  const obj = await multipart.complete(
    normalizedParts.sort((a, b) => a.partNumber - b.partNumber)
  );

  await c.env.DB.prepare(
    'UPDATE uploads SET file_size = ?, multipart_upload_id = ? WHERE id = ?'
  ).bind(obj.size, null, uploadId).run();
  await c.env.DB.prepare('DELETE FROM upload_parts WHERE upload_id = ?').bind(uploadId).run();

  return c.json({ ok: true, size: obj.size });
});

// Abort multipart upload
uploadRoutes.delete('/uploads/:uploadId/abort', async (c) => {
  const uploadId = c.req.param('uploadId');

  const upload = await c.env.DB.prepare(
    'SELECT r2_key, multipart_upload_id FROM uploads WHERE id = ?'
  ).bind(uploadId).first<{ r2_key: string; multipart_upload_id: string | null }>();

  if (!upload) {
    return c.json({ error: 'Upload not found' }, 404);
  }

  if (upload.multipart_upload_id) {
    try {
      const multipart = c.env.PHOTOS.resumeMultipartUpload(upload.r2_key, upload.multipart_upload_id);
      await multipart.abort();
    } catch {
      // Multipart may already be completed or expired
    }
  }

  await deleteUploadRecord(c, uploadId);

  return c.json({ ok: true });
});

// Upload thumbnail
uploadRoutes.put('/uploads/:uploadId/thumbnail', async (c) => {
  const uploadId = c.req.param('uploadId');

  const upload = await c.env.DB.prepare(
    'SELECT thumbnail_key, r2_key FROM uploads WHERE id = ?'
  ).bind(uploadId).first<{ thumbnail_key: string; r2_key: string }>();

  if (!upload) {
    return c.json({ error: 'Upload not found' }, 404);
  }

  const contentLength = parseInt(c.req.header('Content-Length') || '0');
  if (contentLength > MAX_THUMB_SIZE) {
    return c.json({ error: `Thumbnail too large. Max ${MAX_THUMB_SIZE / 1024}KB` }, 413);
  }

  const body = c.req.raw.body;
  if (!body) {
    return c.json({ error: 'No file body' }, 400);
  }

  const arrayBuf = await c.req.arrayBuffer();
  if (arrayBuf.byteLength > MAX_THUMB_SIZE) {
    return c.json({ error: `Thumbnail too large. Max ${MAX_THUMB_SIZE / 1024}KB` }, 413);
  }

  await c.env.PHOTOS.put(upload.thumbnail_key, arrayBuf, {
    httpMetadata: { contentType: 'image/jpeg' },
  });

  return c.json({ ok: true });
});

// Get photo (serves from R2)
uploadRoutes.get('/uploads/:uploadId/photo', async (c) => {
  const uploadId = c.req.param('uploadId');

  const upload = await c.env.DB.prepare(
    `SELECT uploads.r2_key, uploads.content_type, albums.slug
     FROM uploads
     JOIN albums ON albums.id = uploads.album_id
     WHERE uploads.id = ?`
  ).bind(uploadId).first<{ r2_key: string; content_type: string; slug: string }>();

  if (!upload) {
    return c.json({ error: 'Not found' }, 404);
  }

  try {
    await requireAssetAccess(c, upload.slug);
  } catch {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  const obj = await c.env.PHOTOS.get(upload.r2_key);
  if (!obj) {
    return c.json({ error: 'File not found' }, 404);
  }

  return new Response(obj.body, {
    headers: {
      'Content-Type': upload.content_type,
      'Cache-Control': ASSET_CACHE_CONTROL,
    },
  });
});

// Get thumbnail
uploadRoutes.get('/uploads/:uploadId/thumbnail', async (c) => {
  const uploadId = c.req.param('uploadId');

  const upload = await c.env.DB.prepare(
    `SELECT uploads.thumbnail_key, uploads.r2_key, albums.slug
     FROM uploads
     JOIN albums ON albums.id = uploads.album_id
     WHERE uploads.id = ?`
  ).bind(uploadId).first<{ thumbnail_key: string; r2_key: string; slug: string }>();

  if (!upload) {
    return c.json({ error: 'Not found' }, 404);
  }

  try {
    await requireAssetAccess(c, upload.slug);
  } catch {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  const obj = await c.env.PHOTOS.get(upload.thumbnail_key);
  if (obj) {
    return new Response(obj.body, {
      headers: {
        'Content-Type': 'image/jpeg',
        'Cache-Control': ASSET_CACHE_CONTROL,
      },
    });
  }

  const original = await c.env.PHOTOS.get(upload.r2_key);
  if (!original) {
    return c.json({ error: 'File not found' }, 404);
  }

  return new Response(original.body, {
    headers: {
      'Content-Type': original.httpMetadata?.contentType || 'image/jpeg',
      'Cache-Control': ASSET_CACHE_CONTROL,
    },
  });
});

// Get all photos for an album
uploadRoutes.get('/albums/:slug/photos', async (c) => {
  const slug = c.req.param('slug');
  const { access_code } = c.req.query();

  const album = await c.env.DB.prepare(
    'SELECT id, access_code, is_viewable FROM albums WHERE slug = ?'
  ).bind(slug).first<{ id: string; access_code: string | null; is_viewable: number }>();

  if (!album) {
    return c.json({ error: 'Album not found' }, 404);
  }

  const hasValidCode = validateAccessCode(album.access_code, access_code);
  if (album.access_code && !hasValidCode) {
    return c.json({ error: 'Invalid access code' }, 403);
  }

  if (!album.access_code && !album.is_viewable) {
    return c.json({ error: 'This gallery is not available' }, 403);
  }

  const uploads = await c.env.DB.prepare(
    'SELECT id, original_filename, content_type, file_size, uploaded_at FROM uploads WHERE album_id = ? ORDER BY uploaded_at DESC'
  ).bind(album.id).all();
  const albumAssetToken = await issueAlbumAssetsToken(slug, c.env);
  const photos = uploads.results
    .filter((upload) => typeof upload.file_size === 'number')
    .map(({ file_size, ...upload }) => upload);

  return c.json({
    asset_token: albumAssetToken,
    photos,
  });
});
