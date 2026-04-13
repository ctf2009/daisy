import { describe, it, expect, beforeEach } from 'vitest';
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

async function createAlbum(token: string, name: string, accessCode?: string) {
  const res = await req('/api/albums', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ name, access_code: accessCode }),
  });
  return await res.json() as { id: string; slug: string };
}

async function requestUpload(slug: string, data: Record<string, string>) {
  return req(`/api/albums/${slug}/upload`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
}

describe('POST /api/albums/:slug/upload', () => {
  beforeEach(() => { bindings = createTestBindings(); });

  it('creates an upload slot for open album', async () => {
    const token = await getToken();
    const album = await createAlbum(token, 'Open Album');

    const res = await requestUpload(album.slug, {
      content_type: 'image/jpeg',
      filename: 'photo.jpg',
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { upload_id: string; r2_key: string; thumbnail_key: string };
    expect(body.upload_id).toBeTruthy();
    expect(body.r2_key).toContain('.jpg');
    expect(body.thumbnail_key).toContain('thumbs');
  });

  it('rejects upload without access code on protected album', async () => {
    const token = await getToken();
    const album = await createAlbum(token, 'Protected', 'mycode');

    const res = await requestUpload(album.slug, {
      content_type: 'image/jpeg',
      filename: 'photo.jpg',
    });
    expect(res.status).toBe(403);
  });

  it('accepts upload with correct access code', async () => {
    const token = await getToken();
    const album = await createAlbum(token, 'Protected OK', 'mycode');

    const res = await requestUpload(album.slug, {
      content_type: 'image/jpeg',
      filename: 'photo.jpg',
      access_code: 'mycode',
    });
    expect(res.status).toBe(200);
  });

  it('rejects upload with wrong access code', async () => {
    const token = await getToken();
    const album = await createAlbum(token, 'Protected Wrong', 'correct');

    const res = await requestUpload(album.slug, {
      content_type: 'image/jpeg',
      filename: 'photo.jpg',
      access_code: 'wrong',
    });
    expect(res.status).toBe(403);
  });

  it('returns 404 for non-existent album', async () => {
    const res = await requestUpload('no-such-album', {
      content_type: 'image/jpeg',
      filename: 'photo.jpg',
    });
    expect(res.status).toBe(404);
  });
});

describe('PUT /api/uploads/:id/file', () => {
  beforeEach(() => { bindings = createTestBindings(); });

  it('uploads a file and serves it back', async () => {
    const token = await getToken();
    const album = await createAlbum(token, 'Upload Test');

    // Request slot
    const slotRes = await requestUpload(album.slug, {
      content_type: 'image/jpeg',
      filename: 'test.jpg',
    });
    const { upload_id } = await slotRes.json() as { upload_id: string };

    // Upload file
    const fakeJpeg = new Uint8Array([0xFF, 0xD8, 0xFF, 0xE0]);
    const uploadRes = await req(`/api/uploads/${upload_id}/file`, {
      method: 'PUT',
      headers: { 'Content-Type': 'image/jpeg' },
      body: fakeJpeg,
    });
    expect(uploadRes.status).toBe(200);

    // Retrieve
    const getRes = await req(`/api/uploads/${upload_id}/photo`);
    expect(getRes.status).toBe(200);
    expect(getRes.headers.get('Content-Type')).toBe('image/jpeg');
  });

  it('returns 404 for non-existent upload', async () => {
    const res = await req('/api/uploads/fake-id/file', {
      method: 'PUT',
      headers: { 'Content-Type': 'image/jpeg' },
      body: new Uint8Array([0xFF]),
    });
    expect(res.status).toBe(404);
  });
});

describe('PUT /api/uploads/:id/thumbnail', () => {
  beforeEach(() => { bindings = createTestBindings(); });

  it('uploads a thumbnail and serves it back', async () => {
    const token = await getToken();
    const album = await createAlbum(token, 'Thumb Test');

    const slotRes = await requestUpload(album.slug, {
      content_type: 'image/jpeg',
      filename: 'test.jpg',
    });
    const { upload_id } = await slotRes.json() as { upload_id: string };

    const uploadRes = await req(`/api/uploads/${upload_id}/thumbnail`, {
      method: 'PUT',
      headers: { 'Content-Type': 'image/jpeg' },
      body: new Uint8Array([0xFF, 0xD8]),
    });
    expect(uploadRes.status).toBe(200);

    const getRes = await req(`/api/uploads/${upload_id}/thumbnail`);
    expect(getRes.status).toBe(200);
    expect(getRes.headers.get('Content-Type')).toBe('image/jpeg');
  });
});

describe('GET /api/albums/:slug/photos', () => {
  beforeEach(() => { bindings = createTestBindings(); });

  it('lists photos for an album', async () => {
    const token = await getToken();
    const album = await createAlbum(token, 'List Test');

    await requestUpload(album.slug, { content_type: 'image/jpeg', filename: 'a.jpg' });
    await requestUpload(album.slug, { content_type: 'image/png', filename: 'b.png' });

    const res = await req(`/api/albums/${album.slug}/photos`);
    expect(res.status).toBe(200);
    const body = await res.json() as { photos: unknown[] };
    expect(body.photos.length).toBe(2);
  });

  it('rejects listing without code on protected album', async () => {
    const token = await getToken();
    const album = await createAlbum(token, 'Protected List', 'code123');

    const res = await req(`/api/albums/${album.slug}/photos`);
    expect(res.status).toBe(403);
  });

  it('allows listing with correct code', async () => {
    const token = await getToken();
    const album = await createAlbum(token, 'Protected List OK', 'code123');

    const res = await req(`/api/albums/${album.slug}/photos?access_code=code123`);
    expect(res.status).toBe(200);
  });
});

describe('DELETE /api/albums/:slug/uploads/:id', () => {
  beforeEach(() => { bindings = createTestBindings(); });

  it('owner can delete a photo', async () => {
    const token = await getToken();
    const album = await createAlbum(token, 'Delete Test');

    const slotRes = await requestUpload(album.slug, {
      content_type: 'image/jpeg',
      filename: 'bye.jpg',
    });
    const { upload_id } = await slotRes.json() as { upload_id: string };

    // Upload file + thumbnail so R2 keys exist
    await req(`/api/uploads/${upload_id}/file`, {
      method: 'PUT',
      body: new Uint8Array([0xFF, 0xD8]),
    });
    await req(`/api/uploads/${upload_id}/thumbnail`, {
      method: 'PUT',
      body: new Uint8Array([0xFF, 0xD8]),
    });

    const deleteRes = await req(`/api/albums/${album.slug}/uploads/${upload_id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(deleteRes.status).toBe(200);

    // Photo should be gone
    const getRes = await req(`/api/uploads/${upload_id}/photo`);
    expect(getRes.status).toBe(404);
  });

  it('returns 401 without auth', async () => {
    const res = await req('/api/albums/some-slug/uploads/some-id', {
      method: 'DELETE',
    });
    expect(res.status).toBe(401);
  });
});
