import { Hono } from 'hono';
import { cors } from 'hono/cors';
import type { Bindings } from './types';
import { authRoutes } from './routes/auth';
import { albumRoutes } from './routes/albums';
import { uploadRoutes } from './routes/uploads';

const app = new Hono<{ Bindings: Bindings }>();

app.use('*', cors({
  origin: (origin, c) => {
    const frontendUrl = c.env.FRONTEND_URL;
    if (origin === frontendUrl || origin === 'http://localhost:5173') {
      return origin;
    }
    return frontendUrl;
  },
  allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization'],
  credentials: true,
}));

app.onError((err, c) => {
  console.error('Worker error:', err.message, err.stack);
  return c.json({ error: err.message }, 500);
});

// Vanity subdomain redirect — e.g. weddingphotos.tomandcasey.com → /a/{slug}
app.use('*', async (c, next) => {
  const host = c.req.header('host') || '';
  const slug = c.env.DEFAULT_ALBUM_SLUG;
  const path = new URL(c.req.url).pathname;

  // Only redirect the root path on non-primary domains
  if (slug && path === '/' && host !== new URL(c.env.FRONTEND_URL).host) {
    return c.redirect(`/a/${slug}`);
  }

  await next();
});

app.route('/api/auth', authRoutes);
app.route('/api/albums', albumRoutes);
app.route('/api', uploadRoutes);

export default app;
