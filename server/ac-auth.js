/**
 * Shared AC machine-auth helpers (kept separate to avoid circular imports).
 * Supports split keys + optional previous key for cutover (AC_API_KEY_PREVIOUS).
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

/** Collect accepted AC keys (primary, previous, comma-list, transitional QUEUE). */
export function resolveAcApiKeys(portalEnv = {}) {
  const keys = [];
  const add = (k) => {
    if (typeof k === 'string' && k && !keys.includes(k)) keys.push(k);
  };
  add(portalEnv.AC_API_KEY);
  add(portalEnv.AC_API_KEY_PREVIOUS);
  if (portalEnv.AC_API_KEYS) {
    String(portalEnv.AC_API_KEYS)
      .split(',')
      .map((s) => s.trim())
      .forEach(add);
  }
  if (!keys.length && portalEnv.QUEUE_API_KEY) {
    if (!warnedAcKeyFallback) {
      warnedAcKeyFallback = true;
      console.warn(
        '[shaderp-portal] AC_API_KEY unset — falling back to QUEUE_API_KEY. Set a dedicated AC_API_KEY on Render.',
      );
    }
    add(portalEnv.QUEUE_API_KEY);
  }
  return keys;
}

export function resolveAcApiKey(portalEnv = {}) {
  return resolveAcApiKeys(portalEnv)[0] || '';
}

/** Only X-AC-Key (no x-queue-key / x-admin-key cross-accept). */
export function acApiKeyValid(req, portalEnv) {
  const key = req.headers['x-ac-key'];
  if (!key) return false;
  return resolveAcApiKeys(portalEnv).some((expected) => safeEqualString(key, expected));
}
