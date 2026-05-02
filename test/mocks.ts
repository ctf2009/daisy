import type { Bindings } from '../src/types';

// In-memory R2 store
const r2Store = new Map<string, { body: ArrayBuffer; contentType: string }>();

const multipartUploads = new Map<string, R2MultipartUpload>();

export function createMockR2(): R2Bucket {
  r2Store.clear();
  multipartUploads.clear();
  return {
    async get(key: string) {
      const item = r2Store.get(key);
      if (!item) return null;
      return {
        body: new ReadableStream({
          start(controller) {
            controller.enqueue(new Uint8Array(item.body));
            controller.close();
          },
        }),
        httpMetadata: { contentType: item.contentType },
      } as unknown as R2ObjectBody;
    },
    async put(key: string, value: unknown, options?: R2PutOptions) {
      let bytes: ArrayBuffer;
      if (value instanceof ArrayBuffer) {
        bytes = value;
      } else if (value instanceof Uint8Array) {
        bytes = value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength);
      } else if (value instanceof ReadableStream) {
        const reader = value.getReader();
        const chunks: Uint8Array[] = [];
        while (true) {
          const { done, value: chunk } = await reader.read();
          if (done) break;
          chunks.push(new Uint8Array(chunk));
        }
        const total = chunks.reduce((s, c) => s + c.length, 0);
        const merged = new Uint8Array(total);
        let offset = 0;
        for (const c of chunks) { merged.set(c, offset); offset += c.length; }
        bytes = merged.buffer;
      } else {
        bytes = new TextEncoder().encode(String(value)).buffer;
      }
      const ct = (options?.httpMetadata as { contentType?: string })?.contentType || 'application/octet-stream';
      r2Store.set(key, { body: bytes, contentType: ct });
      return null as unknown as R2Object;
    },
    async delete(keys: string | string[]) {
      for (const k of Array.isArray(keys) ? keys : [keys]) r2Store.delete(k);
    },
    async head() { return null; },
    async list() { return { objects: [], truncated: false, delimitedPrefixes: [] } as unknown as R2Objects; },
    async createMultipartUpload(key: string, options?: R2MultipartOptions) {
      const uploadId = `mpu_${crypto.randomUUID()}`;
      const parts: Array<{ partNumber: number; etag: string; data: ArrayBuffer }> = [];
      const ct = (options?.httpMetadata as { contentType?: string })?.contentType || 'application/octet-stream';

      const multipartUpload: R2MultipartUpload = {
        key,
        uploadId,
        async uploadPart(partNumber: number, value: unknown) {
          let bytes: ArrayBuffer;
          if (value instanceof ArrayBuffer) {
            bytes = value;
          } else if (value instanceof Uint8Array) {
            bytes = value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength);
          } else {
            bytes = new TextEncoder().encode(String(value)).buffer;
          }
          const etag = `etag_${partNumber}_${bytes.byteLength}`;
          const existingIndex = parts.findIndex((part) => part.partNumber === partNumber);
          if (existingIndex >= 0) {
            parts[existingIndex] = { partNumber, etag, data: bytes };
          } else {
            parts.push({ partNumber, etag, data: bytes });
          }
          return { partNumber, etag } as R2UploadedPart;
        },
        async abort() {
          parts.length = 0;
        },
        async complete(uploadedParts: R2UploadedPart[]) {
          // Assemble all parts into final object
          const total = parts
            .filter(p => uploadedParts.some(up => up.partNumber === p.partNumber))
            .reduce((s, p) => s + p.data.byteLength, 0);
          const merged = new Uint8Array(total);
          let offset = 0;
          for (const up of [...uploadedParts].sort((a, b) => a.partNumber - b.partNumber)) {
            const part = parts.find(p => p.partNumber === up.partNumber);
            if (part) {
              merged.set(new Uint8Array(part.data), offset);
              offset += part.data.byteLength;
            }
          }
          r2Store.set(key, { body: merged.buffer, contentType: ct });
          return { size: total } as unknown as R2Object;
        },
      } as unknown as R2MultipartUpload;

      // Store the multipart object so resumeMultipartUpload can find it
      multipartUploads.set(`${key}:${uploadId}`, multipartUpload);
      return multipartUpload;
    },
    resumeMultipartUpload(key: string, uploadId: string) {
      const existing = multipartUploads.get(`${key}:${uploadId}`);
      if (!existing) {
        // Return a stub that throws on use (matches R2 behavior for unknown uploads)
        return {
          key,
          uploadId,
          async uploadPart() { throw new Error('Multipart upload not found'); },
          async abort() {},
          async complete() { throw new Error('Multipart upload not found'); },
        } as unknown as R2MultipartUpload;
      }
      return existing;
    },
  } as unknown as R2Bucket;
}

