#!/usr/bin/env bash
set -euo pipefail

version="${1:?usage: scripts/publish-aur.sh X.Y.Z}"
cd "$(dirname "$0")/.."
pkgbuild=dist/aur/self-host-bin.pkgbuild
srcinfo=dist/aur/self-host-bin.srcinfo

[[ -f "$pkgbuild" && -f "$srcinfo" ]] || { echo "no $pkgbuild; run goreleaser first" >&2; exit 1; }
grep -qFx "pkgver=$version" "$pkgbuild" || { echo "$pkgbuild is not version $version" >&2; exit 1; }
gh release view "v$version" -R ajnart/self-host --json isDraft --jq '.isDraft' | grep -qx false \
  || { echo "release v$version is not published yet" >&2; exit 1; }
gh release download "v$version" -R ajnart/self-host -p checksums.txt -O - | cmp -s - dist/checksums.txt \
  || { echo "dist/ was not built from the published v$version assets" >&2; exit 1; }

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
git clone -q ssh://aur@aur.archlinux.org/self-host-bin.git "$work"
cp "$pkgbuild" "$work/PKGBUILD"
cp "$srcinfo" "$work/.SRCINFO"
git -C "$work" add PKGBUILD .SRCINFO
if git -C "$work" diff --cached --quiet; then
  echo "AUR already at $version"
  exit 0
fi
git -C "$work" commit -qm "Update to $version"
git -C "$work" push -q origin HEAD:master
echo "AUR self-host-bin updated to $version"
