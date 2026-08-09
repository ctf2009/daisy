import { SignJWT, jwtVerify } from 'jose';
import type { Bindings } from '../types';

type TokenScope = 'auth' | 'album-download' | 'album-assets' | 'selected-download' | 'full-download';

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
  asset_policy_version: number;
};

type SelectedDownloadPayload = {
  scope: 'selected-download';
  slug: string;
  ids: string[];
  asset_policy_version: number;
};

type FullDownloadPayload = {
  scope: 'full-download';
  slug: string;
  asset_policy_version: number;
};

function getSecret(env: Bindings): Uint8Array {
  return new TextEncoder().encode(env.JWT_SECRET);
}

async function getAssetPolicyVersion(slug: string, env: Bindings): Promise<number> {
  const album = await env.DB.prepare(
    'SELECT asset_policy_version FROM albums WHERE slug = ?'
  ).bind(slug).first<{ asset_policy_version: number }>();

  if (!album) {
    throw new Error('Album not found');
  }

  return album.asset_policy_version;
}

async function verifyAssetPolicyVersion(
  payload: { asset_policy_version?: unknown },
  slug: string,
  env: Bindings,
): Promise<void> {
  if (typeof payload.asset_policy_version !== 'number') {
    throw new Error('Invalid album asset policy version');
  }

  if (payload.asset_policy_version !== await getAssetPolicyVersion(slug, env)) {
    throw new Error('Album access policy has changed');
  }
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
  const asset_policy_version = await getAssetPolicyVersion(slug, env);
  return new SignJWT({ scope: 'album-assets' satisfies TokenScope, slug, asset_policy_version })
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
  const asset_policy_version = await getAssetPolicyVersion(slug, env);
  return new SignJWT({ scope: 'selected-download' satisfies TokenScope, slug, ids, asset_policy_version })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('5m')
    .sign(getSecret(env));
}

export async function issueFullDownloadToken(slug: string, env: Bindings): Promise<string> {
  const asset_policy_version = await getAssetPolicyVersion(slug, env);
  return new SignJWT({ scope: 'full-download' satisfies TokenScope, slug, asset_policy_version })
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

  await verifyAssetPolicyVersion(typedPayload, slug, env);
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

  await verifyAssetPolicyVersion(typedPayload, slug, env);

  return { ids: typedPayload.ids };
}

export async function verifyFullDownloadToken(
  token: string,
  slug: string,
  env: Bindings
): Promise<void> {
  const { payload } = await jwtVerify(token, getSecret(env));
  const typedPayload = payload as Partial<FullDownloadPayload>;

  if (typedPayload.scope !== 'full-download' || typedPayload.slug !== slug) {
    throw new Error('Invalid full download token');
  }

  await verifyAssetPolicyVersion(typedPayload, slug, env);
}
