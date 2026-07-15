# Scan 600-debadged packs + optional / automatic YFT → GLB conversion for KOVERT
param(
    [string]$ResourcesRoot = 'F:\txData\QBCore_A9FD7A.base\resources\[standalone]',
    [string]$PortalRoot = '',
    [string]$ConvertSpawn = '',
    [int]$ConvertLimit = 0,
    [switch]$Auto,
    [switch]$Force
)

$ErrorActionPreference = 'Stop'
if (-not $PortalRoot) {
    $PortalRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
}

$env:FIVEM_RESOURCES_ROOT = $ResourcesRoot
$env:KOVERT_AUTO_CONVERT = '1'
Write-Host "FIVEM_RESOURCES_ROOT = $ResourcesRoot"

Push-Location $PortalRoot
try {
    node server/vehicle-stream.js scan
    if ($LASTEXITCODE -ne 0) { throw "scan failed ($LASTEXITCODE)" }

    if ($ConvertSpawn) {
        $args = @('server/vehicle-stream.js', 'convert', $ConvertSpawn)
        if ($Force) { $args += '--force' }
        node @args
        if ($LASTEXITCODE -ne 0) { throw "convert $ConvertSpawn failed" }
    }
    elseif ($Auto -or $ConvertLimit -gt 0) {
        $limit = if ($ConvertLimit -gt 0) { $ConvertLimit } else { 0 }
        Write-Host "Starting auto-converter$(if ($limit) { " (limit $limit)" } else { ' (all missing)' })…"
        if ($limit -gt 0) {
            node server/vehicle-auto-convert.js $limit
        } else {
            # Run until queue empty — press Ctrl+C to stop
            node server/vehicle-auto-convert.js
        }
        if ($LASTEXITCODE -ne 0) { throw "auto-convert failed ($LASTEXITCODE)" }
    }
} finally {
    Pop-Location
}

Write-Host ''
Write-Host 'Catalog: owned-static\livery\vehicles\catalog.json'
Write-Host 'Auto all:  .\Sync-ServerVehicles.ps1 -Auto'
Write-Host 'Auto 20:   .\Sync-ServerVehicles.ps1 -ConvertLimit 20'
Write-Host 'One car:   .\Sync-ServerVehicles.ps1 -ConvertSpawn 350z'
Write-Host 'Portal also auto-converts when FIVEM_RESOURCES_ROOT is set (KOVERT_AUTO_CONVERT=1).'
