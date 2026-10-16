#!/usr/bin/env bash
set -euo pipefail

version="${1:?usage: scripts/publish-npm.sh X.Y.Z [--dry-run]}"
dry=false
case "${2:-}" in
  "") ;;
  --dry-run) dry=true ;;
  *) echo "usage: scripts/publish-npm.sh X.Y.Z [--dry-run]" >&2; exit 1 ;;
esac
[[ "$version" =~ ^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$ ]] || { echo "version must be X.Y.Z" >&2; exit 1; }
cd "$(dirname "$0")/.."
root="$PWD"
out=dist/npm
sums=dist/checksums.txt

[[ -f "$sums" ]] || { echo "no $sums; run goreleaser first" >&2; exit 1; }
if ! $dry; then
  gh release view "v$version" -R ajnart/self-host --json isDraft --jq '.isDraft' | grep -qx false \
    || { echo "release v$version is not published yet" >&2; exit 1; }
  gh release download "v$version" -R ajnart/self-host -p checksums.txt -O - | cmp -s - "$sums" \
    || { echo "dist/ was not built from the published v$version assets" >&2; exit 1; }
fi

rm -rf "$out"
mkdir -p "$out"
tarballs=()

for target in linux:amd64:x64 linux:arm64:arm64 darwin:amd64:x64 darwin:arm64:arm64; do
  IFS=: read -r os goarch npmarch <<<"$target"
  archive="self-host_${version}_${os}_${goarch}.tar.gz"
  [[ -f "dist/$archive" ]] || { echo "missing dist/$archive" >&2; exit 1; }
  want="$(awk -v n="$archive" '$2 == n { print $1 }' "$sums")"
  [[ -n "$want" ]] || { echo "$archive is not in $sums" >&2; exit 1; }
  got="$(shasum -a 256 "dist/$archive" | awk '{ print $1 }')"
  [[ "$got" == "$want" ]] || { echo "checksum mismatch for $archive" >&2; exit 1; }

  pkg="$out/self-host-$os-$npmarch"
  mkdir -p "$pkg/bin"
  tar -xzf "dist/$archive" -C "$pkg/bin" self-host
  chmod 755 "$pkg/bin/self-host"
  cp LICENSE "$pkg/LICENSE"
  for f in package.json README.md; do
    sed -e "s/__OS__/$os/g" -e "s/__NPM_ARCH__/$npmarch/g" -e "s/\"version\": \"0.0.0\"/\"version\": \"$version\"/" "npm/platform/$f" >"$pkg/$f"
  done
  tarballs+=("$pkg")
done

main="$out/self-host"
mkdir -p "$main/bin"
cp npm/self-host/bin/self-host.js "$main/bin/self-host.js"
chmod 755 "$main/bin/self-host.js"
cp npm/self-host/README.md "$main/README.md"
cp LICENSE "$main/LICENSE"
sed -e "s/\"0.0.0\"/\"$version\"/g" npm/self-host/package.json >"$main/package.json"
tarballs+=("$main")

for pkg in "${tarballs[@]}"; do
  (cd "$pkg" && npm pack --pack-destination "$root/$out" --silent >/dev/null)
done
ls "$out"/*.tgz

for pkg in "${tarballs[@]}"; do
  if $dry; then
    (cd "$pkg" && npm publish --access public --dry-run)
  elif npm view "$(cd "$pkg" && node -p 'require("./package.json").name')@$version" version >/dev/null 2>&1; then
    echo "already published: $pkg"
  else
    (cd "$pkg" && npm publish --access public)
  fi
done
echo "npm packages done for $version"
