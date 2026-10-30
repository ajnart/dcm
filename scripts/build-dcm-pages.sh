#!/usr/bin/env bash
set -euo pipefail

# Builds Docker Compose Maker (dcm/) as a standalone site at DCM_BASE (default
# "/"), for a dcm Pages project (compose.ajnart.dev) or the ghcr.io/ajnart/dcm
# image. The catalog data under dcm/src/data is committed; regenerate it with
# `go run ./tools/sitegen` first when the Catalog changed. With an argument,
# the build is also copied to that directory.
# build-installer-site.sh calls this with DCM_BASE=/compose for the merged site.
root="$(cd "$(dirname "$0")/.." && pwd -P)"
cd "$root"
command -v bun >/dev/null || { printf 'bun is required to build Docker Compose Maker.\n' >&2; exit 1; }
if [ "${DCM_SKIP_INSTALL:-}" != 1 ]; then
  bun install --frozen-lockfile
fi
export DCM_BASE="${DCM_BASE:-/}"
bun run --cwd dcm build
test -f dcm/dist/index.html || { printf 'dcm/dist/index.html is missing after the build.\n' >&2; exit 1; }
if [ "$#" -gt 0 ]; then
  output="$1"
  mkdir -p "$output"
  command cp -R dcm/dist/. "$output/"
fi
printf 'Built Docker Compose Maker at base %s in dcm/dist.\n' "$DCM_BASE"
