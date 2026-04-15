import { Hono } from 'hono';
import type { Bindings } from '../types';
import { generateId } from '../lib/tokens';
import { getPhotoKey, getThumbnailKey, getExtFromContentType } from '../lib/r2';
import { validateAccessCode, isValidImageType, sanitizeFilename } from '../lib/validation';

const MAX_PHOTO_SIZE = 50 * 1024 * 1024; // 50MB (accommodates ProRAW/DNG)
const MAX_THUMB_SIZE = 500 * 1024;       // 500KB

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
    c.env.DB.prepare('DELETE FROM uploads WHERE id = ?').bind(uploadId).run(),
  ]);
}

// Request upload URL (guest-facing, validates access code if needed)
uploadRoutes.post('/albums/:slug/upload', async (c) => {
  const slug = c.req.param('slug');
  const { access_code, content_type, filename } = await c.req.json<{
    access_code?: string;
    content_type: string;
    filename: string;
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

  const safeName = sanitizeFilename(filename);
  const uploadId = generateId();
  const ext = getExtFromContentType(content_type);
  const r2Key = getPhotoKey(slug, uploadId, ext);
  const thumbnailKey = getThumbnailKey(slug, uploadId);

  await c.env.DB.prepare(
    `INSERT INTO uploads (id, album_id, r2_key, thumbnail_key, original_filename, content_type)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).bind(uploadId, album.id, r2Key, thumbnailKey, safeName, content_type).run();

  return c.json({
    upload_id: uploadId,
    r2_key: r2Key,
    thumbnail_key: thumbnailKey,
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
    'SELECT r2_key, content_type FROM uploads WHERE id = ?'
  ).bind(uploadId).first<{ r2_key: string; content_type: string }>();

  if (!upload) {
    return c.json({ error: 'Not found' }, 404);
  }

  const obj = await c.env.PHOTOS.get(upload.r2_key);
  if (!obj) {
    return c.json({ error: 'File not found' }, 404);
  }

  return new Response(obj.body, {
    headers: {
      'Content-Type': upload.content_type,
      'Cache-Control': 'public, max-age=86400',
    },
  });
});

// Get thumbnail
uploadRoutes.get('/uploads/:uploadId/thumbnail', async (c) => {
  const uploadId = c.req.param('uploadId');

  const upload = await c.env.DB.prepare(
    'SELECT thumbnail_key, r2_key FROM uploads WHERE id = ?'
  ).bind(uploadId).first<{ thumbnail_key: string; r2_key: string }>();

  if (!upload) {
    return c.json({ error: 'Not found' }, 404);
  }

  const obj = await c.env.PHOTOS.get(upload.thumbnail_key);
  if (obj) {
    return new Response(obj.body, {
      headers: {
        'Content-Type': 'image/jpeg',
        'Cache-Control': 'public, max-age=86400',
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
      'Cache-Control': 'public, max-age=86400',
    },
  });
});

// Get all photos for an album
uploadRoutes.get('/albums/:slug/photos', async (c) => {
  const slug = c.req.param('slug');
  const { access_code } = c.req.query();

  const album = await c.env.DB.prepare(
    'SELECT id, access_code FROM albums WHERE slug = ?'
  ).bind(slug).first<{ id: string; access_code: string | null }>();

  if (!album) {
    return c.json({ error: 'Album not found' }, 404);
  }

  if (!validateAccessCode(album.access_code, access_code)) {
    return c.json({ error: 'Invalid access code' }, 403);
  }

  const uploads = await c.env.DB.prepare(
    'SELECT id, original_filename, content_type, file_size, uploaded_at FROM uploads WHERE album_id = ? ORDER BY uploaded_at DESC'
  ).bind(album.id).all();

  return c.json({
    photos: uploads.results
      .filter((upload) => typeof upload.file_size === 'number')
      .map(({ file_size, ...upload }) => upload),
  });
});
