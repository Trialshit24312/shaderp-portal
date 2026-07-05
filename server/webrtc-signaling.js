/**
 * ShadeRP AC — WebRTC signaling for live watch (15–30 FPS target).
 * Staff browser ↔ portal ↔ FXServer ↔ player NUI peer.
 */
const sessions = new Map();

function getSession(sessionId) {
  return sessions.get(sessionId) || null;
}

export function registerWebrtcRoutes(app, { requireRole }) {
  app.post('/api/ac/admin/webrtc/offer', requireRole('staff'), (req, res) => {
    const { sessionId, playerId, sdp } = req.body || {};
    if (!sessionId || !sdp) return res.status(400).json({ error: 'sessionId and sdp required' });
    const existing = sessions.get(sessionId);
    sessions.set(sessionId, {
      sessionId,
      playerId: playerId ?? existing?.playerId,
      offer: sdp,
      answer: existing?.answer || null,
      staffIce: existing?.staffIce || [],
      playerIce: existing?.playerIce || [],
      dispatched: existing?.dispatched || false,
      at: Date.now(),
    });
    res.json({ ok: true });
  });

  app.post('/api/ac/admin/webrtc/ice', requireRole('staff'), (req, res) => {
    const { sessionId, candidate } = req.body || {};
    const s = getSession(sessionId);
    if (!s || !candidate) return res.status(400).json({ error: 'sessionId and candidate required' });
    s.staffIce.push(candidate);
    s.at = Date.now();
    res.json({ ok: true });
  });

  app.get('/api/ac/admin/webrtc/answer/:sessionId', requireRole('staff'), (req, res) => {
    const s = getSession(req.params.sessionId);
    if (!s?.answer) return res.status(404).json({ error: 'Answer not ready' });
    res.json({ answer: s.answer, playerIce: s.playerIce || [] });
  });

  app.get('/api/ac/admin/webrtc/player-ice/:sessionId', requireRole('staff'), (req, res) => {
    const s = getSession(req.params.sessionId);
    if (!s) return res.status(404).json({ error: 'session not found' });
    const since = Number(req.query.since) || 0;
    const fresh = (s.playerIce || []).slice(since);
    res.json({ candidates: fresh, total: (s.playerIce || []).length });
  });

  app.get('/api/ac/server/webrtc/pending', (req, res) => {
    const key = req.headers['x-ac-key'];
    if (!key) return res.status(401).json({ error: 'Invalid AC key' });
    const pending = [];
    for (const [, s] of sessions) {
      if (s.offer && !s.answer && !s.dispatched) {
        pending.push({ sessionId: s.sessionId, playerId: s.playerId, offer: s.offer });
      }
    }
    res.json({ sessions: pending });
  });

  app.post('/api/ac/server/webrtc/claim', (req, res) => {
    const key = req.headers['x-ac-key'];
    if (!key) return res.status(401).json({ error: 'Invalid AC key' });
    const { sessionId } = req.body || {};
    const s = getSession(sessionId);
    if (!s) return res.status(404).json({ error: 'session not found' });
    s.dispatched = true;
    s.at = Date.now();
    res.json({ ok: true });
  });

  app.post('/api/ac/server/webrtc/answer', (req, res) => {
    const key = req.headers['x-ac-key'];
    if (!key) return res.status(401).json({ error: 'Invalid AC key' });
    const { sessionId, sdp } = req.body || {};
    const s = getSession(sessionId);
    if (!s) return res.status(404).json({ error: 'session not found' });
    s.answer = sdp;
    s.at = Date.now();
    res.json({ ok: true });
  });

  app.post('/api/ac/server/webrtc/ice', (req, res) => {
    const key = req.headers['x-ac-key'];
    if (!key) return res.status(401).json({ error: 'Invalid AC key' });
    const { sessionId, candidate } = req.body || {};
    const s = getSession(sessionId);
    if (!s || !candidate) return res.status(400).json({ error: 'sessionId and candidate required' });
    s.playerIce.push(candidate);
    s.at = Date.now();
    res.json({ ok: true });
  });

  app.get('/api/ac/server/webrtc/staff-ice/:sessionId', (req, res) => {
    const key = req.headers['x-ac-key'];
    if (!key) return res.status(401).json({ error: 'Invalid AC key' });
    const s = getSession(req.params.sessionId);
    if (!s) return res.status(404).json({ error: 'session not found' });
    const since = Number(req.query.since) || 0;
    const fresh = (s.staffIce || []).slice(since);
    res.json({ candidates: fresh, total: (s.staffIce || []).length });
  });

  app.post('/api/ac/server/webrtc/close', (req, res) => {
    const key = req.headers['x-ac-key'];
    if (!key) return res.status(401).json({ error: 'Invalid AC key' });
    const { sessionId } = req.body || {};
    if (sessionId) sessions.delete(sessionId);
    res.json({ ok: true });
  });
}

export function cleanupWebrtcSessions(maxAgeMs = 300000) {
  const now = Date.now();
  for (const [id, s] of sessions) {
    if (now - s.at > maxAgeMs) sessions.delete(id);
  }
}

export function buildIceServers(portalEnv = {}) {
  const servers = [{ urls: 'stun:stun.l.google.com:19302' }];
  const turnUrl = portalEnv.TURN_URL || process.env.TURN_URL || '';
  if (turnUrl) {
    const entry = { urls: turnUrl };
    const user = portalEnv.TURN_USERNAME || process.env.TURN_USERNAME || '';
    const cred = portalEnv.TURN_CREDENTIAL || process.env.TURN_CREDENTIAL || '';
    if (user) {
      entry.username = user;
      entry.credential = cred;
    }
    servers.push(entry);
  }
  return servers;
}

export function registerIceConfigRoute(app, { requireRole, portalEnv }) {
  app.get('/api/ac/admin/ice-config', requireRole('staff'), (_req, res) => {
    res.json({ iceServers: buildIceServers(portalEnv) });
  });
}
