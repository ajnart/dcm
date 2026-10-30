#!/usr/bin/env bash
set -euo pipefail

version="${1:?usage: scripts/publish-homebrew.sh X.Y.Z}"
cd "$(dirname "$0")/.."
cask=dist/homebrew/Casks/self-host.rb
tap=ajnart/homebrew-tap

[[ -f "$cask" ]] || { echo "no $cask; run goreleaser first" >&2; exit 1; }
grep -qFx "  version \"$version\"" "$cask" || { echo "$cask is not version $version" >&2; exit 1; }
gh release view "v$version" -R ajnart/self-host --json isDraft --jq '.isDraft' | grep -qx false \
  || { echo "release v$version is not published yet" >&2; exit 1; }
gh release download "v$version" -R ajnart/self-host -p checksums.txt -O - | cmp -s - dist/checksums.txt \
  || { echo "dist/ was not built from the published v$version assets" >&2; exit 1; }
gh repo view "$tap" --json name >/dev/null 2>&1 \
  || { echo "$tap does not exist; create it once with: gh repo create $tap --public" >&2; exit 1; }

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
git clone -q "https://github.com/$tap.git" "$work"
mkdir -p "$work/Casks"
cp "$cask" "$work/Casks/self-host.rb"
git -C "$work" add Casks/self-host.rb
if git -C "$work" diff --cached --quiet; then
  echo "Homebrew tap already at $version"
  exit 0
fi
git -C "$work" commit -qm "self-host $version"
git -C "$work" push -q origin HEAD
echo "Homebrew cask self-host updated to $version"
