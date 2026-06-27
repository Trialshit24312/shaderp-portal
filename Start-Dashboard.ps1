# ShadeRP Portal — local dev
param(
    [switch]$OpenBrowser
)

$dir = Split-Path -Parent $MyInvocation.MyCommand.Path
$base = Split-Path (Split-Path $dir -Parent) -Parent

& (Join-Path $dir 'Build-DashboardData.ps1') -BasePath $base

if (-not (Test-Path (Join-Path $dir '.env'))) {
    Write-Host 'Tip: copy .env.example to .env and add Discord OAuth credentials'
}

Set-Location -LiteralPath $dir
if ($OpenBrowser) { Start-Process 'http://localhost:8787' }
npm start
