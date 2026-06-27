# Copy dashboard to XAMPP htdocs for http://localhost/shaderp/
param(
    [string]$XamppRoot = 'E:\XAMMP\htdocs',
    [string]$TargetName = 'shaderp'
)

$src = Split-Path -Parent $MyInvocation.MyCommand.Path
$dest = Join-Path $XamppRoot $TargetName
$base = Split-Path (Split-Path $src -Parent) -Parent

& (Join-Path $src 'Build-DashboardData.ps1') -BasePath $base

if (Test-Path -LiteralPath $dest) { Remove-Item -LiteralPath $dest -Recurse -Force }
New-Item -ItemType Directory -Force -Path $dest | Out-Null

Copy-Item -LiteralPath (Join-Path $src 'index.html') -Destination $dest
Copy-Item -LiteralPath (Join-Path $src 'styles.css') -Destination $dest
Copy-Item -LiteralPath (Join-Path $src 'app.js') -Destination $dest
Copy-Item -LiteralPath (Join-Path $src 'assets') -Destination (Join-Path $dest 'assets') -Recurse
Copy-Item -LiteralPath (Join-Path $src 'data') -Destination (Join-Path $dest 'data') -Recurse

Write-Host "Dashboard deployed to $dest"
Write-Host "Open: http://localhost/$TargetName/"
