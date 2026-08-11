/**
 * Shared AC machine-auth helpers (kept separate to avoid circular imports).
 */
import { timingSafeEqual } from 'crypto';

let warnedAcKeyFallback = false;

function safeEqualString(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || !a || !b) return false;
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

/** Resolve dedicated AC key; QUEUE_API_KEY only as transitional fallback (warn once). */
export function resolveAcApiKey(portalEnv = {}) {
  if (portalEnv.AC_API_KEY) return portalEnv.AC_API_KEY;
  if (portalEnv.QUEUE_API_KEY) {
    if (!warnedAcKeyFallback) {
      warnedAcKeyFallback = true;
      console.warn(
        '[shaderp-portal] AC_API_KEY unset — falling back to QUEUE_API_KEY. Set a dedicated AC_API_KEY on Render.',
      );
    }
    return portalEnv.QUEUE_API_KEY;
  }
  return '';
}

/** Only X-AC-Key (no x-queue-key / x-admin-key cross-accept). */
export function acApiKeyValid(req, portalEnv) {
  const key = req.headers['x-ac-key'];
  const expected = resolveAcApiKey(portalEnv);
  return !!expected && safeEqualString(key, expected);
}
