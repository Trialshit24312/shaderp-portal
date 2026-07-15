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
$vehiclesDir = Join-Path $outDir 'vehicles'
$vehiclesBackup = Join-Path $PortalRoot 'owned-static\_livery-vehicles-bak'

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

# Preserve converted stream GLBs + catalog across rebuilds
if (Test-Path -LiteralPath $vehiclesDir) {
    if (Test-Path -LiteralPath $vehiclesBackup) {
        Remove-Item -LiteralPath $vehiclesBackup -Recurse -Force
    }
    Move-Item -LiteralPath $vehiclesDir -Destination $vehiclesBackup -Force
}

if (Test-Path -LiteralPath $outDir) {
    Remove-Item -LiteralPath $outDir -Recurse -Force
}
New-Item -ItemType Directory -Path $outDir -Force | Out-Null
Copy-Item -Path (Join-Path $LiveryRoot 'dist\*') -Destination $outDir -Recurse -Force

if (Test-Path -LiteralPath $vehiclesBackup) {
    if (Test-Path -LiteralPath $vehiclesDir) {
        Remove-Item -LiteralPath $vehiclesDir -Recurse -Force
    }
    Move-Item -LiteralPath $vehiclesBackup -Destination $vehiclesDir -Force
    Write-Host "Restored vehicles cache -> $vehiclesDir"
}

Write-Host "Synced -> $outDir"
Write-Host "Owner-only URL: /livery/  (portal nav: KOVERT Livery)"
