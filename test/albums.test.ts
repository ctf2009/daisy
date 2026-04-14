import { describe, it, expect, beforeEach } from 'vitest';
import { unzipSync } from 'fflate';
import app from '../src/index';
import { createTestBindings } from './mocks';
import type { Bindings } from '../src/types';

let bindings: Bindings;

function req(path: string, init?: RequestInit) {
  return app.request(path, init, bindings);
}

async function getToken() {
  const res = await req('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'test@example.com', password: 'testpass' }),
  });
  const body = await res.json() as { token: string };
  return body.token;
}

async function createAlbum(token: string, data: Record<string, string>) {
  return req('/api/albums', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(data),
  });
}

async function requestUpload(slug: string, data: Record<string, string>) {
  return req(`/api/albums/${slug}/upload`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
}

async function requestDownloadToken(slug: string, token: string) {
  return req(`/api/albums/${slug}/download-token`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
  });
}

describe('POST /api/albums', () => {
  beforeEach(() => { bindings = createTestBindings(); });

  it('returns 401 without auth', async () => {
    const res = await req('/api/albums', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Test' }),
    });
    expect(res.status).toBe(401);
  });

  it('returns 400 with empty name', async () => {
    const token = await getToken();
    const res = await createAlbum(token, { name: '' });
    expect(res.status).toBe(400);
  });

  it('creates an album and returns slug', async () => {
    const token = await getToken();
    const res = await createAlbum(token, { name: 'My Event' });
    expect(res.status).toBe(201);
    const body = await res.json() as { id: string; slug: string; name: string };
    expect(body.name).toBe('My Event');
    expect(body.slug).toMatch(/^my-event-/);
    expect(body.id).toBeTruthy();
  });

  it('trims whitespace from name', async () => {
    const token = await getToken();
    const res = await createAlbum(token, { name: '  Spaced Out  ' });
    expect(res.status).toBe(201);
    const body = await res.json() as { name: string };
    expect(body.name).toBe('Spaced Out');
  });
});

describe('GET /api/albums/:slug', () => {
  beforeEach(() => { bindings = createTestBindings(); });

  it('returns 404 for non-existent album', async () => {
    const res = await req('/api/albums/no-such-album');
    expect(res.status).toBe(404);
  });

  it('returns public album info', async () => {
    const token = await getToken();
    const createRes = await createAlbum(token, { name: 'Public Event' });
    const { slug } = await createRes.json() as { slug: string };

    const res = await req(`/api/albums/${slug}`);
    expect(res.status).toBe(200);
    const body = await res.json() as { name: string; requires_code: boolean };
    expect(body.name).toBe('Public Event');
    expect(body.requires_code).toBe(false);
  });

  it('shows requires_code when access code is set', async () => {
    const token = await getToken();
    const createRes = await createAlbum(token, { name: 'Private', access_code: 'secret' });
    const { slug } = await createRes.json() as { slug: string };

    const res = await req(`/api/albums/${slug}`);
    const body = await res.json() as { requires_code: boolean };
    expect(body.requires_code).toBe(true);
  });
});

describe('GET /api/albums/:slug/manage', () => {
  beforeEach(() => { bindings = createTestBindings(); });

  it('returns 401 without auth', async () => {
    const res = await req('/api/albums/some-slug/manage');
    expect(res.status).toBe(401);
  });

  it('returns album with empty uploads for owner', async () => {
    const token = await getToken();
    const createRes = await createAlbum(token, { name: 'Managed' });
    const { slug } = await createRes.json() as { slug: string };

    const res = await req(`/api/albums/${slug}/manage`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { name: string; uploads: unknown[] };
    expect(body.name).toBe('Managed');
    expect(body.uploads).toEqual([]);
  });
});

describe('GET /api/albums (list)', () => {
  beforeEach(() => { bindings = createTestBindings(); });

  it('returns 401 without auth', async () => {
    const res = await req('/api/albums');
    expect(res.status).toBe(401);
  });

  it('returns albums for authenticated user', async () => {
    const token = await getToken();
    await createAlbum(token, { name: 'Album One' });
    await createAlbum(token, { name: 'Album Two' });

    const res = await req('/api/albums', {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { albums: unknown[] };
    expect(body.albums.length).toBe(2);
  });

  it('counts only completed uploads', async () => {
    const token = await getToken();
    const createRes = await createAlbum(token, { name: 'Counted Album' });
    const { slug } = await createRes.json() as { slug: string };

    const slotRes = await req(`/api/albums/${slug}/upload`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content_type: 'image/jpeg', filename: 'done.jpg' }),
    });
    const { upload_id } = await slotRes.json() as { upload_id: string };

    await req(`/api/uploads/${upload_id}/file`, {
      method: 'PUT',
      headers: { 'Content-Type': 'image/jpeg' },
      body: new Uint8Array([0xFF, 0xD8, 0xFF, 0xE0]),
    });

    await req(`/api/albums/${slug}/upload`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content_type: 'image/jpeg', filename: 'pending.jpg' }),
    });

    const res = await req('/api/albums', {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);

    const body = await res.json() as {
      albums: Array<{ slug: string; upload_count: number }>;
    };
    expect(body.albums[0].slug).toBe(slug);
    expect(body.albums[0].upload_count).toBe(1);
  });
});

