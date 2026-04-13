import { Hono } from 'hono';
import { SignJWT, jwtVerify } from 'jose';
import type { Bindings } from '../types';
import { timingSafeEqual } from '../lib/validation';

const MAX_ATTEMPTS = 5;
const LOCKOUT_MS = 15 * 60 * 1000; // 15 minutes

const loginAttempts = new Map<string, { count: number; lastAttempt: number }>();

function isRateLimited(ip: string): boolean {
  const entry = loginAttempts.get(ip);
  if (!entry) return false;
  if (Date.now() - entry.lastAttempt > LOCKOUT_MS) {
    loginAttempts.delete(ip);
    return false;
  }
  return entry.count >= MAX_ATTEMPTS;
}

function recordFailedAttempt(ip: string) {
  const entry = loginAttempts.get(ip);
  if (entry) {
    entry.count++;
    entry.lastAttempt = Date.now();
  } else {
    loginAttempts.set(ip, { count: 1, lastAttempt: Date.now() });
  }
}

function clearAttempts(ip: string) {
  loginAttempts.delete(ip);
}

export const authRoutes = new Hono<{ Bindings: Bindings }>();

function parseAdminUsers(raw: string): Map<string, string> {
  const users = new Map<string, string>();
  for (const pair of raw.split(',')) {
    const [email, password] = pair.trim().split(':');
    if (email && password) {
      users.set(email.toLowerCase(), password);
    }
  }
  return users;
}

authRoutes.post('/login', async (c) => {
  const ip = c.req.header('CF-Connecting-IP') || c.req.header('X-Forwarded-For') || 'unknown';

  if (isRateLimited(ip)) {
    return c.json({ error: 'Too many login attempts. Try again in 15 minutes.' }, 429);
  }

  const { email, password } = await c.req.json<{ email: string; password: string }>();

  if (!email || !password) {
    return c.json({ error: 'Email and password required' }, 400);
  }

  const admins = parseAdminUsers(c.env.ADMIN_USERS);
  const expected = admins.get(email.toLowerCase());

  if (!expected || !timingSafeEqual(expected, password)) {
    recordFailedAttempt(ip);
    return c.json({ error: 'Invalid credentials' }, 401);
  }

  clearAttempts(ip);

  const secret = new TextEncoder().encode(c.env.JWT_SECRET);
  const token = await new SignJWT({ email: email.toLowerCase() })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('1h')
    .sign(secret);

  return c.json({ token, email: email.toLowerCase() });
});

authRoutes.get('/me', async (c) => {
  const authHeader = c.req.header('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  try {
    const secret = new TextEncoder().encode(c.env.JWT_SECRET);
    const { payload } = await jwtVerify(authHeader.slice(7), secret);
    return c.json({ email: payload.email });
  } catch {
    return c.json({ error: 'Invalid token' }, 401);
  }
});
