# Regenerate dashboard.json from live ShadeRP server files
param(
    [string]$BasePath = 'F:\txData\QBCore_A9FD7A.base',
    [string]$OutFile = ''
)

function Normalize-ChangelogText([string]$text) {
    if ([string]::IsNullOrWhiteSpace($text)) { return '' }
    $s = ($text -replace "`r`n", "`n").TrimStart([char]0xFEFF)

    $emDash = [char]0x2014
    $enDash = [char]0x2013
    $midDot = [char]0x00B7
    $ellipsis = [char]0x2026
    $arrow = [char]0x2192

    $badEmDash = [string]::Concat([char]0x00E2, [char]0x20AC, [char]0x201D)
    $badEnDash = [string]::Concat([char]0x00E2, [char]0x20AC, [char]0x201C)
    $badMidDot = [string]::Concat([char]0x00C2, [char]0x00B7)
    $badEllipsis = [string]::Concat([char]0x00E2, [char]0x20AC, [char]0x00A6)
    $badArrow = [string]::Concat([char]0x00E2, [char]0x2020, [char]0x2019)

    $s = $s.Replace($badEmDash, $emDash)
    $s = $s.Replace($badEnDash, $enDash)
    $s = $s.Replace($badMidDot, $midDot)
    $s = $s.Replace($badEllipsis, $ellipsis)
    $s = $s.Replace($badArrow, $arrow)

    return $s.Trim()
}

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
    $passes = [System.Collections.ArrayList]@()
    # Title may include subtitle after version: "**18 June 2026 · Enhancement Pass v15 — Web queue**"
    $pattern = '\*\*(\d{1,2} \w+ \d{4}.+?Enhancement Pass v(\d+)[^*]*)\*\*'
    $passMatches = [regex]::Matches($md, $pattern)
    for ($i = 0; $i -lt $passMatches.Count; $i++) {
        $start = $passMatches[$i].Index
        $end = if ($i + 1 -lt $passMatches.Count) { $passMatches[$i + 1].Index } else { $md.Length }
        $section = $md.Substring($start, $end - $start).Trim()
        $title = Normalize-ChangelogText $passMatches[$i].Groups[1].Value
        $ver = $passMatches[$i].Groups[2].Value
        $date = ''
        $subtitle = ''
        if ($title -match '^(\d{1,2} \w+ \d{4})') { $date = $Matches[1] }
        if ($title -match 'Enhancement Pass v\d+\s*[—–-]\s*(.+)$') {
            $subtitle = $Matches[1].Trim()
        } elseif ($title -match 'Enhancement Pass v\d+\s*(.+)$') {
            $subtitle = ($Matches[1] -replace '^[—–-]\s*', '').Trim()
        } else {
            $subtitle = ($title -replace '^\d{1,2} \w+ \d{4}\s*[·•]\s*', '').Trim()
        }
        $subtitle = ($subtitle -replace '^[—–-]\s*', '').Trim()
        while ($subtitle.Length -gt 0 -and ($subtitle[0] -eq [char]0x2014 -or $subtitle[0] -eq [char]0x2013 -or $subtitle[0] -eq '-')) {
            $subtitle = $subtitle.Substring(1).TrimStart()
        }
        $overview = ''
        if ($section -match '## Overview\s*\r?\n\r?\n([\s\S]+?)(?=\r?\n---|\r?\n## |\z)') {
            $overview = $Matches[1].Trim()
            $overview = ($overview -split "`n" | Where-Object { $_ -match '\S' -and $_ -notmatch '^\|' -and $_ -notmatch '^\|-' } | Select-Object -First 2) -join ' '
            if ($overview.Length -gt 320) { $overview = $overview.Substring(0, 320).Trim() + '…' }
        } elseif ($section -match '## ([^\r\n]+)\s*\r?\n\r?\n([\s\S]+?)(?=\r?\n---|\r?\n## |\r?\n\*\*|\z)') {
            $bodyText = $Matches[2].Trim()
            $plain = ($bodyText -split "`n" | Where-Object {
                $_ -match '\S' -and $_ -notmatch '^\|' -and $_ -notmatch '^\|[-:\s|]+\|$' -and $_ -notmatch '^```'
            } | Select-Object -First 4) -join ' '
            if ($plain) {
                $overview = if ($plain.Length -gt 320) { $plain.Substring(0, 320).Trim() + '…' } else { $plain }
            }
        }
        $section = Normalize-ChangelogText $section
        $overview = Normalize-ChangelogText $overview
        [void]$passes.Add([ordered]@{
            version = "v$ver"
            date = $date
            subtitle = $subtitle
            title = "**$title**"
            overview = $overview
            body = $section
        })
    }
    return @($passes.ToArray())
}

function Parse-Credits([string]$text) {
    $list = @()
    foreach ($block in [regex]::Matches($text, '(\w+)\s*=\s*\{([^{}]+)\}')) {
        $inner = $block.Groups[2].Value
        $get = {
            param($k)
            $m = [regex]::Match($inner, "$k\s*=\s*'([^']*)'")
            if ($m.Success) { return $m.Groups[1].Value }
            return ''
        }
        $discordId = & $get 'discordId'
        if (-not $discordId) { continue }
        $list += [ordered]@{
            id = $block.Groups[1].Value
            discordId = $discordId
            displayName = & $get 'displayName'
            username = & $get 'username'
            role = & $get 'role'
            note = & $get 'note'
        }
    }
    return $list
}

