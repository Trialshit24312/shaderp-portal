# Deploy ShadeRP Portal to Render — quick checklist

## Before you start

- GitHub account
- [Render](https://render.com) account (free tier works)
- [Discord Developer Portal](https://discord.com/developers/applications) access
- Admin on your ShadeRP Discord server

---

## Step 1 — Put the portal on GitHub

**Option A — whole repo (easiest if txData is already on GitHub)**

1. Push `F:\txData` to GitHub
2. On Render, set **Root Directory** to: `QBCore_A9FD7A.base/tools/shaderp-dashboard`

**Option B — portal-only repo**

1. Create a new repo e.g. `shaderp-portal`
2. Copy everything inside `tools/shaderp-dashboard/` to the repo root
3. Push to GitHub

---

## Step 2 — Create the Render Web Service

1. [render.com](https://render.com) → **New +** → **Blueprint** (or **Web Service**)
2. Connect your GitHub repo
3. Render reads `render.yaml` automatically:
   - Build: `npm install`
   - Start: `npm start`
   - Health: `/health`
4. Pick **Free** plan (first load after idle ~30s)
5. Deploy — note your URL, e.g. `https://shaderp-portal.onrender.com`

---

## Step 3 — Discord OAuth app

1. [Discord Developer Portal](https://discord.com/developers/applications) → **New Application** → `ShadeRP Portal`
2. **OAuth2 → Redirects** — add exactly:
   ```
   https://YOUR-APP.onrender.com/auth/discord/callback
   ```
3. Copy **Client ID** and **Client Secret**
4. **Bot** tab → create bot → copy **token**
5. **Bot → Privileged Gateway Intents** → enable **Server Members Intent**
6. Invite bot to your Discord (needs to see members + roles)

**Get IDs (Developer Mode ON in Discord settings):**

| What | How |
|------|-----|
| Guild ID | Right-click server icon → Copy Server ID |
| Role IDs | Server Settings → Roles → right-click role → Copy Role ID |
| Your user ID | Right-click your name → Copy User ID |

---

## Step 4 — Render environment variables

Render → your service → **Environment** → add:

| Variable | Value |
|----------|--------|
| `NODE_ENV` | `production` |
| `SESSION_SECRET` | *(Render can auto-generate)* |
| `DISCORD_CLIENT_ID` | From Discord app |
| `DISCORD_CLIENT_SECRET` | From Discord app |
| `DISCORD_CALLBACK_URL` | `https://YOUR-APP.onrender.com/auth/discord/callback` |
| `DISCORD_BOT_TOKEN` | Bot token |
| `DISCORD_GUILD_ID` | Your Discord server ID |
| `DISCORD_INVITE_URL` | `https://discord.gg/sbnu98HYAZ` |
| `PORTAL_OWNER_IDS` | Your Discord user ID |
| `SYNC_API_KEY` | Long random string *(auto-generate)* |
| `PORTAL_ROLE_MAP` | See below |
| `PORTAL_NAME` | `ShadeRP` |
| `PORTAL_TAGLINE` | `ESX Legacy Roleplay` |

**PORTAL_ROLE_MAP** (one line, replace IDs):

```json
{"OWNER_ROLE_ID":"owner","ADMIN_ROLE_ID":"admin","STAFF_ROLE_ID":"staff","MOD_ROLE_ID":"moderator","MEMBER_ROLE_ID":"member"}
```

Save → Render redeploys automatically.

---

## Step 5 — Wire the FiveM server

1. Edit `resources/[standalone]/shade-config/config/portal.lua`:
   - Set `websiteUrl` to your Render URL
   - Set `cfxJoinCode` / `cfxJoinUrl` when you have a live CFX code

2. From PowerShell:
   ```powershell
   cd F:\txData\QBCore_A9FD7A.base\tools\shaderp-dashboard
   .\Apply-PortalLinks.ps1
   ```

3. Push server data to the cloud:
   ```powershell
   $env:PORTAL_URL = "https://YOUR-APP.onrender.com"
   $env:SYNC_API_KEY = "paste-from-render-env"
   .\Sync-PortalToRender.ps1
   ```

4. In txAdmin console (optional):
   ```
   restart shade-config
   restart tuff-loading
   ```

---

## Step 6 — Verify

| Check | Expected |
|-------|----------|
| `https://YOUR-APP.onrender.com/health` | `{"ok":true}` |
| Home page | Dark theme, ShadeRP logo |
| Login with Discord | Shows your role badge |
| Connect panel | Shows cfx join code from portal.lua |
| Staff login | Analytics + Staff Hub visible |

---

## After every server config change

```powershell
$env:PORTAL_URL = "https://YOUR-APP.onrender.com"
$env:SYNC_API_KEY = "your-key"
F:\txData\QBCore_A9FD7A.base\tools\shaderp-dashboard\Sync-PortalToRender.ps1
```

---

## Notes

- **Free tier:** analytics reset on redeploy (ephemeral disk). Upgrade for persistence.
- **Never commit** `.env` or `SYNC_API_KEY` to git.
- Full reference: `RENDER-SETUP.md`
