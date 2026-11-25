# Update this folder to the latest DEWA SAP Spec Builder (the main branch on GitHub) - always works, no stash needed.
# Run: double-click update.cmd in the project folder, or:  powershell -ExecutionPolicy Bypass -File scripts\update.ps1
# What it does:
#   1. downloads the latest main from GitHub;
#   2. if files in this folder were changed locally, saves those changes to .update-backups\<date-time>.patch
#      (nothing is lost) and then puts every file back exactly as on GitHub;
#   3. installs the new extension (.vsix) into VS Code when the "code" command is available.
# Files you added yourself (not part of the project) are left alone.
$ErrorActionPreference = 'Stop'
Set-Location (Split-Path -Parent $PSScriptRoot)

function Git { & git @args; if ($LASTEXITCODE -ne 0) { throw "git $args failed" } }

Write-Host "Downloading the latest version from GitHub..."
Git fetch origin main --quiet

$changed = & git status --porcelain --untracked-files=no
if ($changed) {
  $stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
  New-Item -ItemType Directory -Force -Path '.update-backups' | Out-Null
  $patch = ".update-backups\$stamp.patch"
  & git diff HEAD --binary | Out-File -Encoding utf8 $patch
  Write-Host "Local changes found in:" -ForegroundColor Yellow
  $changed | ForEach-Object { Write-Host "   $_" }
  Write-Host "They were saved to $patch (restore with: git apply $patch)." -ForegroundColor Yellow
}

# the folder becomes exactly the GitHub version of main; line endings are fixed by .gitattributes
Git config core.autocrlf false
Git checkout --quiet -f -B main origin/main
Git branch --quiet --set-upstream-to=origin/main main

$version = (Get-Content 'vscode-extension\package.json' -Raw | ConvertFrom-Json).version
$vsix = "dist\dewa-sap-spec-builder-$version.vsix"
Write-Host "Up to date: DEWA SAP Spec Builder $version ($(git log --oneline -1))" -ForegroundColor Green

if ((Test-Path $vsix) -and (Get-Command code -ErrorAction SilentlyContinue)) {
  Write-Host "Installing $vsix into VS Code..."
  & code --install-extension $vsix --force | Out-Null
  Write-Host "Installed. Reload VS Code (Ctrl+Shift+P > Developer: Reload Window)." -ForegroundColor Green
} elseif (Test-Path $vsix) {
  Write-Host "Install it in VS Code: Extensions > ... > Install from VSIX... > $vsix"
}
