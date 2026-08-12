/**
 * ShadeRP portal — ECDH P-256 handshake oracle for kovert_ac session keys.
 * FX never ships a long-lived static key; shared secret lives ~60s.
 */
import crypto from 'crypto';
import { acApiKeyValid } from './ac-auth.js';

const sessions = new Map();
const MAX = 4000;

function prune() {
  if (sessions.size <= MAX) return;
  const keys = [...sessions.keys()].slice(0, sessions.size - MAX);
  for (const k of keys) sessions.delete(k);
}

function sha256Hex(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

export function registerEcdhRoutes(app, { portalEnv }) {
  app.post('/api/ac/server/ecdh', (req, res) => {
    if (!acApiKeyValid(req, portalEnv)) return res.status(401).json({ error: 'Invalid AC key' });
    const { playerId, clientPub } = req.body || {};
    const hex = String(clientPub || '').replace(/[^0-9a-f]/gi, '');
    if (!hex || hex.length < 64 || hex.length > 200) {
      return res.status(400).json({ error: 'clientPub required' });
    }
    try {
      const ecdh = crypto.createECDH('prime256v1');
      ecdh.generateKeys();
      const secret = ecdh.computeSecret(Buffer.from(hex, 'hex'));
      const keyId = `ecdh_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
      const sharedHex = secret.toString('hex');
      const sharedHash = sha256Hex(secret);
      sessions.set(String(playerId || keyId), {
        keyId,
        sharedHash,
        at: Date.now(),
      });
      prune();
      res.json({
        ok: true,
        keyId,
        serverPub: ecdh.getPublicKey().toString('hex'),
        sharedHex,
        sharedHash: sharedHash.slice(0, 32),
      });
    } catch (err) {
      res.status(400).json({ error: 'ecdh_failed', detail: String(err.message || err).slice(0, 120) });
    }
  });
}
