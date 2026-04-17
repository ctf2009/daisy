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

async function updateAlbum(token: string, slug: string, data: Record<string, unknown>) {
  return req(`/api/albums/${slug}`, {
    method: 'PUT',
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

async function getOwnerAlbumAssetToken(token: string, slug: string) {
  const manageRes = await req(`/api/albums/${slug}/manage`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const body = await manageRes.json() as {
    asset_token: string;
  };
  return body.asset_token;
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
    const assetToken = await getOwnerAlbumAssetToken(token, album.slug);
    const getRes = await req(`/api/uploads/${upload_id}/photo?token=${encodeURIComponent(assetToken)}`);
    expect(getRes.status).toBe(200);
    expect(getRes.headers.get('Content-Type')).toBe('image/jpeg');
    expect(getRes.headers.get('Cache-Control')).toBe('private, max-age=21600');
  });

  it('stores file size and exposes uploaded files in the manage view', async () => {
    const token = await getToken();
    const album = await createAlbum(token, 'File Size Test');

    const slotRes = await requestUpload(album.slug, {
      content_type: 'image/jpeg',
      filename: 'sized.jpg',
    });
    const { upload_id } = await slotRes.json() as { upload_id: string };

    const fakeJpeg = new Uint8Array([0xFF, 0xD8, 0xFF, 0xE0]);
    await req(`/api/uploads/${upload_id}/file`, {
      method: 'PUT',
      headers: { 'Content-Type': 'image/jpeg' },
      body: fakeJpeg,
    });

    const manageRes = await req(`/api/albums/${album.slug}/manage`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const body = await manageRes.json() as {
      uploads: Array<{ id: string; file_size: number | null }>;
    };

    expect(body.uploads).toHaveLength(1);
    expect(body.uploads[0].id).toBe(upload_id);
    expect(body.uploads[0].file_size).toBe(fakeJpeg.byteLength);
  });

  it('deletes incomplete upload slots when the file upload is rejected', async () => {
    const token = await getToken();
    const album = await createAlbum(token, 'Cleanup Test');

    const slotRes = await requestUpload(album.slug, {
      content_type: 'image/jpeg',
      filename: 'too-big.jpg',
    });
    const { upload_id } = await slotRes.json() as { upload_id: string };

    const uploadRes = await req(`/api/uploads/${upload_id}/file`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'image/jpeg',
        'Content-Length': String(50 * 1024 * 1024 + 1),
      },
      body: new Uint8Array([0xFF, 0xD8]),
    });
    expect(uploadRes.status).toBe(413);

    const getRes = await req(`/api/uploads/${upload_id}/photo`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(getRes.status).toBe(404);
  });

  it('returns 404 for non-existent upload', async () => {
    const res = await req('/api/uploads/fake-id/file', {
      method: 'PUT',
      headers: { 'Content-Type': 'image/jpeg' },
      body: new Uint8Array([0xFF]),
    });
    expect(res.status).toBe(404);
  });

  it('rejects direct photo access without an asset token', async () => {
    const token = await getToken();
    const album = await createAlbum(token, 'Protected Asset');

    const slotRes = await requestUpload(album.slug, {
      content_type: 'image/jpeg',
      filename: 'locked.jpg',
    });
    const { upload_id } = await slotRes.json() as { upload_id: string };

    await req(`/api/uploads/${upload_id}/file`, {
      method: 'PUT',
      headers: { 'Content-Type': 'image/jpeg' },
      body: new Uint8Array([0xFF, 0xD8]),
    });

    const getRes = await req(`/api/uploads/${upload_id}/photo`);
    expect(getRes.status).toBe(401);
  });
});

describe('multipart upload endpoints', () => {
  beforeEach(() => { bindings = createTestBindings(); });

  it('uploads multipart chunks, lists them, and completes the upload', async () => {
    const token = await getToken();
    const album = await createAlbum(token, 'Multipart Test');

    const slotRes = await requestUpload(album.slug, {
      content_type: 'image/jpeg',
      filename: 'multi.jpg',
    });
    const { upload_id, multipart_upload_id } = await slotRes.json() as {
      upload_id: string;
      multipart_upload_id: string;
    };

    expect(multipart_upload_id).toBeTruthy();

    const partOne = new Uint8Array([1, 2, 3]);
    const partTwo = new Uint8Array([4, 5]);

    const partOneRes = await req(`/api/uploads/${upload_id}/part/1`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/octet-stream' },
      body: partOne,
    });
    expect(partOneRes.status).toBe(204);
    expect(partOneRes.headers.get('ETag')).toBeTruthy();

    const partTwoRes = await req(`/api/uploads/${upload_id}/part/2`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/octet-stream' },
      body: partTwo,
    });
    expect(partTwoRes.status).toBe(204);

    const listRes = await req(`/api/uploads/${upload_id}/parts`);
    expect(listRes.status).toBe(200);
    const listed = await listRes.json() as {
      parts: Array<{ PartNumber: number; ETag: string }>;
    };
    expect(listed.parts).toHaveLength(2);
    expect(listed.parts[0].PartNumber).toBe(1);
    expect(listed.parts[1].PartNumber).toBe(2);

    const completeRes = await req(`/api/uploads/${upload_id}/complete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ parts: listed.parts }),
    });
    expect(completeRes.status).toBe(200);

    const assetToken = await getOwnerAlbumAssetToken(token, album.slug);
    const photoRes = await req(`/api/uploads/${upload_id}/photo?token=${encodeURIComponent(assetToken)}`);
    expect(photoRes.status).toBe(200);
    const bytes = new Uint8Array(await photoRes.arrayBuffer());
    expect(Array.from(bytes)).toEqual([1, 2, 3, 4, 5]);

    const listAfterCompleteRes = await req(`/api/uploads/${upload_id}/parts`);
    expect(listAfterCompleteRes.status).toBe(404);
  });

  it('aborts multipart uploads and removes the placeholder upload', async () => {
    const token = await getToken();
    const album = await createAlbum(token, 'Multipart Abort Test');

    const slotRes = await requestUpload(album.slug, {
      content_type: 'image/jpeg',
      filename: 'abort.jpg',
    });
    const { upload_id } = await slotRes.json() as { upload_id: string };

    await req(`/api/uploads/${upload_id}/part/1`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/octet-stream' },
      body: new Uint8Array([9, 9, 9]),
    });

    const abortRes = await req(`/api/uploads/${upload_id}/abort`, {
      method: 'DELETE',
    });
    expect(abortRes.status).toBe(200);

    const photoRes = await req(`/api/uploads/${upload_id}/photo`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(photoRes.status).toBe(404);

    const listRes = await req(`/api/uploads/${upload_id}/parts`);
    expect(listRes.status).toBe(404);
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

    const getRes = await req(`/api/uploads/${upload_id}/thumbnail`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(getRes.status).toBe(200);
    expect(getRes.headers.get('Content-Type')).toBe('image/jpeg');
  });

  it('falls back to the original photo when the thumbnail is missing', async () => {
    const token = await getToken();
    const album = await createAlbum(token, 'Fallback Test');

    const slotRes = await requestUpload(album.slug, {
      content_type: 'image/jpeg',
      filename: 'original.jpg',
    });
    const { upload_id } = await slotRes.json() as { upload_id: string };

    await req(`/api/uploads/${upload_id}/file`, {
      method: 'PUT',
      headers: { 'Content-Type': 'image/jpeg' },
      body: new Uint8Array([0xFF, 0xD8, 0xFF, 0xE0]),
    });

    const assetToken = await getOwnerAlbumAssetToken(token, album.slug);
    const getRes = await req(`/api/uploads/${upload_id}/thumbnail?token=${encodeURIComponent(assetToken)}`);
    expect(getRes.status).toBe(200);
    expect(getRes.headers.get('Content-Type')).toBe('image/jpeg');
    expect(getRes.headers.get('Cache-Control')).toBe('private, max-age=21600');
  });
});

describe('GET /api/albums/:slug/photos', () => {
  beforeEach(() => { bindings = createTestBindings(); });

  it('lists photos for an album', async () => {
    const token = await getToken();
    const album = await createAlbum(token, 'List Test');
    await updateAlbum(token, album.slug, { is_viewable: true });

    const firstSlot = await requestUpload(album.slug, { content_type: 'image/jpeg', filename: 'a.jpg' });
    const secondSlot = await requestUpload(album.slug, { content_type: 'image/png', filename: 'b.png' });
    const { upload_id: firstUploadId } = await firstSlot.json() as { upload_id: string };
    const { upload_id: secondUploadId } = await secondSlot.json() as { upload_id: string };

    await req(`/api/uploads/${firstUploadId}/file`, {
      method: 'PUT',
      headers: { 'Content-Type': 'image/jpeg' },
      body: new Uint8Array([0xFF, 0xD8]),
    });
    await req(`/api/uploads/${secondUploadId}/file`, {
      method: 'PUT',
      headers: { 'Content-Type': 'image/png' },
      body: new Uint8Array([0x89, 0x50]),
    });

    const res = await req(`/api/albums/${album.slug}/photos`);
    expect(res.status).toBe(200);
    const body = await res.json() as { photos: unknown[] };
    expect(body.photos.length).toBe(2);
  });

  it('hides upload slots that never finished uploading', async () => {
    const token = await getToken();
    const album = await createAlbum(token, 'Incomplete Uploads');
    await updateAlbum(token, album.slug, { is_viewable: true });

    await requestUpload(album.slug, { content_type: 'image/jpeg', filename: 'pending.jpg' });

    const res = await req(`/api/albums/${album.slug}/photos`);
    expect(res.status).toBe(200);
    const body = await res.json() as { photos: unknown[] };
    expect(body.photos).toEqual([]);
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

  it('still requires the access code for viewable protected albums', async () => {
    const token = await getToken();
    const album = await createAlbum(token, 'Protected Viewable', 'code123');
    await updateAlbum(token, album.slug, { is_viewable: true });

    const res = await req(`/api/albums/${album.slug}/photos`);
    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toMatchObject({ error: 'Invalid access code' });
  });

  it('allows listing a viewable protected album with the correct code', async () => {
    const token = await getToken();
    const album = await createAlbum(token, 'Protected Viewable OK', 'code123');
    await updateAlbum(token, album.slug, { is_viewable: true });

    const res = await req(`/api/albums/${album.slug}/photos?access_code=code123`);
    expect(res.status).toBe(200);
  });

  it('returns an album asset token that allows authorized photo access', async () => {
    const token = await getToken();
    const album = await createAlbum(token, 'Tokenized Photos');
    await updateAlbum(token, album.slug, { is_viewable: true });

    const slotRes = await requestUpload(album.slug, {
      content_type: 'image/jpeg',
      filename: 'tokenized.jpg',
    });
    const { upload_id } = await slotRes.json() as { upload_id: string };

    await req(`/api/uploads/${upload_id}/file`, {
      method: 'PUT',
      headers: { 'Content-Type': 'image/jpeg' },
      body: new Uint8Array([0xFF, 0xD8]),
    });

    const photosRes = await req(`/api/albums/${album.slug}/photos`);
    expect(photosRes.status).toBe(200);
    const body = await photosRes.json() as {
      asset_token: string;
      photos: Array<{ id: string }>;
    };
    expect(body.asset_token).toBeTruthy();
    expect(body.photos[0].id).toBe(upload_id);

    const assetRes = await req(
      `/api/uploads/${upload_id}/photo?token=${encodeURIComponent(body.asset_token)}`
    );
    expect(assetRes.status).toBe(200);
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
    const assetToken = await getOwnerAlbumAssetToken(token, album.slug);

    const deleteRes = await req(`/api/albums/${album.slug}/uploads/${upload_id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(deleteRes.status).toBe(200);

    // Photo should be gone
    const getRes = await req(`/api/uploads/${upload_id}/photo?token=${encodeURIComponent(assetToken)}`);
    expect(getRes.status).toBe(404);
  });

  it('returns 401 without auth', async () => {
    const res = await req('/api/albums/some-slug/uploads/some-id', {
      method: 'DELETE',
    });
    expect(res.status).toBe(401);
  });
});
