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
  exposeHeaders: ['ETag'],
  credentials: true,
}));

app.onError((err, c) => {
  console.error('Worker error:', err.message, err.stack);
  let verbose = false;

  try {
    const host = new URL(c.env.FRONTEND_URL).hostname;
    verbose = host === 'localhost' || host === '127.0.0.1';
  } catch {
    verbose = false;
  }

  return c.json({ error: verbose ? err.message : 'Internal server error' }, 500);
});

// Vanity subdomain redirect — e.g. photos.yourdomain.com → /a/{slug}
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

// For non-API routes, return undefined so CF Workers asset handler serves the SPA
app.all('*', (c) => {
  // Let the asset binding handle it
  const assets = (c.env as Record<string, unknown>).ASSETS as { fetch: typeof fetch } | undefined;
  if (assets) {
    return assets.fetch(c.req.raw);
  }
  return c.notFound();
});

export default app;
