import { Context, Next } from 'hono';
import { jwtVerify } from 'jose';
import type { Bindings } from '../types';

export async function requireAuth(c: Context<{ Bindings: Bindings; Variables: { userEmail: string } }>, next: Next) {
  // Accept token from Authorization header or ?token= query param (for browser downloads)
  const authHeader = c.req.header('Authorization');
  const queryToken = c.req.query('token');
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : queryToken;

  if (!token) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  try {
    const secret = new TextEncoder().encode(c.env.JWT_SECRET);
    const { payload } = await jwtVerify(token, secret);
    c.set('userEmail', payload.email as string);
    await next();
  } catch {
    return c.json({ error: 'Invalid or expired token' }, 401);
  }
}
