# ShadeRP Portal — Discord bot setup (one time)

You only need **one Discord Application**. It powers:

| Feature | Uses |
|---------|------|
| **Login with Discord** | OAuth Client ID + Secret |
| **Staff role badges** | Bot token + Server Members Intent |
| **Auto-sync rules/FAQ** | Bot token + Read Message History |

You do **not** need a separate bot for each feature.

---

## Step 1 — Create the app

1. Go to [Discord Developer Portal](https://discord.com/developers/applications)
2. **New Application** → name it `ShadeRP Portal`
3. **OAuth2 → General** — copy **Client ID** and **Client Secret**
4. **OAuth2 → Redirects** — add:
   ```
   https://YOUR-APP.onrender.com/auth/discord/callback
   ```
   (For local testing also add `http://localhost:8787/auth/discord/callback`)

---

## Step 2 — Create the bot

1. **Bot** tab → **Reset Token** → copy **Bot Token** (keep secret)
2. Enable **Server Members Intent** (required for role sync)
3. **OAuth2 → URL Generator**:
   - Scopes: `bot`
   - Bot permissions: **Read Messages/View Channels**, **Read Message History**
4. Open the generated invite URL → add bot to your ShadeRP Discord

---

## Step 3 — Paste into Render

Render → your service → **Environment**:

| Variable | Value |
|----------|--------|
| `DISCORD_CLIENT_ID` | From OAuth2 |
| `DISCORD_CLIENT_SECRET` | From OAuth2 |
| `DISCORD_BOT_TOKEN` | Bot token |
| `DISCORD_GUILD_ID` | `1357838976299565087` (ShadeRP) |
| `DISCORD_CALLBACK_URL` | `https://YOUR-APP.onrender.com/auth/discord/callback` |
| `DISCORD_INVITE_URL` | `https://discord.gg/sbnu98HYAZ` |
| `PORTAL_OWNER_IDS` | Your Discord user ID |
| `PORTAL_ROLE_MAP` | `{"ROLE_ID":"staff",...}` |
| `SESSION_SECRET` | Auto-generate |
| `SYNC_API_KEY` | Auto-generate (copy for step 4) |

Save → Render redeploys.

---

## Step 4 — One local file (your PC)

```powershell
cd F:\txData\QBCore_A9FD7A.base\tools\shaderp-dashboard
copy .env.example .env
```

Edit `.env` — same bot token + Render sync key:

```
DISCORD_BOT_TOKEN=your-bot-token
DISCORD_GUILD_ID=1357838976299565087
PORTAL_URL=https://YOUR-APP.onrender.com
SYNC_API_KEY=paste-from-render
```

---

## Step 5 — Auto-sync everything (one command)

```powershell
.\Sync-PortalToRender.ps1
```

This will:

1. Pull **#rules** and **#faq** from Discord (if channel IDs are set — see below)
2. Build dashboard from shade-config
3. Push to your live Render site

Run after every server update, or set a Windows Task Scheduler job to run it daily.

---

## Step 6 — Channel IDs (one time)

Run once with bot token set:

```powershell
$env:DISCORD_BOT_TOKEN = "your-token"
.\Fetch-DiscordContent.ps1
```

It lists all Discord channels. Copy IDs into `shade-config/config/portal_content.lua`:

```lua
discordChannels = {
    rules = '1234567890123456789',
    faq = '9876543210987654321',
    announcements = '1111111111111111111',
},
```

After that, `Sync-PortalToRender.ps1` pulls Discord content automatically.

---

## What you never have to do manually

- Re-copy rules to the website — sync script reads Discord
- Re-type team info — comes from `credits.lua` + Discord
- Re-deploy code for content changes — only run `Sync-PortalToRender.ps1`

## What still needs one-time input

- CFX join code in `portal.lua`
- `PORTAL_ROLE_MAP` on Render (map your Discord role IDs)
- OAuth redirect URL must match your Render URL exactly
