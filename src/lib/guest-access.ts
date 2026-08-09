import type { Bindings } from '../types';
import { validateAccessCode } from './validation';

const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_MS = 15 * 60 * 1000;

type GuestAccessResult = 'allowed' | 'invalid_code' | 'rate_limited';

type GuestAccessAttempt = {
  attempt_count: number;
  last_attempt_ms: number;
};

type ExpiringGuestAccessAttempt = {
  id: string;
  last_attempt_ms: number;
};

function attemptId(albumId: string, clientIp: string): string {
  return `${albumId}:${clientIp}`;
}

async function removeExpiredAttempts(env: Bindings, albumId: string): Promise<void> {
  const attempts = await env.DB.prepare(
    'SELECT id, last_attempt_ms FROM guest_access_attempts WHERE album_id = ?'
  ).bind(albumId).all<ExpiringGuestAccessAttempt>();
  const cutoff = Date.now() - LOCKOUT_MS;
  const expired = attempts.results.filter((attempt) => attempt.last_attempt_ms < cutoff);

  await Promise.all(expired.map((attempt) =>
    env.DB.prepare('DELETE FROM guest_access_attempts WHERE id = ?').bind(attempt.id).run()
  ));
}

export async function authorizeGuestAlbumAccess(
  env: Bindings,
  albumId: string,
  requiredCode: string | null,
  providedCode: string | undefined,
  clientIp: string,
): Promise<GuestAccessResult> {
  if (!requiredCode) {
    return 'allowed';
  }

  await removeExpiredAttempts(env, albumId);

  const id = attemptId(albumId, clientIp);
  const attempt = await env.DB.prepare(
    'SELECT attempt_count, last_attempt_ms FROM guest_access_attempts WHERE id = ?'
  ).bind(id).first<GuestAccessAttempt>();

  if (attempt && attempt.attempt_count >= MAX_FAILED_ATTEMPTS) {
    return 'rate_limited';
  }

  if (!validateAccessCode(requiredCode, providedCode)) {
    const count = (attempt?.attempt_count || 0) + 1;
    const now = Date.now();
    if (attempt) {
      await env.DB.prepare(
        'UPDATE guest_access_attempts SET attempt_count = ?, last_attempt_ms = ? WHERE id = ?'
      ).bind(count, now, id).run();
    } else {
      await env.DB.prepare(
        'INSERT INTO guest_access_attempts (id, album_id, attempt_count, last_attempt_ms) VALUES (?, ?, ?, ?)'
      ).bind(id, albumId, count, now).run();
    }
    return 'invalid_code';
  }

  await env.DB.prepare('DELETE FROM guest_access_attempts WHERE id = ?').bind(id).run();
  return 'allowed';
}
