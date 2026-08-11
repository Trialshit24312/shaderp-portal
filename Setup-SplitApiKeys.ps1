# Generate split AC / queue / logs / sync / session keys for Render + server.cfg
# Does NOT apply to server.cfg unless -ApplyToServerCfg (apply only AFTER Render env is saved).
param(
    [switch]$ApplyToServerCfg,
    [string]$ServerCfg = 'F:\txData\QBCore_A9FD7A.base\server.cfg',
    [string]$OutDir = 'E:\KOVERT Mods\kovert_anticheat_bundle'
)

function New-KovertKey([string]$Prefix, [int]$Bytes = 32) {
    $buf = New-Object byte[] $Bytes
    [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($buf)
    $hex = ($buf | ForEach-Object { $_.ToString('x2') }) -join ''
    return "${Prefix}_${hex}"
}

$ac = New-KovertKey 'kovert_ac'
$queue = New-KovertKey 'kovert_queue'
$logs = New-KovertKey 'kovert_logs'
$sync = New-KovertKey 'kovert_sync'
$session = New-KovertKey 'kovert_sess' 48

$secretsPath = Join-Path $OutDir 'KEYS_SPLIT.local.env'
$renderPath = Join-Path $OutDir 'KEYS_SPLIT.render.env'
$cfgPath = Join-Path $OutDir 'KEYS_SPLIT.server.cfg.snippet'

@"
# KOVERT split API keys — LOCAL ONLY — do not commit
# Generated: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')

AC_API_KEY=$ac
QUEUE_API_KEY=$queue
LOGS_API_KEY=$logs
SYNC_API_KEY=$sync
SESSION_SECRET=$session
"@ | Set-Content -LiteralPath $secretsPath -Encoding UTF8

@"
AC_API_KEY=$ac
QUEUE_API_KEY=$queue
LOGS_API_KEY=$logs
SYNC_API_KEY=$sync
SESSION_SECRET=$session
AC_ENABLED=1
QUEUE_ENABLED=1
LOGS_ENABLED=1
AC_ML_AUTO_BAN=0
"@ | Set-Content -LiteralPath $renderPath -Encoding UTF8

@"
set shade:acApiKey `"$ac`"
set shade:queueApiKey `"$queue`"
set shade:logsApiKey `"$logs`"
set shade:logsSyncEnabled 1
"@ | Set-Content -LiteralPath $cfgPath -Encoding UTF8

Write-Host ''
Write-Host '=== KOVERT split API keys ===' -ForegroundColor Cyan
Write-Host "Saved: $secretsPath"
Write-Host ''
Write-Host 'CUTOVER ORDER (important):' -ForegroundColor Yellow
Write-Host '  1) Paste KEYS_SPLIT.render.env into Render → Environment → Save'
Write-Host '  2) Deploy / restart portal so new env is live'
Write-Host '  3) Update server.cfg keys (or re-run with -ApplyToServerCfg)'
Write-Host '  4) Restart FXServer'
Write-Host ''
Write-Host '--- Render ---'
Get-Content -LiteralPath $renderPath
Write-Host ''
Write-Host '--- server.cfg ---'
Get-Content -LiteralPath $cfgPath
Write-Host ''

if ($ApplyToServerCfg) {
    if (-not (Test-Path -LiteralPath $ServerCfg)) {
        Write-Host "server.cfg not found: $ServerCfg" -ForegroundColor Red
        exit 1
    }
    $raw = Get-Content -LiteralPath $ServerCfg -Raw -Encoding UTF8
    $raw = $raw -replace 'set shade:acApiKey "[^"]*"', "set shade:acApiKey `"$ac`""
    $raw = $raw -replace 'set shade:queueApiKey "[^"]*"', "set shade:queueApiKey `"$queue`""
    $raw = $raw -replace 'set shade:logsApiKey "[^"]*"', "set shade:logsApiKey `"$logs`""
    Set-Content -LiteralPath $ServerCfg -Value $raw -Encoding UTF8
    Write-Host "Updated $ServerCfg — restart FXServer now." -ForegroundColor Green
}
