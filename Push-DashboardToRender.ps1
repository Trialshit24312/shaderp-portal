# Push local dashboard.json to Render (or any hosted portal)
param(
    [string]$PortalUrl = $env:PORTAL_URL,
    [string]$SyncKey = $env:SYNC_API_KEY,
    [string]$BasePath = 'F:\txData\QBCore_A9FD7A.base'
)

$ErrorActionPreference = 'Stop'
$tools = Join-Path $BasePath 'tools\shaderp-dashboard'

& (Join-Path $tools 'Build-DashboardData.ps1') -BasePath $BasePath

if (-not $PortalUrl) {
    Write-Host 'Set PORTAL_URL e.g. https://shaderp-portal.onrender.com'
    exit 1
}
if (-not $SyncKey) {
    Write-Host 'Set SYNC_API_KEY (same as Render env var)'
    exit 1
}

$jsonPath = Join-Path $tools 'data\dashboard.json'
$body = Get-Content -LiteralPath $jsonPath -Raw -Encoding UTF8

$uri = "$PortalUrl.TrimEnd('/')/api/dashboard/sync"
$response = Invoke-RestMethod -Uri $uri -Method POST -Headers @{
    'Content-Type' = 'application/json'
    'x-sync-key'   = $SyncKey
} -Body $body

Write-Host "Synced to $PortalUrl — $($response.generatedAt)"
