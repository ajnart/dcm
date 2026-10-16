#!/usr/bin/env bash
set -euo pipefail

usage="usage: scripts/publish-docker.sh X.Y.Z [--dry-run]"
version="${1:?$usage}"
dry_run=false
case "${2:-}" in
  "") ;;
  --dry-run) dry_run=true ;;
  *) echo "$usage" >&2; exit 1 ;;
esac
[[ "$version" =~ ^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$ ]] || { echo "version must be X.Y.Z" >&2; exit 1; }
cd "$(dirname "$0")/.."
image="${SELF_HOST_IMAGE:-ghcr.io/ajnart/self-host}"

for arch in amd64 arm64; do
  [[ -f "dist/self-host_${version}_linux_${arch}.tar.gz" ]] || { echo "missing dist/self-host_${version}_linux_${arch}.tar.gz; run goreleaser or download the release assets" >&2; exit 1; }
done
[[ -f dist/checksums.txt ]] || { echo "missing dist/checksums.txt" >&2; exit 1; }
sha256check() { if command -v sha256sum >/dev/null; then sha256sum -c -; else shasum -a 256 -c -; fi; }
(cd dist && grep -E " self-host_${version}_linux_(amd64|arm64)\.tar\.gz\$" checksums.txt | sha256check) \
  || { echo "dist/ archives do not match dist/checksums.txt" >&2; exit 1; }

if $dry_run; then
  case "$(uname -m)" in
    arm64|aarch64) platform=linux/arm64 ;;
    *) platform=linux/amd64 ;;
  esac
  docker buildx build --platform "$platform" --build-arg "VERSION=$version" --load -t "$image:$version-dryrun" .
  echo "built $image:$version-dryrun ($platform); nothing pushed"
  exit 0
fi

gh release view "v$version" -R ajnart/self-host --json isDraft --jq '.isDraft' | grep -qx false \
  || { echo "release v$version is not published yet" >&2; exit 1; }
gh release download "v$version" -R ajnart/self-host -p checksums.txt -O - | cmp -s - dist/checksums.txt \
  || { echo "dist/ was not built from the published v$version assets" >&2; exit 1; }

docker buildx build --platform linux/amd64,linux/arm64 --build-arg "VERSION=$version" \
  --provenance=false --push -t "$image:$version" -t "$image:latest" .
echo "$image:$version and :latest pushed"
