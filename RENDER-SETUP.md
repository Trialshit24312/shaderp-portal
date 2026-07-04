# Deploy ShadeRP Portal to Render

## 1. GitHub repo

**Render repo (use this on Render):**

**https://github.com/Trialshit24312/shaderp-website**

Mirror: https://github.com/Trialshit24312/shaderp-portal

On Render → connect **`shaderp-website`** — **Root Directory must be blank** (files are at repo root, not in a subfolder).

**Required files at repo root:** `package.json`, `server/index.js`, `public/index.html`, `render.yaml`

To publish updates from your PC:

```powershell
cd F:\txData\ShadeRP.base\tools\shaderp-dashboard
git add -A
git commit -m "Your message"
git push website main
git push origin main
```

## 2. Create Render Web Service

1. Go to [render.com](https://render.com) → **New** → **Web Service**
2. Connect your GitHub repo
3. Or use **Blueprint** — Render detects `render.yaml` automatically
4. Settings:
   - **Runtime:** Node
   - **Build:** `npm install`
   - **Start:** `npm start`
   - **Plan:** Free (spins down after idle — first load may take ~30s)

Your URL will be: `https://shaderp-portal.onrender.com` (or custom name)

## 3. Discord Application

1. [Discord Developer Portal](https://discord.com/developers/applications) → **New Application** → name it `ShadeRP Portal`
2. **OAuth2 → Redirects** — add:
   ```
   https://YOUR-APP.onrender.com/auth/discord/callback
   ```
3. Copy **Client ID** and **Client Secret**
4. **Bot** tab → **Reset Token** → copy bot token
5. Invite bot to your Discord with **Manage Roles** permission (optional, for role name lookup)
6. Enable **Server Members Intent** under Bot → Privileged Gateway Intents

## 4. Map Discord roles

In Discord: Settings → Advanced → **Developer Mode** ON  
Right-click each role → **Copy Role ID**

Set Render env var `PORTAL_ROLE_MAP` (single line JSON):

```json
{"1234567890123456789":"owner","9876543210987654321":"admin","1111111111111111111":"staff","2222222222222222222":"moderator","3333333333333333333":"member"}
```

Replace IDs with your real role IDs.

### Portal role levels

| Portal role | Access |
|-------------|--------|
| guest | Home, about, jobs, connect, updates |
| member | + overview, economy, map, team |
| moderator | Same as member (extend in code if needed) |
| staff | + analytics, staff hub |
| developer | Same as staff |
| admin | + resources, branding, commands, blocked, settings |
| owner | Full access |

Also set `PORTAL_OWNER_IDS` to your Discord user ID for emergency owner access.

## 5. Render environment variables

| Variable | Example |
|----------|---------|
| `NODE_ENV` | `production` |
| `SESSION_SECRET` | (auto-generate on Render) |
| `DISCORD_CLIENT_ID` | from Discord app |
| `DISCORD_CLIENT_SECRET` | from Discord app |
| `DISCORD_CALLBACK_URL` | `https://YOUR-APP.onrender.com/auth/discord/callback` |
| `DISCORD_BOT_TOKEN` | bot token |
| `DISCORD_GUILD_ID` | your Discord server ID |
| `DISCORD_INVITE_URL` | `https://discord.gg/sbnu98HYAZ` |
| `PORTAL_ROLE_MAP` | JSON role mapping (above) |
| `PORTAL_OWNER_IDS` | your Discord user ID |
| `SYNC_API_KEY` | long random string (auto-generate) |
| `PORTAL_NAME` | `ShadeRP` |
| `PORTAL_TAGLINE` | `ESX Legacy Roleplay` |

## 6. Sync server data from your PC

After each local config change:

```powershell
cd F:\txData\ShadeRP.base\tools\shaderp-dashboard
.\Build-DashboardData.ps1

$env:PORTAL_URL = "https://YOUR-APP.onrender.com"
$env:SYNC_API_KEY = "your-sync-key-from-render"
.\Push-DashboardToRender.ps1
```

This uploads `dashboard.json` (economy, blips, resources, update log) to Render.

## 7. Custom domain (optional)

Render → Settings → **Custom Domains** → add `portal.shaderp.com` (or similar) and point DNS CNAME to Render.

## Local development

```powershell
copy .env.example .env
# fill in Discord credentials with callback http://localhost:8787/auth/discord/callback
.\Start-Dashboard.ps1 -OpenBrowser
```

## Analytics

- Page views, logins, and panel usage stored in `data/analytics.json`
- On Render free tier, disk is **ephemeral** — analytics reset on redeploy
- Upgrade to Render paid disk or add PostgreSQL for persistence

## Security notes

- Never commit `.env` or `SYNC_API_KEY` to git
- Staff/admin panels require Discord login + role match
- Public visitors see limited data only (no resource list, no blocked mods)
