import { Hono } from 'hono';
import type { Bindings } from '../types';
import { issueAuthToken, verifyAuthToken } from '../lib/auth';
import { timingSafeEqual } from '../lib/validation';

const MAX_ATTEMPTS = 5;
const LOCKOUT_MS = 15 * 60 * 1000; // 15 minutes

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

async function getLoginAttempt(env: Bindings, ip: string) {
  return env.DB.prepare(
    'SELECT attempt_count, last_attempt_ms FROM login_attempts WHERE ip_address = ?'
  ).bind(ip).first<{ attempt_count: number; last_attempt_ms: number }>();
}

async function isRateLimited(env: Bindings, ip: string): Promise<boolean> {
  const entry = await getLoginAttempt(env, ip);
  if (!entry) return false;

  if (Date.now() - entry.last_attempt_ms > LOCKOUT_MS) {
    await clearAttempts(env, ip);
    return false;
  }

  return entry.attempt_count >= MAX_ATTEMPTS;
}

async function recordFailedAttempt(env: Bindings, ip: string) {
  const entry = await getLoginAttempt(env, ip);
  const now = Date.now();

  if (entry) {
    await env.DB.prepare(
      'UPDATE login_attempts SET attempt_count = ?, last_attempt_ms = ? WHERE ip_address = ?'
    ).bind(entry.attempt_count + 1, now, ip).run();
    return;
  }

  await env.DB.prepare(
    'INSERT INTO login_attempts (ip_address, attempt_count, last_attempt_ms) VALUES (?, ?, ?)'
  ).bind(ip, 1, now).run();
}

async function clearAttempts(env: Bindings, ip: string) {
  await env.DB.prepare('DELETE FROM login_attempts WHERE ip_address = ?').bind(ip).run();
}

authRoutes.post('/login', async (c) => {
  const ip = c.req.header('CF-Connecting-IP') || c.req.header('X-Forwarded-For') || 'unknown';

  if (await isRateLimited(c.env, ip)) {
    return c.json({ error: 'Too many login attempts. Try again in 15 minutes.' }, 429);
  }

  const { email, password } = await c.req.json<{ email: string; password: string }>();

  if (!email || !password) {
    return c.json({ error: 'Email and password required' }, 400);
  }

  const admins = parseAdminUsers(c.env.ADMIN_USERS);
  const expected = admins.get(email.toLowerCase());

  if (!expected || !timingSafeEqual(expected, password)) {
    await recordFailedAttempt(c.env, ip);
    return c.json({ error: 'Invalid credentials' }, 401);
  }

  await clearAttempts(c.env, ip);

  const token = await issueAuthToken(email.toLowerCase(), c.env);

  return c.json({ token, email: email.toLowerCase() });
});

authRoutes.get('/me', async (c) => {
  const authHeader = c.req.header('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  try {
    const { email } = await verifyAuthToken(authHeader.slice(7), c.env);
    return c.json({ email });
  } catch {
    return c.json({ error: 'Invalid token' }, 401);
  }
});
