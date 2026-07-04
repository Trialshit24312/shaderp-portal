# Init standalone git repo for Render deploy (small upload, not full txData)
param(
    [string]$PortalDir = 'F:\txData\ShadeRP.base\tools\shaderp-dashboard',
    [string]$RemoteName = 'shaderp-portal',
    [switch]$Push
)

$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PortalDir

if (-not (Test-Path 'package.json')) {
    Write-Error "Not a portal folder: $PortalDir"
}

# Ensure logo is present for GitHub/Render
$logoSrc = 'F:\txData\ShadeRP.base\resources\[standalone]\shade-config\assets\shaderp-logo.png'
$logoDst = Join-Path $PortalDir 'public\assets\shaderp-logo.png'
if ((Test-Path -LiteralPath $logoSrc) -and -not (Test-Path -LiteralPath $logoDst)) {
    New-Item -ItemType Directory -Force -Path (Split-Path $logoDst) | Out-Null
    Copy-Item -LiteralPath $logoSrc -Destination $logoDst -Force
}

if (-not (Test-Path '.git')) {
    git init -b main
    Write-Host 'Initialized git repo in shaderp-dashboard'
}

git add -A
$status = git status --porcelain
if (-not $status) {
    Write-Host 'Nothing to commit.'
} else {
    git commit -m "Add ShadeRP portal for Render deploy." -m "Standalone Node portal with Discord OAuth, role sync, analytics, and dashboard sync — separate from the full FiveM server repo."
    Write-Host 'Committed portal files.'
}

if ($Push) {
    $remote = git remote get-url origin 2>$null
    if (-not $remote) {
        Write-Host "Creating GitHub repo: $RemoteName"
        gh repo create $RemoteName --public --source=. --remote=origin --push
    } else {
        git push -u origin main
    }
    Write-Host 'Pushed. Connect this repo on Render (no root directory needed).'
} else {
    Write-Host ''
    Write-Host 'To push to GitHub:'
    Write-Host "  cd `"$PortalDir`""
    Write-Host "  .\Init-PortalGitRepo.ps1 -Push"
    Write-Host 'Or: gh repo create shaderp-portal --public --source=. --remote=origin --push'
}
