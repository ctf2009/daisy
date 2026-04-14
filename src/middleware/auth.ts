import { Context, Next } from 'hono';
import type { Bindings } from '../types';
import { extractBearerToken, verifyAuthToken } from '../lib/auth';

export async function requireAuth(c: Context<{ Bindings: Bindings; Variables: { userEmail: string } }>, next: Next) {
  const token = extractBearerToken(c.req.header('Authorization'));

  if (!token) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  try {
    const { email } = await verifyAuthToken(token, c.env);
    c.set('userEmail', email);
    await next();
  } catch {
    return c.json({ error: 'Invalid or expired token' }, 401);
  }
}
