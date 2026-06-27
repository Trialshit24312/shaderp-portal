# Regenerate dashboard.json from live ShadeRP server files
param(
    [string]$BasePath = 'F:\txData\QBCore_A9FD7A.base',
    [string]$OutFile = ''
)

$ErrorActionPreference = 'Stop'
$dashboardDir = Split-Path -Parent $MyInvocation.MyCommand.Path
if (-not $OutFile) { $OutFile = Join-Path $dashboardDir 'data\dashboard.json' }

$resRoot = Join-Path $BasePath 'resources\[standalone]'
$cfg = Join-Path $resRoot 'shade-config\config'
$serverCfg = Join-Path $BasePath 'server.cfg'
$updateLog = Join-Path $BasePath 'tools\UPDATE-LOG.md'
$updateNotes = Join-Path $BasePath 'tools\UPDATE-NOTES.txt'
$blipsFile = Join-Path $resRoot 'HWC_Blips_V2\blips.json'

function Read-Text([string]$path) {
    if (Test-Path -LiteralPath $path) { return Get-Content -LiteralPath $path -Raw -Encoding UTF8 }
    return ''
}

function Parse-LuaTableStrings([string]$text, [string]$key) {
    $m = [regex]::Match($text, "$key\s*=\s*\{([^}]+)\}", 'Singleline')
    if (-not $m.Success) { return @{} }
    $dict = @{}
    foreach ($pair in [regex]::Matches($m.Groups[1].Value, "(\w+)\s*=\s*'([^']*)'")) {
        $dict[$pair.Groups[1].Value] = $pair.Groups[2].Value
    }
    return $dict
}

function Parse-Businesses([string]$text) {
    $list = @()
    foreach ($m in [regex]::Matches($text, "\{\s*id\s*=\s*'([^']+)',\s*label\s*=\s*'([^']+)',\s*category\s*=\s*'([^']+)',\s*coords\s*=\s*vector3\(([^)]+)\)")) {
        $coords = $m.Groups[4].Value -split ',' | ForEach-Object { [double]($_.Trim()) }
        $list += [ordered]@{
            id = $m.Groups[1].Value
            label = $m.Groups[2].Value
            category = $m.Groups[3].Value
            coords = @{ x = $coords[0]; y = $coords[1]; z = $coords[2] }
            gotobiz = "/gotobiz $($list.Count + 1)"
        }
    }
    return $list
}

function Parse-UpdatePasses([string]$md) {
    $passes = @()
    $parts = [regex]::Split($md, '(?=^\*\*\d{1,2} \w+ \d{4} · Enhancement Pass v\d+\*\*)', 'Multiline')
    foreach ($part in $parts) {
        if ($part -notmatch 'Enhancement Pass v(\d+)') { continue }
        $title = ([regex]::Match($part, '^\*\*(.+?)\*\*', 'Multiline')).Groups[1].Value
        $overview = ''
        if ($part -match '## Overview\s*\r?\n\r?\n(.+?)(?=\r?\n---|\r?\n## )') {
            $overview = $Matches[1].Trim()
        }
        $passes += [ordered]@{
            version = "v$($Matches[1])"
            title = $title
            overview = $overview
            body = $part.Trim()
        }
    }
    return $passes
}

function Parse-ServerResources([string]$cfgText) {
    $enabled = @()
    $disabled = @()
    foreach ($line in ($cfgText -split "`n")) {
        $t = $line.Trim()
        if ($t -match '^ensure\s+(\S+)') {
            $enabled += $Matches[1]
        } elseif ($t -match '^#\s*ensure\s+(\S+)\s*(?:#\s*(.+))?$') {
            $reason = ''
            if ($Matches[2]) { $reason = $Matches[2].Trim() }
            $disabled += [ordered]@{ name = $Matches[1]; reason = $reason }
        }
    }
    return @{ enabled = $enabled; disabled = $disabled }
}

$brandingText = Read-Text (Join-Path $cfg 'branding.lua')
$portalText = Read-Text (Join-Path $cfg 'portal.lua')
$economyText = Read-Text (Join-Path $cfg 'economy.lua')
$businessText = Read-Text (Join-Path $cfg 'businesses.lua')
$loggingText = Read-Text (Join-Path $cfg 'logging.lua')

$branding = @{
    serverName = 'ShadeRP'
    tagline = 'ESX Legacy Roleplay'
    discord = 'https://discord.gg/sbnu98HYAZ'
    resources = Parse-LuaTableStrings $brandingText 'resources'
    locations = Parse-LuaTableStrings $brandingText 'locations'
}
if ($brandingText -match "serverName\s*=\s*'([^']+)'") { $branding.serverName = $Matches[1] }
if ($brandingText -match "tagline\s*=\s*'([^']+)'") { $branding.tagline = $Matches[1] }
if ($brandingText -match "discord\s*=\s*'([^']+)'") { $branding.discord = $Matches[1] }

$portal = @{
    websiteUrl = 'https://shaderp-portal.onrender.com'
    cfxJoinCode = 'YOUR-CODE'
    cfxJoinUrl = 'cfx.re/join/YOUR-CODE'
    discordInvite = $branding.discord
}
if ($portalText -match "websiteUrl\s*=\s*'([^']+)'") { $portal.websiteUrl = $Matches[1] }
if ($portalText -match "cfxJoinCode\s*=\s*'([^']+)'") { $portal.cfxJoinCode = $Matches[1] }
if ($portalText -match "cfxJoinUrl\s*=\s*'([^']+)'") { $portal.cfxJoinUrl = $Matches[1] }
if ($portalText -match "discordInvite\s*=\s*'([^']+)'") { $portal.discordInvite = $Matches[1] }

