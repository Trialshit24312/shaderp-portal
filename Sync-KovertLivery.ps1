# Build KOVERT Livery Services and copy into the ShadeRP portal (owner-only /livery).
param(
    [string]$LiveryRoot = 'E:\fivem livery creator',
    [string]$PortalRoot = ''
)

$ErrorActionPreference = 'Stop'
if (-not $PortalRoot) {
    $PortalRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
}

$outDir = Join-Path $PortalRoot 'owned-static\livery'
Write-Host "Building KOVERT from $LiveryRoot ..."
Push-Location $LiveryRoot
try {
    $env:VITE_BASE = '/livery/'
    npm run build
    if ($LASTEXITCODE -ne 0) { throw "vite build failed ($LASTEXITCODE)" }
} finally {
    Pop-Location
    Remove-Item Env:VITE_BASE -ErrorAction SilentlyContinue
}

if (Test-Path $outDir) {
    Remove-Item $outDir -Recurse -Force
}
New-Item -ItemType Directory -Path $outDir -Force | Out-Null
Copy-Item -Path (Join-Path $LiveryRoot 'dist\*') -Destination $outDir -Recurse -Force
Write-Host "Synced -> $outDir"
Write-Host "Owner-only URL: /livery/  (portal nav: KOVERT Livery)"