function Parse-PortalSite([string]$text) {
    $site = @{ tagline = ''; about = @{}; rules = @(); faq = @(); keybinds = @(); features = @(); whatsNew = @(); jobGuide = @() }
    if ($text -match "tagline\s*=\s*'([^']+)'") { $site.tagline = $Matches[1] }
    if ($text -match "headline\s*=\s*'([^']+)'") { $site.about.headline = $Matches[1] }
    if ($text -match "intro\s*=\s*'([^']+)'") { $site.about.intro = $Matches[1] }
    if ($text -match "whitelist\s*=\s*'([^']+)'") { $site.about.whitelist = $Matches[1] }
    if ($text -match "memberCount\s*=\s*'([^']+)'") { $site.about.memberCount = $Matches[1] }
    $stack = @()
    foreach ($m in [regex]::Matches($text, "stack\s*=\s*\{([^}]+)\}")) {
        foreach ($line in [regex]::Matches($m.Groups[1].Value, "'([^']+)'")) {
            $stack += $line.Groups[1].Value
        }
    }
    if ($stack.Count) { $site.about.stack = $stack }
    foreach ($m in [regex]::Matches($text, "title\s*=\s*'([^']+)',\s*body\s*=\s*'([^']+)'")) {
        $site.rules += [ordered]@{ title = $m.Groups[1].Value; body = $m.Groups[2].Value }
    }
    foreach ($m in [regex]::Matches($text, "q\s*=\s*'([^']+)',\s*a\s*=\s*'([^']+)'")) {
        $site.faq += [ordered]@{ q = $m.Groups[1].Value; a = $m.Groups[2].Value }
    }
    foreach ($m in [regex]::Matches($text, "key\s*=\s*'([^']+)',\s*action\s*=\s*'([^']+)'")) {
        $site.keybinds += [ordered]@{ key = $m.Groups[1].Value; action = $m.Groups[2].Value }
    }
    foreach ($m in [regex]::Matches($text, "icon\s*=\s*'([^']+)',\s*title\s*=\s*'([^']+)',\s*desc\s*=\s*'([^']+)'")) {
        $site.features += [ordered]@{ icon = $m.Groups[1].Value; title = $m.Groups[2].Value; desc = $m.Groups[3].Value }
    }
    foreach ($m in [regex]::Matches($text, "badge\s*=\s*'([^']+)',\s*title\s*=\s*'([^']+)',\s*desc\s*=\s*'([^']+)'")) {
        $site.whatsNew += [ordered]@{ badge = $m.Groups[1].Value; title = $m.Groups[2].Value; desc = $m.Groups[3].Value }
    }
    foreach ($m in [regex]::Matches($text, "id\s*=\s*'([^']+)',\s*name\s*=\s*'([^']+)',\s*category\s*=\s*'([^']+)',\s*how\s*=\s*'([^']+)'")) {
        $site.jobGuide += [ordered]@{
            id = $m.Groups[1].Value; name = $m.Groups[2].Value
            category = $m.Groups[3].Value; how = $m.Groups[4].Value
        }
    }
    return $site
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
$creditsText = Read-Text (Join-Path $cfg 'credits.lua')
$siteText = Read-Text (Join-Path $cfg 'portal_content.lua')
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
if ($portalText -match "directConnect\s*=\s*'([^']+)'") { $portal.directConnect = $Matches[1] }
if ($portalText -match 'serverListed\s*=\s*(true|false)') { $portal.serverListed = ($Matches[1] -eq 'true') }

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

$site = Parse-PortalSite $siteText
$discordExport = Join-Path $cfg 'portal_discord_export.json'
if (Test-Path -LiteralPath $discordExport) {
    $exp = Get-Content -LiteralPath $discordExport -Raw | ConvertFrom-Json
    if ($exp.rules) { $site.rules = @($exp.rules) }
    if ($exp.faq) { $site.faq = @($exp.faq) }
}

$plsJobs = @()
$jobsJson = Join-Path $resRoot 'pls_jobsystem\server\jobs.json'
if (Test-Path -LiteralPath $jobsJson) {
    $plsJobs = Get-Content -LiteralPath $jobsJson -Raw | ConvertFrom-Json
}

$data = [ordered]@{
    generatedAt = (Get-Date -Format 'yyyy-MM-dd HH:mm:ss')
    branding = $branding
    portal = $portal
    connect = $connect
    site = $site
    credits = Parse-Credits $creditsText
    plsJobs = @($plsJobs)
    jobGuide = $site.jobGuide
    economy = $economy
    salaries = $salaries
    businesses = Parse-Businesses $businessText
    blips = $blips
    resources = Parse-ServerResources $serverCfgText
    updatePasses = @(Parse-UpdatePasses (Read-Text $updateLog))
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

# Keep Discord + in-game changelog files in sync with latest UPDATE-LOG pass
if ($data.updatePasses -and $data.updatePasses.Count -gt 0) {
    $latestBody = $data.updatePasses[0].body
    if ($latestBody) {
        $utf8 = [System.Text.UTF8Encoding]::new($false)
        $discordLatest = Join-Path $BasePath 'tools\DISCORD_CHANGELOG_LATEST.txt'
        $shadeChangelog = Join-Path $resRoot 'shade-discord\changelog\latest.txt'
        New-Item -ItemType Directory -Force -Path (Split-Path -LiteralPath $shadeChangelog) | Out-Null
        [System.IO.File]::WriteAllText($discordLatest, $latestBody, $utf8)
        [System.IO.File]::WriteAllText($shadeChangelog, $latestBody, $utf8)
        Write-Host "Changelog synced: $discordLatest"
        Write-Host "Changelog synced: $shadeChangelog"
    }
}
