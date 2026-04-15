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

async function uploadBinary(path: string, file: Blob, contentType: string): Promise<void> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'PUT',
    body: file,
    headers: { 'Content-Type': contentType },
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: 'Upload failed' }));
    throw new Error(body.error || `HTTP ${res.status}`);
  }
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
      is_open: boolean;
      requires_code: boolean;
    }>(`/api/albums/${slug}`),

  getAlbumManage: (slug: string) =>
    request<{
      id: string;
      name: string;
      slug: string;
      access_code: string | null;
      is_open: number;
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

  updateAlbum: (slug: string, data: { name?: string; access_code?: string | null; welcome_text?: string | null; is_open?: boolean }) =>
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

  downloadAlbum: async (slug: string) => {
    const { token } = await request<{ token: string }>(`/api/albums/${slug}/download-token`, {
      method: 'POST',
    });

    const url = `${API_BASE}/api/albums/${slug}/download?${new URLSearchParams({ token })}`;
    const a = document.createElement('a');
    a.href = url;
    a.click();
  },

  // Uploads
  requestUpload: (slug: string, data: { content_type: string; filename: string; access_code?: string }) =>
    request<{ upload_id: string; r2_key: string; thumbnail_key: string }>(`/api/albums/${slug}/upload`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  uploadFile: (uploadId: string, file: Blob, contentType: string) =>
    uploadBinary(`/api/uploads/${uploadId}/file`, file, contentType),

  uploadThumbnail: (uploadId: string, file: Blob) =>
    uploadBinary(`/api/uploads/${uploadId}/thumbnail`, file, 'image/jpeg'),

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
