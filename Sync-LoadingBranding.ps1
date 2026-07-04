# Copy ShadeRP logo + sync loading screen config URLs from shade-config
param(
    [string]$BasePath = 'F:\txData\ShadeRP.base'
)

$ErrorActionPreference = 'Stop'
$logo = Join-Path $BasePath 'resources\[standalone]\shade-config\assets\shaderp-logo.png'
$loading = Join-Path $BasePath 'resources\[standalone]\tuff-loading'
$configJson = Join-Path $loading 'config.json'
$portalLua = Join-Path $BasePath 'resources\[standalone]\shade-config\config\portal.lua'

if (-not (Test-Path -LiteralPath $logo)) {
    Write-Warning "Missing logo: $logo"
    exit 1
}

$targets = @(
    'assets\branding\shaderp-logo.png',
    'assets\news\shaderp-logo.png',
    'assets\events\shaderp-logo.png',
    'assets\songs\shaderp-logo.png',
    'assets\gallery\shaderp-logo.png'
)

foreach ($rel in $targets) {
    $dest = Join-Path $loading $rel
    $dir = Split-Path -Path $dest -Parent
    if (-not (Test-Path -LiteralPath $dir)) { New-Item -ItemType Directory -Force -Path $dir | Out-Null }
    Copy-Item -LiteralPath $logo -Destination $dest -Force
}

$tabletLogo = Join-Path $BasePath 'resources\[standalone]\pyh-tablet\web\assets\shaderp-logo.png'
$tabletDir = Split-Path -Path $tabletLogo -Parent
if (-not (Test-Path -LiteralPath $tabletDir)) { New-Item -ItemType Directory -Force -Path $tabletDir | Out-Null }
Copy-Item -LiteralPath $logo -Destination $tabletLogo -Force

$url = 'https://shaderp-website.onrender.com'
$discord = 'https://discord.gg/sbnu98HYAZ'
if (Test-Path -LiteralPath $portalLua) {
    $text = Get-Content -LiteralPath $portalLua -Raw -Encoding UTF8
    if ($text -match "websiteUrl\s*=\s*'([^']+)'") { $url = $Matches[1] }
    if ($text -match "discordInvite\s*=\s*'([^']+)'") { $discord = $Matches[1] }
}

if (Test-Path -LiteralPath $configJson) {
    $cfg = Get-Content -LiteralPath $configJson -Raw -Encoding UTF8 | ConvertFrom-Json
    $cfg.navbuttons.website.url = $url
    $cfg.navbuttons.discord.url = $discord
    $cfg | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath $configJson -Encoding UTF8
}

Write-Host "ShadeRP logo synced to tuff-loading ($($targets.Count) paths) + pyh-tablet"
Write-Host "Portal -> $url | Discord -> $discord"
Write-Host "Done. restart tuff-loading and pyh-tablet on the server."
