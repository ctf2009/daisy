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
    const res = await createAlbum(token, { name: 'My Wedding' });
    expect(res.status).toBe(201);
    const body = await res.json() as { id: string; slug: string; name: string };
    expect(body.name).toBe('My Wedding');
    expect(body.slug).toMatch(/^my-wedding-/);
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
});
