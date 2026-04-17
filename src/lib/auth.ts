import { SignJWT, jwtVerify } from 'jose';
import type { Bindings } from '../types';

type TokenScope = 'auth' | 'album-download' | 'album-assets' | 'selected-download';

type AuthPayload = {
  email: string;
  scope: 'auth';
};

type DownloadPayload = {
  email: string;
  scope: 'album-download';
  slug: string;
};

type AlbumAssetsPayload = {
  scope: 'album-assets';
  slug: string;
};

type SelectedDownloadPayload = {
  scope: 'selected-download';
  slug: string;
  ids: string[];
};

function getSecret(env: Bindings): Uint8Array {
  return new TextEncoder().encode(env.JWT_SECRET);
}

export function extractBearerToken(authHeader?: string | null): string | null {
  return authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;
}

export async function issueAuthToken(email: string, env: Bindings): Promise<string> {
  return new SignJWT({ email, scope: 'auth' satisfies TokenScope })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('1h')
    .sign(getSecret(env));
}

export async function issueDownloadToken(email: string, slug: string, env: Bindings): Promise<string> {
  return new SignJWT({ email, scope: 'album-download' satisfies TokenScope, slug })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('5m')
    .sign(getSecret(env));
}

export async function issueAlbumAssetsToken(slug: string, env: Bindings): Promise<string> {
  return new SignJWT({ scope: 'album-assets' satisfies TokenScope, slug })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('6h')
    .sign(getSecret(env));
}

export async function issueSelectedDownloadToken(
  slug: string,
  ids: string[],
  env: Bindings
): Promise<string> {
  return new SignJWT({ scope: 'selected-download' satisfies TokenScope, slug, ids })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('5m')
    .sign(getSecret(env));
}

export async function verifyAuthToken(token: string, env: Bindings): Promise<{ email: string }> {
  const { payload } = await jwtVerify(token, getSecret(env));
  const typedPayload = payload as Partial<AuthPayload>;

  if (typedPayload.scope !== 'auth' || typeof typedPayload.email !== 'string') {
    throw new Error('Invalid token scope');
  }

  return { email: typedPayload.email };
}

export async function verifyDownloadToken(
  token: string,
  slug: string,
  env: Bindings
): Promise<{ email: string }> {
  const { payload } = await jwtVerify(token, getSecret(env));
  const typedPayload = payload as Partial<DownloadPayload>;

  if (
    typedPayload.scope !== 'album-download' ||
    typeof typedPayload.email !== 'string' ||
    typedPayload.slug !== slug
  ) {
    throw new Error('Invalid download token');
  }

  return { email: typedPayload.email };
}

export async function verifyAlbumAssetsToken(
  token: string,
  slug: string,
  env: Bindings
): Promise<void> {
  const { payload } = await jwtVerify(token, getSecret(env));
  const typedPayload = payload as Partial<AlbumAssetsPayload>;

  if (typedPayload.scope !== 'album-assets' || typedPayload.slug !== slug) {
    throw new Error('Invalid album assets token');
  }
}

export async function verifySelectedDownloadToken(
  token: string,
  slug: string,
  env: Bindings
): Promise<{ ids: string[] }> {
  const { payload } = await jwtVerify(token, getSecret(env));
  const typedPayload = payload as Partial<SelectedDownloadPayload>;

  if (
    typedPayload.scope !== 'selected-download' ||
    typedPayload.slug !== slug ||
    !Array.isArray(typedPayload.ids) ||
    typedPayload.ids.some((id) => typeof id !== 'string')
  ) {
    throw new Error('Invalid selected download token');
  }

  return { ids: typedPayload.ids };
}
