#!/usr/bin/env bash
# Update this folder to the latest DEWA SAP Spec Builder (main on GitHub) - always works, no stash needed.
# Run: bash scripts/update.sh   (same steps as update.cmd on Windows: local changes are saved to
# .update-backups/<date-time>.patch, the folder becomes exactly main, and the .vsix is installed when "code" exists)
set -euo pipefail
cd "$(dirname "$0")/.."
echo "Downloading the latest version from GitHub..."
git fetch origin main --quiet
changed="$(git status --porcelain --untracked-files=no)"
if [ -n "$changed" ]; then
  mkdir -p .update-backups
  patch=".update-backups/$(date +%Y%m%d-%H%M%S).patch"
  git diff HEAD --binary > "$patch"
  echo "Local changes found in:"; echo "$changed" | sed 's/^/   /'
  echo "They were saved to $patch (restore with: git apply $patch)."
fi
git config core.autocrlf false
git checkout --quiet -f -B main origin/main
git branch --quiet --set-upstream-to=origin/main main
version="$(node -p "require('./vscode-extension/package.json').version" 2>/dev/null || sed -n 's/.*"version": *"\([^"]*\)".*/\1/p' vscode-extension/package.json | head -1)"
vsix="dist/dewa-sap-spec-builder-$version.vsix"
echo "Up to date: DEWA SAP Spec Builder $version ($(git log --oneline -1))"
if [ -f "$vsix" ] && command -v code >/dev/null 2>&1; then
  code --install-extension "$vsix" --force >/dev/null && echo "Installed $vsix - reload VS Code."
elif [ -f "$vsix" ]; then
  echo "Install it in VS Code: Extensions > ... > Install from VSIX... > $vsix"
fi
