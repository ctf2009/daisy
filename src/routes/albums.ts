import { Hono } from 'hono';
import type { Bindings } from '../types';
import { requireAuth } from '../middleware/auth';
import { generateId, generateSlug } from '../lib/tokens';
import { isValidImageType } from '../lib/validation';

type Album = {
  id: string;
  name: string;
  slug: string;
  access_code: string | null;
  welcome_text: string | null;
  background_key: string | null;
  owner_email: string;
  created_at: string;
  updated_at: string;
};

export const albumRoutes = new Hono<{ Bindings: Bindings; Variables: { userEmail: string } }>();

// Create album (requires auth)
albumRoutes.post('/', requireAuth, async (c) => {
  const email = c.get('userEmail');
  const { name, access_code, welcome_text } = await c.req.json<{
    name: string;
    access_code?: string;
    welcome_text?: string;
  }>();

  if (!name?.trim()) {
    return c.json({ error: 'Album name required' }, 400);
  }

  const id = generateId();
  const slug = generateSlug(name);

  await c.env.DB.prepare(
    `INSERT INTO albums (id, name, slug, access_code, welcome_text, owner_email)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).bind(id, name.trim(), slug, access_code || null, welcome_text || null, email).run();

  return c.json({ id, slug, name: name.trim() }, 201);
});

// Get album public info (for upload page)
albumRoutes.get('/:slug', async (c) => {
  const slug = c.req.param('slug');
  const album = await c.env.DB.prepare(
    'SELECT id, name, slug, welcome_text, background_key, access_code FROM albums WHERE slug = ?'
  ).bind(slug).first<Album>();

  if (!album) {
    return c.json({ error: 'Album not found' }, 404);
  }

  // Generate a signed URL for the background image if one exists
  let backgroundUrl: string | null = null;
  if (album.background_key) {
    const obj = await c.env.PHOTOS.get(album.background_key);
    if (obj) {
      // For public access we'll serve it through the worker
      backgroundUrl = `/api/albums/${slug}/background`;
    }
  }

  return c.json({
    name: album.name,
    slug: album.slug,
    welcome_text: album.welcome_text,
    background_url: backgroundUrl,
    requires_code: !!album.access_code,
  }, 200, {
    'Cache-Control': 'public, max-age=300',
  });
});

// Serve background image
albumRoutes.get('/:slug/background', async (c) => {
  const slug = c.req.param('slug');
  const album = await c.env.DB.prepare(
    'SELECT background_key FROM albums WHERE slug = ?'
  ).bind(slug).first<{ background_key: string | null }>();

  if (!album?.background_key) {
    return c.json({ error: 'No background' }, 404);
  }

  const obj = await c.env.PHOTOS.get(album.background_key);
  if (!obj) {
    return c.json({ error: 'Not found' }, 404);
  }

  const headers = new Headers();
  headers.set('Content-Type', obj.httpMetadata?.contentType || 'image/jpeg');
  headers.set('Cache-Control', 'public, max-age=3600');

  return new Response(obj.body, { headers });
});

// Get album management view (requires auth + ownership)
albumRoutes.get('/:slug/manage', requireAuth, async (c) => {
  const email = c.get('userEmail');
  const slug = c.req.param('slug');

  const album = await c.env.DB.prepare(
    'SELECT * FROM albums WHERE slug = ? AND owner_email = ?'
  ).bind(slug, email).first<Album>();

  if (!album) {
    return c.json({ error: 'Album not found or not owned by you' }, 404);
  }

  const uploads = await c.env.DB.prepare(
    'SELECT id, original_filename, content_type, file_size, uploaded_at FROM uploads WHERE album_id = ? ORDER BY uploaded_at DESC'
  ).bind(album.id).all();

  return c.json({
    ...album,
    uploads: uploads.results,
  });
});

// List albums for current user
albumRoutes.get('/', requireAuth, async (c) => {
  const email = c.get('userEmail');

  const albums = await c.env.DB.prepare(
    `SELECT a.id, a.name, a.slug, a.created_at, COUNT(u.id) as upload_count
     FROM albums a
     LEFT JOIN uploads u ON a.id = u.album_id
     WHERE a.owner_email = ?
     GROUP BY a.id
     ORDER BY a.created_at DESC`
  ).bind(email).all();

  return c.json({ albums: albums.results });
});

// Update album (requires auth + ownership)
albumRoutes.put('/:slug', requireAuth, async (c) => {
  const email = c.get('userEmail');
  const slug = c.req.param('slug');
  const { name, access_code, welcome_text } = await c.req.json<{
    name?: string;
    access_code?: string | null;
    welcome_text?: string | null;
  }>();

  const album = await c.env.DB.prepare(
    'SELECT id FROM albums WHERE slug = ? AND owner_email = ?'
  ).bind(slug, email).first<{ id: string }>();

  if (!album) {
    return c.json({ error: 'Album not found or not owned by you' }, 404);
  }

  await c.env.DB.prepare(
    `UPDATE albums SET
      name = COALESCE(?, name),
      access_code = ?,
      welcome_text = ?,
      updated_at = datetime('now')
     WHERE id = ?`
  ).bind(
    name || null,
    access_code !== undefined ? access_code : null,
    welcome_text !== undefined ? welcome_text : null,
    album.id
  ).run();

  return c.json({ ok: true });
});

// Upload background image (requires auth + ownership)
albumRoutes.post('/:slug/background', requireAuth, async (c) => {
  const email = c.get('userEmail');
  const slug = c.req.param('slug');

  const album = await c.env.DB.prepare(
    'SELECT id, background_key FROM albums WHERE slug = ? AND owner_email = ?'
  ).bind(slug, email).first<{ id: string; background_key: string | null }>();

  if (!album) {
    return c.json({ error: 'Album not found or not owned by you' }, 404);
  }

  const formData = await c.req.formData();
  const file = formData.get('file') as File | null;
  if (!file) {
    return c.json({ error: 'No file provided' }, 400);
  }

  if (!isValidImageType(file.type)) {
    return c.json({ error: 'Unsupported image type' }, 400);
  }

  // Delete old background if exists
  if (album.background_key) {
    await c.env.PHOTOS.delete(album.background_key);
  }

  const key = `${album.id}/background/${generateId()}.${file.name.split('.').pop() || 'jpg'}`;
  await c.env.PHOTOS.put(key, file.stream(), {
    httpMetadata: { contentType: file.type },
  });

  await c.env.DB.prepare(
    "UPDATE albums SET background_key = ?, updated_at = datetime('now') WHERE id = ?"
  ).bind(key, album.id).run();

  return c.json({ ok: true });
});

// Delete a photo from album (requires auth + ownership)
albumRoutes.delete('/:slug/uploads/:uploadId', requireAuth, async (c) => {
  const email = c.get('userEmail');
  const slug = c.req.param('slug');
  const uploadId = c.req.param('uploadId');

  const album = await c.env.DB.prepare(
    'SELECT id FROM albums WHERE slug = ? AND owner_email = ?'
  ).bind(slug, email).first<{ id: string }>();

  if (!album) {
    return c.json({ error: 'Album not found or not owned by you' }, 404);
  }

  const upload = await c.env.DB.prepare(
    'SELECT r2_key, thumbnail_key FROM uploads WHERE id = ? AND album_id = ?'
  ).bind(uploadId, album.id).first<{ r2_key: string; thumbnail_key: string }>();

  if (!upload) {
    return c.json({ error: 'Upload not found' }, 404);
  }

  // Delete from R2 and D1
  await Promise.all([
    c.env.PHOTOS.delete(upload.r2_key),
    c.env.PHOTOS.delete(upload.thumbnail_key),
    c.env.DB.prepare('DELETE FROM uploads WHERE id = ?').bind(uploadId).run(),
  ]);

  return c.json({ ok: true });
});
