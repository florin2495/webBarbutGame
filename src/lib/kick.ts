/** Pending kick: during a running round the host's kick gives the player this long to press "Ignoră". */
export const KICK_GRACE_MS = 10_000;
/** Extra server-side tolerance for network latency before a pending kick is enforced / an ignore is refused. */
export const KICK_NETWORK_GRACE_MS = 2_000;

/** Milliseconds left of a pending kick, clamped to [0, KICK_GRACE_MS]; null when no kick is pending. */
export function kickRemainingMs(requestedAt: string | Date | null | undefined, now = Date.now()): number | null {
  if (!requestedAt) return null;
  const started = new Date(requestedAt).getTime();
  if (Number.isNaN(started)) return null;
  return Math.min(KICK_GRACE_MS, Math.max(0, started + KICK_GRACE_MS - now));
}

/** True once the grace (plus the network tolerance) is over and the player must be removed. */
export function isKickExpired(requestedAt: string | Date | null | undefined, now = Date.now()): boolean {
  if (!requestedAt) return false;
  const started = new Date(requestedAt).getTime();
  if (Number.isNaN(started)) return false;
  return now - started > KICK_GRACE_MS + KICK_NETWORK_GRACE_MS;
}
