# Generate QUEUE_API_KEY for Render + server.cfg (run once when going live)
param(
    [switch]$ApplyToServerCfg,
    [string]$ServerCfg = 'F:\txData\QBCore_A9FD7A.base\server.cfg'
)

$key = [guid]::NewGuid().ToString('N') + [guid]::NewGuid().ToString('N').Substring(0, 16)

Write-Host ''
Write-Host '=== ShadeRP Queue API Key ===' -ForegroundColor Cyan
Write-Host ''
Write-Host '1. Render.com -> shaderp-website -> Environment -> add or update:'
Write-Host "   QUEUE_API_KEY=$key"
Write-Host '   QUEUE_ENABLED=1'
Write-Host ''
Write-Host '2. server.cfg (FiveM):'
Write-Host "   set shade:queueApiKey `"$key`""
Write-Host '   set shade:webQueueRequired 1'
Write-Host '   set shade:logsApiKey "' + $key + '"   # optional, same key works'
Write-Host '   set shade:logsSyncEnabled 1'
Write-Host ''
Write-Host '3. Restart FiveM server after saving server.cfg'
Write-Host '4. Redeploy Render after saving env vars'
Write-Host ''

if ($ApplyToServerCfg -and (Test-Path -LiteralPath $ServerCfg)) {
    $raw = Get-Content -LiteralPath $ServerCfg -Raw -Encoding UTF8
    $raw = $raw -replace 'set shade:queueApiKey "[^"]*"', "set shade:queueApiKey `"$key`""
    $raw = $raw -replace 'set shade:webQueueRequired \d+', 'set shade:webQueueRequired 1'
    if ($raw -notmatch 'set shade:queueApiKey') {
        Write-Host 'Could not find shade:queueApiKey line in server.cfg — add manually.'
    } else {
        Set-Content -LiteralPath $ServerCfg -Value $raw -Encoding UTF8
        Write-Host "Updated $ServerCfg" -ForegroundColor Green
    }
}

Write-Host 'Local dev without VPS: leave shade:webQueueRequired 0 and use direct connect 127.0.0.1:20256'
