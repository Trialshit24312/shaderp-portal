# Pull #rules #faq #announcements from Discord into portal_content.lua
param(
    [string]$BotToken = $env:DISCORD_BOT_TOKEN,
    [string]$GuildId = $env:DISCORD_GUILD_ID,
    [string]$BasePath = 'F:\txData\QBCore_A9FD7A.base',
    [switch]$RulesOnly,
    [switch]$FaqOnly
)

$ErrorActionPreference = 'Stop'
$portalLua = Join-Path $BasePath 'resources\[standalone]\shade-config\config\portal_content.lua'

if (-not $BotToken) {
    Write-Host 'Set DISCORD_BOT_TOKEN (same bot as Render — needs Read Message History in your Discord channels).'
    exit 1
}
if (-not $GuildId) {
    $GuildId = '1357838976299565087'  # ShadeRP from invite sbnu98HYAZ
    Write-Host "Using guild ID $GuildId"
}

function Get-DiscordJson([string]$Uri) {
    $headers = @{ Authorization = "Bot $BotToken" }
    return Invoke-RestMethod -Uri $Uri -Headers $headers
}

function Parse-ChannelIds([string]$text) {
    $ids = @{}
    if ($text -match "rules\s*=\s*'(\d+)'") { $ids.rules = $Matches[1] }
    if ($text -match "faq\s*=\s*'(\d+)'") { $ids.faq = $Matches[1] }
    if ($text -match "announcements\s*=\s*'(\d+)'") { $ids.announcements = $Matches[1] }
    if ($text -match "jobs\s*=\s*'(\d+)'") { $ids.jobs = $Matches[1] }
    return $ids
}

function Find-ChannelByName($channels, [string[]]$names) {
    foreach ($name in $names) {
        $n = $name.ToLower()
        $hit = $channels | Where-Object {
            $_.type -in 0, 5, 15 -and (
                ($_.name -replace '[^\w-]', '').ToLower() -eq ($n -replace '[^\w-]', '') -or
                $_.name.ToLower() -like "*$n*"
            )
        } | Select-Object -First 1
        if ($hit) { return $hit.id }
    }
    return $null
}

function Get-ChannelMessages([string]$channelId, [int]$limit = 20) {
    if (-not $channelId) { return @() }
    $uri = "https://discord.com/api/v10/channels/$channelId/messages?limit=$limit"
    try {
        return @(Get-DiscordJson $uri)
    } catch {
        Write-Warning "Could not read channel $channelId — check bot permissions and channel ID."
        return @()
    }
}

function Split-RuleLines([string]$content) {
    $rules = @()
    $blocks = $content -split '(?=\d+\.\s|\*\*\d+\.)'
    foreach ($block in $blocks) {
        $t = $block.Trim()
        if ($t.Length -lt 5) { continue }
        if ($t -match '^(?:\*\*)?(?:\d+\.\s*)?(.+?)(?:\*\*)?(?:\r?\n|$)([\s\S]*)') {
            $title = $Matches[1].Trim().Trim('*').Trim()
            $body = $Matches[2].Trim()
            if ($title -and $body) {
                $rules += [ordered]@{ title = $title; body = $body -replace '\*\*','' -replace '\r?\n+', ' ' }
            }
        }
    }
    return $rules
}

function Split-FaqLines([string]$content) {
    $faq = @()
    if ($content -match 'Q[:.]?\s*(.+?)\r?\nA[:.]?\s*(.+)' ) {
        $faq += [ordered]@{ q = $Matches[1].Trim(); a = $Matches[2].Trim() }
    }
    foreach ($m in [regex]::Matches($content, '(?:\*\*)?Q(?:uestion)?[:.]?\s*(.+?)(?:\*\*)?\r?\n(?:\*\*)?A(?:nswer)?[:.]?\s*(.+?)(?=\r?\n(?:\*\*)?Q|\z)', 'Singleline')) {
        $faq += [ordered]@{ q = $m.Groups[1].Value.Trim(); a = $m.Groups[2].Value.Trim() -replace '\*\*','' }
    }
    return $faq
}

$cfgText = Get-Content -LiteralPath $portalLua -Raw -Encoding UTF8
$channelIds = Parse-ChannelIds $cfgText
$allChannels = Get-DiscordJson "https://discord.com/api/v10/guilds/$GuildId/channels"

if (-not $channelIds.rules) {
    $channelIds.rules = Find-ChannelByName $allChannels @(
        $env:DISCORD_CHANNEL_RULES, 'rules', 'server-rules', 'rule'
    )
}
if (-not $channelIds.faq) {
    $channelIds.faq = Find-ChannelByName $allChannels @(
        $env:DISCORD_CHANNEL_FAQ, 'faq', 'questions', 'help'
    )
}
if (-not $channelIds.announcements) {
    $channelIds.announcements = Find-ChannelByName $allChannels @(
        $env:DISCORD_CHANNEL_ANNOUNCEMENTS, 'announcements', 'announcement', 'news', 'updates'
    )
}

if ($channelIds.rules) { Write-Host "Rules channel: $($channelIds.rules)" }
if ($channelIds.faq) { Write-Host "FAQ channel: $($channelIds.faq)" }

if (-not $channelIds.rules -and -not $channelIds.faq) {
    Write-Host ''
    Write-Host 'Add channel IDs to portal_content.lua → discordChannels section, e.g.:'
    Write-Host "  rules = '1234567890123456789',"
    Write-Host ''
    Write-Host 'Listing guild channels (copy IDs into portal_content.lua discordChannels if auto-detect fails):'
    $allChannels | Where-Object { $_.type -in 0, 5, 15 } | Sort-Object { $_.position } | ForEach-Object {
        Write-Host ("  {0,-22} id={1}" -f $_.name, $_.id)
    }
    exit 0
}

$newRules = @()
$newFaq = @()

if (-not $FaqOnly -and $channelIds.rules) {
    Write-Host "Fetching rules from channel $($channelIds.rules)..."
    $msgs = Get-ChannelMessages $channelIds.rules 5
    foreach ($msg in ($msgs | Sort-Object timestamp)) {
        $parsed = Split-RuleLines $msg.content
        if ($parsed.Count -gt 0) { $newRules += $parsed }
    }
    Write-Host "  Parsed $($newRules.Count) rules"
}

if (-not $RulesOnly -and $channelIds.faq) {
    Write-Host "Fetching FAQ from channel $($channelIds.faq)..."
    $msgs = Get-ChannelMessages $channelIds.faq 10
    foreach ($msg in ($msgs | Sort-Object timestamp)) {
        $parsed = Split-FaqLines $msg.content
        if ($parsed.Count -gt 0) { $newFaq += $parsed }
    }
    Write-Host "  Parsed $($newFaq.Count) FAQ entries"
}

if ($newRules.Count -eq 0 -and $newFaq.Count -eq 0) {
    Write-Host 'No content parsed. Paste numbered rules or Q/A format in Discord, or check channel IDs.'
    exit 0
}

# Write export for Build-DashboardData to merge
$export = Join-Path (Split-Path $portalLua) 'portal_discord_export.json'
$exportObj = @{}
if ($newRules.Count) { $exportObj.rules = $newRules }
if ($newFaq.Count) { $exportObj.faq = $newFaq }
$exportObj.fetchedAt = (Get-Date -Format 'yyyy-MM-dd HH:mm:ss')
$exportObj | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $export -Encoding UTF8
Write-Host "Exported: $export"
Write-Host 'Run Build-DashboardData.ps1 then Sync-PortalToRender.ps1 to push to the live site.'
