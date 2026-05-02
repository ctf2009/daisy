import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { api, setToken, clearToken, isLoggedIn } from '../src/lib/api';

describe('auth helpers', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('isLoggedIn returns false when no token', () => {
    expect(isLoggedIn()).toBe(false);
  });

  it('isLoggedIn returns true after setToken', () => {
    setToken('test-token');
    expect(isLoggedIn()).toBe(true);
  });

  it('clearToken removes the token', () => {
    setToken('test-token');
    expect(isLoggedIn()).toBe(true);
    clearToken();
    expect(isLoggedIn()).toBe(false);
  });

  it('stores token in localStorage', () => {
    setToken('my-jwt');
    expect(localStorage.getItem('daisy_token')).toBe('my-jwt');
  });
});

describe('upload helpers', () => {
  const originalFetch = global.fetch;
  let clickSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    global.fetch = vi.fn();
    clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    localStorage.clear();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    clickSpy.mockRestore();
  });

  it('throws when file upload returns a non-ok response', async () => {
    vi.mocked(global.fetch).mockResolvedValue(
      new Response(JSON.stringify({ error: 'Too large' }), {
        status: 413,
        headers: { 'Content-Type': 'application/json' },
      })
    );

    await expect(api.uploadFile('upload-1', new Blob(['x']), 'image/jpeg')).rejects.toThrow('Too large');
  });

  it('resolves when thumbnail upload succeeds', async () => {
    vi.mocked(global.fetch).mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    );

    await expect(api.uploadThumbnail('upload-1', new Blob(['x']))).resolves.toBeUndefined();
  });

  it('requests a short-lived download token before redirecting the browser', async () => {
    setToken('auth-token');
    vi.mocked(global.fetch).mockResolvedValue(
      new Response(JSON.stringify({ token: 'download-token' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    );

    await api.downloadAlbum('album-slug');

    expect(global.fetch).toHaveBeenCalledWith('http://localhost:8787/api/albums/album-slug/download-token', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer auth-token',
        'Content-Type': 'application/json',
      },
    });
    expect(clickSpy).toHaveBeenCalled();
  });

  it('requests a short-lived selected download token before redirecting the browser', async () => {
    vi.mocked(global.fetch).mockResolvedValue(
      new Response(JSON.stringify({ token: 'selected-download-token' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    );

    await api.downloadSelectedPhotos('album-slug', ['photo-1', 'photo-2'], 'asset-token');

    expect(global.fetch).toHaveBeenCalledWith('http://localhost:8787/api/albums/album-slug/selected-download-token', {
      method: 'POST',
      body: JSON.stringify({
        ids: ['photo-1', 'photo-2'],
        asset_token: 'asset-token',
      }),
      headers: {
        'Content-Type': 'application/json',
      },
    });
    expect(clickSpy).toHaveBeenCalled();
  });

  it('builds tokenized asset URLs for photos and thumbnails', () => {
    const photo = { id: 'upload-1' };

    expect(api.getPhotoUrl(photo, 'asset-token')).toBe(
      'http://localhost:8787/api/uploads/upload-1/photo?token=asset-token'
    );
    expect(api.getThumbnailUrl(photo, 'asset-token')).toBe(
      'http://localhost:8787/api/uploads/upload-1/thumbnail?token=asset-token'
    );
  });
});
