# One command: apply portal links + build dashboard + push to Render
param(
    [string]$PortalUrl = $env:PORTAL_URL,
    [string]$SyncKey = $env:SYNC_API_KEY,
    [string]$BasePath = 'F:\txData\ShadeRP.base',
    [switch]$SkipPush
)

$tools = Join-Path $BasePath 'tools\shaderp-dashboard'

& (Join-Path $tools 'Apply-PortalLinks.ps1') -BasePath $BasePath

if ($env:DISCORD_BOT_TOKEN) {
    Write-Host 'Discord bot token found — fetching rules/FAQ from Discord...'
    & (Join-Path $tools 'Fetch-DiscordContent.ps1') -BasePath $BasePath
} else {
    Write-Host 'Tip: set DISCORD_BOT_TOKEN in .env to auto-pull #rules and #faq from Discord.'
}

& (Join-Path $tools 'Build-DashboardData.ps1') -BasePath $BasePath

if ($SkipPush) {
    Write-Host 'SkipPush — dashboard.json rebuilt locally only.'
    exit 0
}

if (-not $PortalUrl -or -not $SyncKey) {
    Write-Host ''
    Write-Host 'To push to Render, set env vars then re-run:'
    Write-Host '  $env:PORTAL_URL = "https://YOUR-APP.onrender.com"'
    Write-Host '  $env:SYNC_API_KEY = "your-render-sync-key"'
    Write-Host '  .\Sync-PortalToRender.ps1'
    exit 0
}

& (Join-Path $tools 'Push-DashboardToRender.ps1') -PortalUrl $PortalUrl -SyncKey $SyncKey -BasePath $BasePath