$serverCfgText = Read-Text $serverCfg
$connect = @{
    hostname = 'ShadeRP'
    maxClients = 48
    port = 20256
    framework = 'ESX Legacy'
}
if ($serverCfgText -match 'sv_hostname\s+"([^"]+)"') { $connect.hostname = $Matches[1] }
if ($serverCfgText -match 'sv_maxclients\s+(\d+)') { $connect.maxClients = [int]$Matches[1] }
if ($serverCfgText -match 'endpoint_add_tcp\s+"[^"]+:(\d+)"') { $connect.port = [int]$Matches[1] }
if ($portalText -match 'maxClients\s*=\s*(\d+)') { $connect.maxClients = [int]$Matches[1] }
if ($portalText -match 'port\s*=\s*(\d+)') { $connect.port = [int]$Matches[1] }
if ($portalText -match "framework\s*=\s*'([^']+)'") { $connect.framework = $Matches[1] }

$branding.portalUrl = $portal.websiteUrl

$economy = @{
    startingBank = 15000
    startingCash = 750
    paycheckMinutes = 15
    offDutyMultiplier = 0.65
    unemployed = 400
}
if ($economyText -match 'bank\s*=\s*(\d+)') { $economy.startingBank = [int]$Matches[1] }
if ($economyText -match 'money\s*=\s*(\d+)') { $economy.startingCash = [int]$Matches[1] }
if ($economyText -match 'intervalMinutes\s*=\s*(\d+)') { $economy.paycheckMinutes = [int]$Matches[1] }
if ($economyText -match 'offDutyMultiplier\s*=\s*([\d.]+)') { $economy.offDutyMultiplier = [double]$Matches[1] }
if ($economyText -match 'unemployed\s*=\s*(\d+)') { $economy.unemployed = [int]$Matches[1] }

$salaries = @{}
foreach ($m in [regex]::Matches($economyText, '(\w+)\s*=\s*\{\s*([\d,\s]+)\}')) {
    $salaries[$m.Groups[1].Value] = ($m.Groups[2].Value -split ',' | ForEach-Object { [int]$_.Trim() })
}
if ($economyText -match 'unemployed\s*=\s*(\d+)') { $salaries['unemployed'] = @([int]$Matches[1]) }

$blips = @()
if (Test-Path -LiteralPath $blipsFile) {
    $raw = Get-Content -LiteralPath $blipsFile -Raw -Encoding UTF8 | ConvertFrom-Json
    foreach ($prop in $raw.PSObject.Properties) {
        $b = $prop.Value
        $blips += [ordered]@{
            id = $b.id
            name = $b.name
            category = $b.category
            coords = $b.coords
        }
    }
}

$blocked = @(
    @{ name = 'nn (nn_bridge)'; reason = 'Missing bridge dependency' }
    @{ name = 'offload_smash_grab'; reason = 'community_bridge required' }
    @{ name = 'b3ast_weed'; reason = 'Bridge dependency' }
    @{ name = 'energy_redline'; reason = 'Entitlement / loader' }
    @{ name = 'lvl_fingerprint'; reason = 'lvl_bridge required' }
    @{ name = 'HWC_Blips_V2 / tenfgdc'; reason = 'CFX entitlement if missing' }
    @{ name = 'pixel-poster'; reason = 'CFX license required' }
)

$quickCommands = @(
    'restart shade-config'
    'restart es_extended'
    'restart HWC_Blips_V2'
    'restart pyh-tablet'
    'restart pyh-contacts'
    'restart pyh-groupsystem'
    'restart ravn-logs'
    '/gotobiz [1-15]'
    '/hwcblips'
    '/vehiclemenu'
)

$docs = @(
    @{ label = 'Update Log'; path = 'tools/UPDATE-LOG.md' }
    @{ label = 'Commands'; path = 'tools/COMMANDS.md' }
    @{ label = 'Security Audit'; path = 'tools/security-audit-2026-06-18.md' }
    @{ label = 'Give Item Reference'; path = 'tools/GIVEITEM-REFERENCE.md' }
    @{ label = 'Vehicle Spawn Codes'; path = 'tools/SHADE-QUICK-SPAWN-CODES.md' }
)

$data = [ordered]@{
    generatedAt = (Get-Date -Format 'yyyy-MM-dd HH:mm:ss')
    branding = $branding
    portal = $portal
    connect = $connect
    economy = $economy
    salaries = $salaries
    businesses = Parse-Businesses $businessText
    blips = $blips
    resources = Parse-ServerResources $serverCfgText
    updatePasses = Parse-UpdatePasses (Read-Text $updateLog)
    latestNotes = (Read-Text $updateNotes).Trim()
    blockedMods = $blocked
    quickCommands = $quickCommands
    docs = $docs
    paths = @{
        base = $BasePath
        serverCfg = $serverCfg
        shadeConfig = $cfg
        database = 'mysql://root:@127.0.0.1:3306/es_extended'
    }
    logging = @{
        ravnRetentionDays = 14
        channels = @('server', 'admin', 'bans', 'updates', 'tests')
    }
}

$outDir = Split-Path -Parent $OutFile
if (-not (Test-Path -LiteralPath $outDir)) { New-Item -ItemType Directory -Force -Path $outDir | Out-Null }

$json = $data | ConvertTo-Json -Depth 8
[System.IO.File]::WriteAllText($OutFile, $json, [System.Text.UTF8Encoding]::new($false))
Write-Host "Dashboard data written: $OutFile"
