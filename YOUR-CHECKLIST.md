# ShadeRP Portal — your checklist

Complete these so the website is fully filled out and functional.

## 1. Render (hosting) — required

- [ ] Service connected to **https://github.com/Trialshit24312/shaderp-website**
- [ ] Root Directory: **blank**
- [ ] Start command: **`npm start`**
- [ ] Set env vars (Render → Environment):

| Variable | You need to |
|----------|-------------|
| `DISCORD_CLIENT_ID` | Discord Developer Portal → OAuth2 |
| `DISCORD_CLIENT_SECRET` | Same app |
| `DISCORD_CALLBACK_URL` | `https://YOUR-APP.onrender.com/auth/discord/callback` |
| `DISCORD_BOT_TOKEN` | Bot tab, enable **Server Members Intent** |
| `DISCORD_GUILD_ID` | Right-click your Discord server → Copy ID |
| `PORTAL_OWNER_IDS` | Your Discord user ID |
| `PORTAL_ROLE_MAP` | JSON mapping role IDs → staff/admin/owner |
| `SYNC_API_KEY` | Long random string (copy for step 2) |
| `SESSION_SECRET` | Auto-generate on Render |
| `DISCORD_INVITE_URL` | `https://discord.gg/sbnu98HYAZ` |

## 2. Fill in server config (FiveM PC)

Edit **`resources/[standalone]/shade-config/config/portal.lua`**:

- [ ] `websiteUrl` = your Render URL (e.g. `https://shaderp-website.onrender.com`)
- [ ] `cfxJoinCode` + `cfxJoinUrl` = your real **cfx.re/join/XXXX** code from txAdmin/CFX

Edit content (optional but recommended):

- [ ] **`portal_content.lua`** — rules, FAQ, keybinds, feature blurbs
- [ ] **`credits.lua`** — team Discord IDs and roles
- [ ] **`branding.lua`** — job/location display names
- [ ] **`businesses.lua`** — location list for website map

## 3. Sync data to Render

```powershell
cd F:\txData\QBCore_A9FD7A.base\tools\shaderp-dashboard

# Optional: pull #rules and #faq from Discord (needs bot token + channel IDs in portal_content.lua)
$env:DISCORD_BOT_TOKEN = "your-bot-token"
$env:DISCORD_GUILD_ID = "1357838976299565087"
.\Fetch-DiscordContent.ps1   # lists channels if IDs empty

.\Sync-PortalToRender.ps1
```

This pushes economy, jobs, rules, team, updates, and connect info to the live site.

## 4. Discord OAuth redirect

In Discord Developer Portal → OAuth2 → Redirects, add **exactly**:

```
https://YOUR-APP.onrender.com/auth/discord/callback
```

Must match `DISCORD_CALLBACK_URL` on Render character-for-character.

## 5. Discord roles on portal

Create roles on your Discord (Staff, Admin, etc.) and map them:

```json
{"DISCORD_ROLE_ID":"staff","OTHER_ROLE_ID":"admin"}
```

Set as **`PORTAL_ROLE_MAP`** on Render (one line).

## 6. Verify live site

- [ ] `/health` returns `{"ok":true}`
- [ ] Home shows rules, jobs, locations (after sync)
- [ ] Connect page shows your CFX link (not YOUR-CODE)
- [ ] Discord login works and shows your role badge
- [ ] Staff login sees Analytics + Staff Hub

## 7. After every server update

```powershell
.\Sync-PortalToRender.ps1
git add -A && git commit -m "Portal update" && git push website main
```

---

**Edit website content without code:** change `portal_content.lua`, `credits.lua`, `UPDATE-LOG.md`, then run sync.

**Edit website UI/code:** change files in `tools/shaderp-dashboard/public/`, commit, push to GitHub — Render redeploys automatically.
