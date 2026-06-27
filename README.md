# ShadeRP Portal

Dark-theme community portal for ShadeRP — Discord OAuth, role sync, analytics, and server dashboard sync.

**Deploy to Render:** see [DEPLOY-QUICKSTART.md](./DEPLOY-QUICKSTART.md)

## Quick start (local)

```bash
npm install
copy .env.example .env   # Windows
npm start
```

Open http://localhost:8787

## Sync from FiveM server (Windows)

From your full server repo, run:

```powershell
$env:PORTAL_URL = "https://your-app.onrender.com"
$env:SYNC_API_KEY = "your-render-sync-key"
.\Sync-PortalToRender.ps1
```

This repo is **standalone** (~3 MB) — separate from the full FiveM `txData` server so it can deploy to Render/GitHub easily.
