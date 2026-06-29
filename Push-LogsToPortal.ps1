# Push local shade-crashlog NDJSON files to the portal (owner log viewer)
param(
    [string]$PortalUrl = $env:PORTAL_URL,
    [string]$LogsKey = $env:LOGS_API_KEY,
    [string]$BasePath = 'F:\txData\QBCore_A9FD7A.base',
    [int]$MaxLines = 200
)

$ErrorActionPreference = 'Stop'

if (-not $PortalUrl) { $PortalUrl = 'https://shaderp-website.onrender.com' }
if (-not $LogsKey) { $LogsKey = $env:QUEUE_API_KEY }
if (-not $LogsKey) {
    Write-Host 'Set LOGS_API_KEY or QUEUE_API_KEY (same as Render env + server.cfg shade:logsApiKey)'
    exit 1
}

$logDir = Join-Path $BasePath 'resources\[standalone]\shade-crashlog\logs'
if (-not (Test-Path -LiteralPath $logDir)) {
    Write-Host "No logs folder: $logDir"
    exit 0
}

$files = Get-ChildItem -LiteralPath $logDir -Filter 'crash-*.ndjson' | Sort-Object LastWriteTime -Descending
$entries = [System.Collections.Generic.List[object]]::new()

foreach ($file in $files) {
    $lines = Get-Content -LiteralPath $file.FullName -Encoding UTF8 -Tail $MaxLines
    foreach ($line in $lines) {
        if (-not $line.Trim()) { continue }
        try {
            $obj = $line | ConvertFrom-Json
            $entries.Add($obj)
        } catch { /* skip bad lines */ }
    }
    if ($entries.Count -ge $MaxLines) { break }
}

if ($entries.Count -eq 0) {
    Write-Host 'No log lines to upload.'
    exit 0
}

$payload = @{ entries = @($entries | Select-Object -Last $MaxLines) } | ConvertTo-Json -Depth 20 -Compress
$uri = "$($PortalUrl.TrimEnd('/'))/api/logs/server/ingest"

$response = Invoke-RestMethod -Uri $uri -Method POST -Headers @{
    'Content-Type' = 'application/json'
    'X-Logs-Key'     = $LogsKey
} -Body $payload

Write-Host "Uploaded $($response.count) log entries to $PortalUrl"