// In-memory D1 using a simple row store
type Row = Record<string, unknown>;
type Table = Row[];

export function createMockD1(): D1Database {
  const tables: Record<string, Table> = {
    albums: [],
    uploads: [],
    upload_parts: [],
    login_attempts: [],
  };

  function runQuery(sql: string, params: unknown[]): { results: Row[]; changes: number } {
    const trimmed = sql.trim().toUpperCase();

    if (trimmed.startsWith('INSERT INTO')) {
      const tableMatch = sql.match(/INSERT INTO (\w+)/i);
      if (!tableMatch) throw new Error(`Bad INSERT: ${sql}`);
      const table = tableMatch[1];
      const colsMatch = sql.match(/\(([^)]+)\)\s*VALUES/i);
      if (!colsMatch) throw new Error(`Bad INSERT cols: ${sql}`);
      const cols = colsMatch[1].split(',').map(c => c.trim());
      const row: Row = {};
      cols.forEach((col, i) => { row[col] = params[i]; });
      // Set defaults
      if (row.is_open === undefined && table === 'albums') row.is_open = 1;
      if (row.is_viewable === undefined && table === 'albums') row.is_viewable = 0;
      if (!row.created_at) row.created_at = new Date().toISOString();
      if (!row.updated_at) row.updated_at = new Date().toISOString();
      if (!row.uploaded_at) row.uploaded_at = new Date().toISOString();
      tables[table] = tables[table] || [];
      tables[table].push(row);
      return { results: [], changes: 1 };
    }

    if (trimmed.startsWith('SELECT')) {
      if (/SELECT\s+A\./i.test(sql) && /UPLOAD_COUNT/i.test(sql)) {
        const albums = tables.albums || [];
        const uploads = tables.uploads || [];
        const ownerEmail = params[0];

        let filteredAlbums = albums.filter((album) => album.owner_email === ownerEmail);
        if (sql.match(/ORDER BY.*DESC/i)) {
          filteredAlbums = [...filteredAlbums].reverse();
        }

        return {
          results: filteredAlbums.map((album) => ({
            id: album.id,
            name: album.name,
            slug: album.slug,
            created_at: album.created_at,
            upload_count: uploads.filter(
              (upload) => upload.album_id === album.id && typeof upload.file_size === 'number'
            ).length,
          })),
          changes: 0,
        };
      }

      if (/FROM\s+UPLOADS/i.test(trimmed) && /JOIN\s+ALBUMS/i.test(trimmed) && /WHERE\s+UPLOADS\.ID\s*=\s*\?/i.test(trimmed)) {
        const uploadId = params[0];
        const uploads = tables.uploads || [];
        const albums = tables.albums || [];
        const upload = uploads.find((row) => row.id === uploadId);

        if (!upload) {
          return { results: [], changes: 0 };
        }

        const album = albums.find((row) => row.id === upload.album_id);
        if (!album) {
          return { results: [], changes: 0 };
        }

        return {
          results: [{
            r2_key: upload.r2_key,
            thumbnail_key: upload.thumbnail_key,
            content_type: upload.content_type,
            slug: album.slug,
            owner_email: album.owner_email,
          }],
          changes: 0,
        };
      }

      const tableMatch = sql.match(/FROM (\w+)/i);
      if (!tableMatch) throw new Error(`Bad SELECT: ${sql}`);
      const table = tableMatch[1];
      const rows = tables[table] || [];

      // Parse WHERE clauses
      const whereMatch = sql.match(/WHERE (.+?)(?:ORDER|LIMIT|$)/i);
      let filtered = rows;
      if (whereMatch) {
        const conditions = whereMatch[1].split(/\s+AND\s+/i);
        filtered = rows.filter(row => {
          let paramIdx = 0;
          return conditions.every(cond => {
            const notNullMatch = cond.trim().match(/(\w+)\s+IS\s+NOT\s+NULL/i);
            if (notNullMatch) {
              return row[notNullMatch[1]] !== null && row[notNullMatch[1]] !== undefined;
            }

            const m = cond.trim().match(/(\w+)\s*=\s*\?/);
            if (m) {
              const val = params[paramIdx++];
              return row[m[1]] === val;
            }
            paramIdx++;
            return true;
          });
        });
      }

      // Handle ORDER BY DESC
      if (sql.match(/ORDER BY.*DESC/i)) {
        filtered = [...filtered].reverse();
      }

      // Handle COUNT(*)
      if (sql.match(/COUNT\(\*\)/i)) {
        return { results: [{ count: filtered.length }], changes: 0 };
      }

      return { results: filtered, changes: 0 };
    }

    if (trimmed.startsWith('UPDATE')) {
      const tableMatch = sql.match(/UPDATE (\w+)/i);
      if (!tableMatch) throw new Error(`Bad UPDATE: ${sql}`);
      const table = tableMatch[1];
      const rows = tables[table] || [];
      const setMatch = sql.match(/SET\s+([\s\S]+?)\s+WHERE/i);
      const whereMatch = sql.match(/WHERE (\w+)\s*=\s*\?/i);
      if (!setMatch || !whereMatch) throw new Error(`Bad UPDATE body: ${sql}`);

      const assignments = setMatch[1]
        .split(',')
        .map(part => part.trim())
        .filter(part => !part.includes("datetime('now')"));

      const whereColumn = whereMatch[1];
      const whereValue = params[assignments.length];
      let changes = 0;

      for (const row of rows) {
        if (row[whereColumn] !== whereValue) continue;

        assignments.forEach((assignment, index) => {
          const match = assignment.match(/^(\w+)\s*=\s*\?$/);
          if (match) {
            row[match[1]] = params[index];
          }
        });
        row.updated_at = new Date().toISOString();
        changes++;
      }

      return { results: [], changes };
    }

    if (trimmed.startsWith('DELETE')) {
      const tableMatch = sql.match(/FROM (\w+)/i);
      if (!tableMatch) throw new Error(`Bad DELETE: ${sql}`);
      const table = tableMatch[1];
      const whereMatch = sql.match(/WHERE (\w+)\s*=\s*\?/i);
      if (whereMatch) {
        const col = whereMatch[1];
        const val = params[0];
        tables[table] = (tables[table] || []).filter(row => row[col] !== val);
      }
      return { results: [], changes: 1 };
    }

    return { results: [], changes: 0 };
  }

  function createStatement(sql: string): D1PreparedStatement {
    let boundParams: unknown[] = [];

    const stmt: D1PreparedStatement = {
      bind(...params: unknown[]) {
        boundParams = params;
        return stmt;
      },
      async first<T>(col?: string): Promise<T | null> {
        const { results } = runQuery(sql, boundParams);
        if (results.length === 0) return null;
        if (col) return results[0][col] as T;
        return results[0] as T;
      },
      async all() {
        const { results } = runQuery(sql, boundParams);
        return { results, success: true, meta: {} } as unknown as D1Result;
      },
      async run() {
        const { changes } = runQuery(sql, boundParams);
        return { success: true, meta: { changes } } as unknown as D1Result;
      },
      async raw() {
        const { results } = runQuery(sql, boundParams);
        return results.map(r => Object.values(r));
      },
    } as unknown as D1PreparedStatement;

    return stmt;
  }

  return {
    prepare: (sql: string) => createStatement(sql),
    async exec() { return { count: 0, duration: 0 } as unknown as D1ExecResult; },
    batch: async (stmts: D1PreparedStatement[]) => {
      const results = [];
      for (const s of stmts) results.push(await s.all());
      return results;
    },
    dump: async () => new ArrayBuffer(0),
  } as unknown as D1Database;
}

export function createTestBindings(overrides?: Partial<Bindings>): Bindings {
  return {
    DB: createMockD1(),
    PHOTOS: createMockR2(),
    ADMIN_USERS: 'test@example.com:testpass,admin@test.com:secret',
    JWT_SECRET: 'test-jwt-secret-for-testing-only',
    FRONTEND_URL: 'http://localhost:5173',
    ...overrides,
  };
}
