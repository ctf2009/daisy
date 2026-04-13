const API_BASE = import.meta.env.DEV ? 'http://localhost:8787' : '';

function getToken(): string | null {
  return localStorage.getItem('daisy_token');
}

export function setToken(token: string) {
  localStorage.setItem('daisy_token', token);
}

export function clearToken() {
  localStorage.removeItem('daisy_token');
}

export function isLoggedIn(): boolean {
  return !!getToken();
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = getToken();
  const headers: Record<string, string> = {
    ...options.headers as Record<string, string>,
  };

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  if (!(options.body instanceof FormData)) {
    headers['Content-Type'] = headers['Content-Type'] || 'application/json';
  }

  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers,
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: 'Request failed' }));
    throw new Error(body.error || `HTTP ${res.status}`);
  }

  return res.json();
}

// Auth
export const api = {
  login: (email: string, password: string) =>
    request<{ token: string; email: string }>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    }),

  getMe: () =>
    request<{ email: string }>('/api/auth/me'),

  // Albums
  createAlbum: (data: { name: string; access_code?: string; welcome_text?: string }) =>
    request<{ id: string; slug: string; name: string }>('/api/albums', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  getAlbum: (slug: string) =>
    request<{
      name: string;
      slug: string;
      welcome_text: string | null;
      background_url: string | null;
      requires_code: boolean;
    }>(`/api/albums/${slug}`),

  getAlbumManage: (slug: string) =>
    request<{
      id: string;
      name: string;
      slug: string;
      access_code: string | null;
      welcome_text: string | null;
      uploads: Array<{
        id: string;
        original_filename: string;
        content_type: string;
        file_size: number;
        uploaded_at: string;
      }>;
    }>(`/api/albums/${slug}/manage`),

  listAlbums: () =>
    request<{
      albums: Array<{
        id: string;
        name: string;
        slug: string;
        created_at: string;
        upload_count: number;
      }>;
    }>('/api/albums'),

  updateAlbum: (slug: string, data: { name?: string; access_code?: string | null; welcome_text?: string | null }) =>
    request<{ ok: true }>(`/api/albums/${slug}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    }),

  uploadBackground: (slug: string, file: File) => {
    const formData = new FormData();
    formData.append('file', file);
    return request<{ ok: true }>(`/api/albums/${slug}/background`, {
      method: 'POST',
      body: formData,
    });
  },

  deleteUpload: (slug: string, uploadId: string) =>
    request<{ ok: true }>(`/api/albums/${slug}/uploads/${uploadId}`, {
      method: 'DELETE',
    }),

  downloadAlbum: async (
    slug: string,
    photos: Array<{ id: string; original_filename: string }>,
    albumName: string,
    onProgress?: (done: number, total: number) => void,
  ) => {
    const { zipSync } = await import('fflate');

    const files: Record<string, Uint8Array> = {};
    const seenNames = new Set<string>();

    for (let i = 0; i < photos.length; i++) {
      const photo = photos[i];
      const res = await fetch(`${API_BASE}/api/uploads/${photo.id}/photo`);
      if (!res.ok) continue;

      const arrayBuf = await res.arrayBuffer();

      let name = photo.original_filename || 'photo.jpg';
      if (seenNames.has(name)) {
        const ext = name.lastIndexOf('.');
        const base = ext > 0 ? name.slice(0, ext) : name;
        const suffix = ext > 0 ? name.slice(ext) : '';
        let j = 2;
        while (seenNames.has(`${base}_${j}${suffix}`)) j++;
        name = `${base}_${j}${suffix}`;
      }
      seenNames.add(name);

      files[name] = new Uint8Array(arrayBuf);
      onProgress?.(i + 1, photos.length);
    }

    const zipped = zipSync(files);
    const blob = new Blob([zipped], { type: 'application/zip' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${albumName.replace(/[^a-zA-Z0-9_-]/g, '_')}_photos.zip`;
    a.click();
    URL.revokeObjectURL(url);
  },

  // Uploads
  requestUpload: (slug: string, data: { content_type: string; filename: string; access_code?: string }) =>
    request<{ upload_id: string; r2_key: string; thumbnail_key: string }>(`/api/albums/${slug}/upload`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  uploadFile: (uploadId: string, file: Blob, contentType: string) =>
    fetch(`${API_BASE}/api/uploads/${uploadId}/file`, {
      method: 'PUT',
      body: file,
      headers: { 'Content-Type': contentType },
    }),

  uploadThumbnail: (uploadId: string, file: Blob) =>
    fetch(`${API_BASE}/api/uploads/${uploadId}/thumbnail`, {
      method: 'PUT',
      body: file,
      headers: { 'Content-Type': 'image/jpeg' },
    }),

  getPhotoUrl: (uploadId: string) =>
    `${API_BASE}/api/uploads/${uploadId}/photo`,

  getThumbnailUrl: (uploadId: string) =>
    `${API_BASE}/api/uploads/${uploadId}/thumbnail`,

  getAlbumPhotos: (slug: string, accessCode?: string) =>
    request<{
      photos: Array<{
        id: string;
        original_filename: string;
        content_type: string;
        uploaded_at: string;
      }>;
    }>(`/api/albums/${slug}/photos${accessCode ? `?${new URLSearchParams({ access_code: accessCode })}` : ''}`),
};
