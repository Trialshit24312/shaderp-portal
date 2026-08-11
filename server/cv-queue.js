/**
 * Async CV job queue — optional Python YOLO/OpenCV worker.
 * Set CV_WORKER_URL (e.g. http://127.0.0.1:8091) to enable.
 */
const jobs = new Map();
const MAX_JOBS = 200;

function prune() {
  if (jobs.size <= MAX_JOBS) return;
  const keys = [...jobs.keys()].slice(0, jobs.size - MAX_JOBS);
  for (const k of keys) jobs.delete(k);
}

export function enqueueCvJob({ sessionId, playerId, image, acManager }) {
  const id = `cv_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const job = {
    id,
    sessionId: sessionId || null,
    playerId: playerId ?? null,
    status: 'queued',
    labels: [],
    cheatScore: 0,
    at: Date.now(),
  };
  jobs.set(id, job);
  prune();

  const workerUrl = (process.env.CV_WORKER_URL || '').replace(/\/+$/, '');
  if (!workerUrl || !image) {
    job.status = 'skipped';
    job.note = workerUrl ? 'missing image' : 'CV_WORKER_URL not set — staff-review OCR only';
    return job;
  }

  job.status = 'running';
  fetch(`${workerUrl}/analyze`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-AC-Key': process.env.AC_API_KEY || process.env.QUEUE_API_KEY || '',
    },
    body: JSON.stringify({ jobId: id, sessionId, playerId, image }),
  })
    .then(async (res) => {
      const data = await res.json().catch(() => ({}));
      job.status = res.ok ? 'done' : 'error';
      job.labels = data.labels || [];
      job.cheatScore = Number(data.cheatScore) || 0;
      job.note = data.note || null;
      if (job.cheatScore >= Number(process.env.CV_FLAG_THRESHOLD || 0.82) && acManager?.pushDetection) {
        acManager.pushDetection({
          playerId,
          playerName: `Player ${playerId}`,
          detection: 'Vision Overlay',
          priority: 'high',
          trust: null,
          details: {
            detail: (job.labels || []).join(', ') || 'suspicious_ui',
            module: 'cv-worker',
            staffReviewOnly: true,
            cheatScore: job.cheatScore,
            jobId: id,
          },
        });
      }
    })
    .catch((err) => {
      job.status = 'error';
      job.note = err.message;
    });

  return job;
}

export function getCvJob(id) {
  return jobs.get(id) || null;
}

export function registerCvRoutes(app, { requireRole, portalEnv, acApiKeyValid, acManager }) {
  app.post('/api/ac/server/cv-analyze', (req, res) => {
    if (!acApiKeyValid(req, portalEnv)) return res.status(401).json({ error: 'Invalid AC key' });
    const { sessionId, playerId, image } = req.body || {};
    if (!image) return res.status(400).json({ error: 'image required' });
    const job = enqueueCvJob({ sessionId, playerId, image, acManager });
    res.json({
      ok: true,
      jobId: job.id,
      sessionId: sessionId || null,
      playerId: playerId || null,
      labels: job.labels,
      cheatScore: job.cheatScore,
      status: job.status,
      note: job.note || 'queued for CV worker (staff-review only; never auto-ban)',
    });
  });

  app.get('/api/ac/admin/cv-job/:id', requireRole('staff'), (req, res) => {
    const job = getCvJob(req.params.id);
    if (!job) return res.status(404).json({ error: 'job not found' });
    res.json(job);
  });
}