describe('PUT /api/albums/:slug', () => {
  beforeEach(() => { bindings = createTestBindings(); });

  it('preserves omitted fields during partial updates', async () => {
    const token = await getToken();
    const createRes = await createAlbum(token, {
      name: 'Original Name',
      access_code: 'secret',
      welcome_text: 'Hello guests',
    });
    const { slug } = await createRes.json() as { slug: string };

    const updateRes = await req(`/api/albums/${slug}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ name: 'Updated Name' }),
    });
    expect(updateRes.status).toBe(200);

    const manageRes = await req(`/api/albums/${slug}/manage`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const body = await manageRes.json() as {
      name: string;
      access_code: string | null;
      welcome_text: string | null;
    };

    expect(body.name).toBe('Updated Name');
    expect(body.access_code).toBe('secret');
    expect(body.welcome_text).toBe('Hello guests');
  });

  it('allows explicitly clearing optional fields', async () => {
    const token = await getToken();
    const createRes = await createAlbum(token, {
      name: 'Needs Cleanup',
      access_code: 'secret',
      welcome_text: 'Hello guests',
    });
    const { slug } = await createRes.json() as { slug: string };

    const updateRes = await req(`/api/albums/${slug}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ access_code: null, welcome_text: null }),
    });
    expect(updateRes.status).toBe(200);

    const manageRes = await req(`/api/albums/${slug}/manage`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const body = await manageRes.json() as {
      access_code: string | null;
      welcome_text: string | null;
    };

    expect(body.access_code).toBeNull();
    expect(body.welcome_text).toBeNull();
  });
});

describe('GET /api/albums/:slug/download', () => {
  beforeEach(() => { bindings = createTestBindings(); });

  it('issues a short-lived download token for the album owner', async () => {
    const token = await getToken();
    const createRes = await createAlbum(token, { name: 'Download Token Test' });
    const { slug } = await createRes.json() as { slug: string };

    const res = await requestDownloadToken(slug, token);
    expect(res.status).toBe(200);
    const body = await res.json() as { token: string };
    expect(body.token).toBeTruthy();
  });

  it('streams a zip of completed uploads for the album owner with a download token', async () => {
    const token = await getToken();
    const createRes = await createAlbum(token, { name: 'Download Test' });
    const { slug } = await createRes.json() as { slug: string };

    const completeSlot = await requestUpload(slug, {
      content_type: 'image/jpeg',
      filename: 'first.jpg',
    });
    const pendingSlot = await requestUpload(slug, {
      content_type: 'image/png',
      filename: 'pending.png',
    });
    const { upload_id: completeUploadId } = await completeSlot.json() as { upload_id: string };
    await pendingSlot.json();

    await req(`/api/uploads/${completeUploadId}/file`, {
      method: 'PUT',
      headers: { 'Content-Type': 'image/jpeg' },
      body: new Uint8Array([0xFF, 0xD8, 0xFF, 0xE0]),
    });

    const tokenRes = await requestDownloadToken(slug, token);
    const { token: downloadToken } = await tokenRes.json() as { token: string };

    const res = await req(`/api/albums/${slug}/download?token=${encodeURIComponent(downloadToken)}`);
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('application/zip');

    const archive = unzipSync(new Uint8Array(await res.arrayBuffer()));
    expect(Object.keys(archive)).toEqual(['first.jpg']);
    expect(Array.from(archive['first.jpg'])).toEqual([0xFF, 0xD8, 0xFF, 0xE0]);
  });

  it('rejects using the main auth token as a download query token', async () => {
    const token = await getToken();
    const createRes = await createAlbum(token, { name: 'Wrong Token Test' });
    const { slug } = await createRes.json() as { slug: string };

    const res = await req(`/api/albums/${slug}/download?token=${encodeURIComponent(token)}`);
    expect(res.status).toBe(401);
  });
});
