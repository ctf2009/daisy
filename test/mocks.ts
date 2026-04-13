import type { Bindings } from '../src/types';

// In-memory R2 store
const r2Store = new Map<string, { body: ArrayBuffer; contentType: string }>();

export function createMockR2(): R2Bucket {
  r2Store.clear();
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
    async createMultipartUpload() { throw new Error('not implemented'); },
    resumeMultipartUpload() { throw new Error('not implemented'); },
  } as unknown as R2Bucket;
}

// In-memory D1 using a simple row store
type Row = Record<string, unknown>;
type Table = Row[];

export function createMockD1(): D1Database {
  const tables: Record<string, Table> = {
    albums: [],
    uploads: [],
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
      if (!row.created_at) row.created_at = new Date().toISOString();
      if (!row.updated_at) row.updated_at = new Date().toISOString();
      if (!row.uploaded_at) row.uploaded_at = new Date().toISOString();
      tables[table] = tables[table] || [];
      tables[table].push(row);
      return { results: [], changes: 1 };
    }

    if (trimmed.startsWith('SELECT')) {
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
      // Simple: just return success
      return { results: [], changes: 1 };
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
