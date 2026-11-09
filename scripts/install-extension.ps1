# Installs the DEWA SAP Spec Builder from the unpacked copy in this repository, for PCs whose network blocks
# .vsix downloads: zips dist/vscode-extension/<extension>/ into a local .vsix and installs it with the VS Code CLI.
# Run from the repository folder (VS Code terminal, PowerShell):
#   powershell -ExecutionPolicy Bypass -File scripts\install-extension.ps1
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$src = Get-ChildItem -Directory (Join-Path (Join-Path $root 'dist') 'vscode-extension') | Sort-Object Name | Select-Object -Last 1
if (-not $src) { throw 'dist\vscode-extension\ is missing - pull the latest main first.' }
$vsix = Join-Path ([System.IO.Path]::GetTempPath()) ($src.Name + '.vsix')
if (Test-Path $vsix) { Remove-Item $vsix }
Add-Type -AssemblyName System.IO.Compression.FileSystem
[System.IO.Compression.ZipFile]::CreateFromDirectory($src.FullName, $vsix)
Write-Host "Built $vsix"
$code = Get-Command code -ErrorAction SilentlyContinue
if ($code) { & code --install-extension $vsix --force; Write-Host 'Installed. Reload VS Code (Developer: Reload Window).' }
else { Write-Host "Now install it in VS Code: Extensions -> ... -> Install from VSIX... -> $vsix" }
