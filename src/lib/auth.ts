import { SignJWT, jwtVerify } from 'jose';
import type { Bindings } from '../types';

type TokenScope = 'auth' | 'album-download';

type BasePayload = {
  email: string;
  scope: TokenScope;
};

type DownloadPayload = BasePayload & {
  scope: 'album-download';
  slug: string;
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

export async function verifyAuthToken(token: string, env: Bindings): Promise<{ email: string }> {
  const { payload } = await jwtVerify(token, getSecret(env));

  if (payload.scope !== 'auth' || typeof payload.email !== 'string') {
    throw new Error('Invalid token scope');
  }

  return { email: payload.email };
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
