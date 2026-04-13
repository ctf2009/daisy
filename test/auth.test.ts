import { describe, it, expect, beforeEach } from 'vitest';
import app from '../src/index';
import { createTestBindings } from './mocks';
import type { Bindings } from '../src/types';

let bindings: Bindings;

function req(path: string, init?: RequestInit) {
  return app.request(path, init, bindings);
}

async function login(email = 'test@example.com', password = 'testpass') {
  const res = await req('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  return res;
}

async function getToken(email = 'test@example.com', password = 'testpass') {
  const res = await login(email, password);
  const body = await res.json() as { token: string };
  return body.token;
}

describe('POST /api/auth/login', () => {
  beforeEach(() => { bindings = createTestBindings(); });

  it('returns 400 with missing credentials', async () => {
    const res = await req('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });

  it('returns 401 with wrong password', async () => {
    const res = await login('test@example.com', 'wrong');
    expect(res.status).toBe(401);
  });

  it('returns 401 with unknown email', async () => {
    const res = await login('nobody@example.com', 'testpass');
    expect(res.status).toBe(401);
  });

  it('returns JWT on valid login', async () => {
    const res = await login();
    expect(res.status).toBe(200);
    const body = await res.json() as { token: string; email: string };
    expect(body.token).toBeTruthy();
    expect(body.email).toBe('test@example.com');
  });

  it('is case-insensitive on email', async () => {
    const res = await login('TEST@EXAMPLE.COM', 'testpass');
    expect(res.status).toBe(200);
    const body = await res.json() as { email: string };
    expect(body.email).toBe('test@example.com');
  });

  it('works with second admin user', async () => {
    const res = await login('admin@test.com', 'secret');
    expect(res.status).toBe(200);
  });
});

describe('GET /api/auth/me', () => {
  beforeEach(() => { bindings = createTestBindings(); });

  it('returns 401 without auth header', async () => {
    const res = await req('/api/auth/me');
    expect(res.status).toBe(401);
  });

  it('returns 401 with invalid token', async () => {
    const res = await req('/api/auth/me', {
      headers: { Authorization: 'Bearer garbage' },
    });
    expect(res.status).toBe(401);
  });

  it('returns user email with valid token', async () => {
    const token = await getToken();
    const res = await req('/api/auth/me', {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { email: string };
    expect(body.email).toBe('test@example.com');
  });
});
