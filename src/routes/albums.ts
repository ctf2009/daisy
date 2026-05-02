import { Context, Hono } from 'hono';
import { Zip, ZipPassThrough } from 'fflate';
import type { Bindings } from '../types';
import { requireAuth } from '../middleware/auth';
import {
  extractBearerToken,
  issueAlbumAssetsToken,
  issueDownloadToken,
  issueSelectedDownloadToken,
  verifyAuthToken,
  verifyAlbumAssetsToken,
  verifyDownloadToken,
  verifySelectedDownloadToken,
} from '../lib/auth';
import { generateId, generateSlug } from '../lib/tokens';
import { isValidImageType } from '../lib/validation';

type Album = {
  id: string;
  name: string;
  slug: string;
  access_code: string | null;
  is_open: number;
  is_viewable: number;
  welcome_text: string | null;
  background_key: string | null;
  owner_email: string;
  created_at: string;
  updated_at: string;
};

export const albumRoutes = new Hono<{ Bindings: Bindings; Variables: { userEmail: string } }>();

function toDownloadFilename(albumName: string): string {
  const safeName = albumName.replace(/[^a-zA-Z0-9_-]/g, '_') || 'album';
  return `${safeName}_photos.zip`;
}

function toArchiveEntryName(
  originalFilename: string | null,
  fallbackName: string,
  usedNames: Set<string>
): string {
  const safeName = (originalFilename || fallbackName)
    .replace(/[\\/:*?"<>|]/g, '_')
    .trim() || fallbackName;

  if (!usedNames.has(safeName)) {
    usedNames.add(safeName);
    return safeName;
  }

  const extIndex = safeName.lastIndexOf('.');
  const base = extIndex > 0 ? safeName.slice(0, extIndex) : safeName;
  const suffix = extIndex > 0 ? safeName.slice(extIndex) : '';

  let counter = 2;
  let candidate = `${base}_${counter}${suffix}`;
  while (usedNames.has(candidate)) {
    counter++;
    candidate = `${base}_${counter}${suffix}`;
  }

  usedNames.add(candidate);
  return candidate;
}

type ArchiveUpload = {
  id: string;
  original_filename: string | null;
  r2_key: string;
};

function createArchiveResponse(
  c: Context<{ Bindings: Bindings; Variables: { userEmail: string } }>,
  albumName: string,
  uploads: ArchiveUpload[]
) {
  let zip: Zip | undefined;
  let canceled = false;
  const usedNames = new Set<string>();

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      zip = new Zip((err, chunk, final) => {
        if (err) {
          controller.error(err);
          return;
        }

        controller.enqueue(chunk);
        if (final) {
          controller.close();
        }
      });

      void (async () => {
        for (const upload of uploads) {
          if (canceled) {
            break;
          }

          const object = await c.env.PHOTOS.get(upload.r2_key);
          if (!object?.body) {
            continue;
          }

          const fallbackName = `photo_${upload.id}`;
          const archiveName = toArchiveEntryName(upload.original_filename, fallbackName, usedNames);
          const entry = new ZipPassThrough(archiveName);
          zip.add(entry);

          const reader = object.body.getReader();
          try {
            let current = await reader.read();

            if (current.done) {
              entry.push(new Uint8Array(0), true);
              continue;
            }

            while (true) {
              const next = await reader.read();
              entry.push(current.value, next.done);
              if (next.done) {
                break;
              }
              current = next;
            }
          } finally {
            reader.releaseLock();
          }
        }

        if (!canceled) {
          zip.end();
        }
      })().catch((err) => {
        try {
          zip?.terminate();
        } finally {
          controller.error(err);
        }
      });
    },
    cancel() {
      canceled = true;
      zip?.terminate();
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="${toDownloadFilename(albumName)}"`,
      'Cache-Control': 'private, no-store',
    },
  });
}

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
    'SELECT id, name, slug, is_open, is_viewable, welcome_text, background_key, access_code FROM albums WHERE slug = ?'
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
    is_open: !!album.is_open,
    is_viewable: !!album.is_viewable,
    requires_code: !!album.access_code,
  }, 200, {
    'Cache-Control': 'no-cache',
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
  const albumAssetToken = await issueAlbumAssetsToken(slug, c.env);

  return c.json({
    ...album,
    asset_token: albumAssetToken,
    uploads: uploads.results.filter((upload) => typeof upload.file_size === 'number'),
  });
});

async function getDownloadRequesterEmail(
  c: Context<{ Bindings: Bindings; Variables: { userEmail: string } }>
): Promise<string | null> {
  const bearerToken = extractBearerToken(c.req.header('Authorization'));
  if (bearerToken) {
    const { email } = await verifyAuthToken(bearerToken, c.env);
    return email;
  }

  const downloadToken = c.req.query('token');
  const slug = c.req.param('slug') || '';
  if (!downloadToken) {
    return null;
  }

  const { email } = await verifyDownloadToken(downloadToken, slug, c.env);
  return email;
}

albumRoutes.post('/:slug/download-token', requireAuth, async (c) => {
  const email = c.get('userEmail') as string;
  const slug = c.req.param('slug') as string;

  const album = await c.env.DB.prepare(
    'SELECT id FROM albums WHERE slug = ? AND owner_email = ?'
  ).bind(slug, email).first<{ id: string }>();

  if (!album) {
    return c.json({ error: 'Album not found or not owned by you' }, 404);
  }

  const token = await issueDownloadToken(email, slug, c.env);
  return c.json({ token });
});

albumRoutes.get('/:slug/download', async (c) => {
  let email: string | null = null;

  try {
    email = await getDownloadRequesterEmail(c);
  } catch {
    return c.json({ error: 'Invalid or expired token' }, 401);
  }

  if (!email) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  const slug = c.req.param('slug');

  const album = await c.env.DB.prepare(
    'SELECT id, name FROM albums WHERE slug = ? AND owner_email = ?'
  ).bind(slug, email).first<{ id: string; name: string }>();

  if (!album) {
    return c.json({ error: 'Album not found or not owned by you' }, 404);
  }

  const uploads = await c.env.DB.prepare(
    `SELECT id, original_filename, r2_key
     FROM uploads
     WHERE album_id = ? AND file_size IS NOT NULL
     ORDER BY uploaded_at DESC`
  ).bind(album.id).all<{ id: string; original_filename: string | null; r2_key: string }>();

  return createArchiveResponse(c, album.name, uploads.results);
});

albumRoutes.post('/:slug/selected-download-token', async (c) => {
  const slug = c.req.param('slug');
  const { ids, asset_token } = await c.req.json<{
    ids?: string[];
    asset_token?: string;
  }>();

  const selectedIds = Array.from(new Set((ids || []).filter((id) => typeof id === 'string' && id)));
  if (selectedIds.length === 0) {
    return c.json({ error: 'At least one photo must be selected' }, 400);
  }

  if (selectedIds.length > 100) {
    return c.json({ error: 'Please select up to 100 photos at a time' }, 400);
  }

  const bearerToken = extractBearerToken(c.req.header('Authorization'));
  const album = await c.env.DB.prepare(
    'SELECT id, name, owner_email FROM albums WHERE slug = ?'
  ).bind(slug).first<{ id: string; name: string; owner_email: string }>();

  if (!album) {
    return c.json({ error: 'Album not found' }, 404);
  }

  let authorizedViaBearer = false;

  if (bearerToken) {
    try {
      const { email } = await verifyAuthToken(bearerToken, c.env);
      if (email !== album.owner_email) {
        authorizedViaBearer = false;
      } else {
        authorizedViaBearer = true;
      }
    } catch {
      authorizedViaBearer = false;
    }
  }

  if (!authorizedViaBearer) {
    if (!asset_token) {
      return c.json({ error: 'Unauthorized' }, 401);
    }

    try {
      await verifyAlbumAssetsToken(asset_token, slug, c.env);
    } catch {
      return c.json({ error: 'Unauthorized' }, 401);
    }
  }

  const uploads = await c.env.DB.prepare(
    `SELECT id
     FROM uploads
     WHERE album_id = ? AND file_size IS NOT NULL`
  ).bind(album.id).all<{ id: string }>();
  const availableIds = new Set(uploads.results.map((upload) => upload.id));

  if (selectedIds.some((id) => !availableIds.has(id))) {
    return c.json({ error: 'One or more selected photos are no longer available' }, 400);
  }

  const token = await issueSelectedDownloadToken(slug, selectedIds, c.env);
  return c.json({ token });
});

albumRoutes.get('/:slug/selected-download', async (c) => {
  const slug = c.req.param('slug');
  const token = c.req.query('token');
  if (!token) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  let ids: string[];
  try {
    ({ ids } = await verifySelectedDownloadToken(token, slug, c.env));
  } catch {
    return c.json({ error: 'Invalid or expired token' }, 401);
  }

  const album = await c.env.DB.prepare(
    'SELECT id, name FROM albums WHERE slug = ?'
  ).bind(slug).first<{ id: string; name: string }>();

  if (!album) {
    return c.json({ error: 'Album not found' }, 404);
  }

  const uploads = await c.env.DB.prepare(
    `SELECT id, original_filename, r2_key
     FROM uploads
     WHERE album_id = ? AND file_size IS NOT NULL
     ORDER BY uploaded_at DESC`
  ).bind(album.id).all<ArchiveUpload>();
  const selectedIds = new Set(ids);
  const selectedUploads = uploads.results.filter((upload) => selectedIds.has(upload.id));

  if (selectedUploads.length === 0) {
    return c.json({ error: 'No selected photos are available' }, 404);
  }

  return createArchiveResponse(c, `${album.name}_selected`, selectedUploads);
});

// List albums for current user
albumRoutes.get('/', requireAuth, async (c) => {
  const email = c.get('userEmail');

  const albums = await c.env.DB.prepare(
    `SELECT a.id, a.name, a.slug, a.created_at,
        (SELECT COUNT(*)
         FROM uploads u
         WHERE u.album_id = a.id AND u.file_size IS NOT NULL) as upload_count
     FROM albums a
     WHERE a.owner_email = ?
     ORDER BY a.created_at DESC`
  ).bind(email).all();

  return c.json({ albums: albums.results });
});

// Update album (requires auth + ownership)
albumRoutes.put('/:slug', requireAuth, async (c) => {
  const email = c.get('userEmail');
  const slug = c.req.param('slug');
  const { name, access_code, welcome_text, is_open, is_viewable } = await c.req.json<{
    name?: string;
    access_code?: string | null;
    welcome_text?: string | null;
    is_open?: boolean;
    is_viewable?: boolean;
  }>();

  const album = await c.env.DB.prepare(
    'SELECT id, name, access_code, is_open, is_viewable, welcome_text FROM albums WHERE slug = ? AND owner_email = ?'
  ).bind(slug, email).first<{ id: string; name: string; access_code: string | null; is_open: number; is_viewable: number; welcome_text: string | null }>();

  if (!album) {
    return c.json({ error: 'Album not found or not owned by you' }, 404);
  }

  const nextName = name !== undefined ? name.trim() : album.name;
  if (!nextName) {
    return c.json({ error: 'Album name required' }, 400);
  }

  const nextAccessCode = access_code !== undefined ? access_code : album.access_code;
  const nextWelcomeText = welcome_text !== undefined ? welcome_text : album.welcome_text;
  const nextIsOpen = is_open !== undefined ? (is_open ? 1 : 0) : album.is_open;
  const nextIsViewable = is_viewable !== undefined ? (is_viewable ? 1 : 0) : album.is_viewable;

  await c.env.DB.prepare(
    `UPDATE albums SET
      name = ?,
      access_code = ?,
      is_open = ?,
      is_viewable = ?,
      welcome_text = ?,
      updated_at = datetime('now')
     WHERE id = ?`
  ).bind(
    nextName,
    nextAccessCode,
    nextIsOpen,
    nextIsViewable,
    nextWelcomeText,
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

  const key = `${slug}/background/${generateId()}.${file.name.split('.').pop() || 'jpg'}`;
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
