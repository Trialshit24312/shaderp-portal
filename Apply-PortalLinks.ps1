# Sync portal URL from shade-config → tuff-loading + gen_pausev2 discord
param(
    [string]$BasePath = 'F:\txData\QBCore_A9FD7A.base'
)

$ErrorActionPreference = 'Stop'
$portalLua = Join-Path $BasePath 'resources\[standalone]\shade-config\config\portal.lua'
$loadingJson = Join-Path $BasePath 'resources\[standalone]\tuff-loading\config.json'

if (-not (Test-Path -LiteralPath $portalLua)) {
    Write-Error "Missing $portalLua"
}

$text = Get-Content -LiteralPath $portalLua -Raw -Encoding UTF8
$url = 'https://shaderp-portal.onrender.com'
$discord = 'https://discord.gg/sbnu98HYAZ'
if ($text -match "websiteUrl\s*=\s*'([^']+)'") { $url = $Matches[1] }
if ($text -match "discordInvite\s*=\s*'([^']+)'") { $discord = $Matches[1] }

$cfg = Get-Content -LiteralPath $loadingJson -Raw -Encoding UTF8 | ConvertFrom-Json
$cfg.navbuttons.website.enabled = $true
$cfg.navbuttons.website.text = 'Portal'
$cfg.navbuttons.website.url = $url
$cfg.navbuttons.discord.url = $discord
$cfg | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath $loadingJson -Encoding UTF8

Write-Host "tuff-loading website -> $url"
Write-Host "Done. restart tuff-loading on the server if it is running."
