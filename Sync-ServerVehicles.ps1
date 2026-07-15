# Scan 600-debadged (and similar) stream packs into KOVERT, optionally convert .yft → .glb
param(
    [string]$ResourcesRoot = 'F:\txData\QBCore_A9FD7A.base\resources\[standalone]',
    [string]$PortalRoot = '',
    [string]$ConvertSpawn = '',
    [int]$ConvertLimit = 0,
    [switch]$Force
)

$ErrorActionPreference = 'Stop'
if (-not $PortalRoot) {
    $PortalRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
}

$env:FIVEM_RESOURCES_ROOT = $ResourcesRoot
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
    elseif ($ConvertLimit -gt 0) {
        $catalogPath = Join-Path $PortalRoot 'owned-static\livery\vehicles\catalog.json'
        $catalog = Get-Content -LiteralPath $catalogPath -Raw | ConvertFrom-Json
        $n = 0
        foreach ($v in $catalog.vehicles) {
            if ($n -ge $ConvertLimit) { break }
            Write-Host "Converting $($v.spawnName) ($($n+1)/$ConvertLimit)…"
            $args = @('server/vehicle-stream.js', 'convert', $v.spawnName)
            if ($Force) { $args += '--force' }
            node @args
            if ($LASTEXITCODE -ne 0) {
                Write-Warning "Skip $($v.spawnName)"
                continue
            }
            $n++
            Start-Sleep -Seconds 2
        }
    }
} finally {
    Pop-Location
}

Write-Host ''
Write-Host 'Catalog: owned-static\livery\vehicles\catalog.json'
Write-Host 'Convert more: .\Sync-ServerVehicles.ps1 -ConvertSpawn 488animated'
Write-Host 'Or in KOVERT: pick a stream vehicle → Load .yft → 3D'
