#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd -P)"
output="${1:?Provide a new output directory outside the checkout}"
repo="${SITE_RELEASE_REPO:-ajnart/self-host}"
parent="$(cd "$(dirname "$output")" && pwd -P)"
leaf="$(basename "$output")"
case "$leaf" in . | .. | /) exit 1 ;; esac
output="${parent}/${leaf}"
case "$output" in
  "$root" | "$root"/*) printf 'Build outside the checkout.\n' >&2; exit 1 ;;
esac
mkdir "$output"
command -v bun >/dev/null || { printf 'bun is required to build the site.\n' >&2; exit 1; }
(cd "$root" && bun install --frozen-lockfile)
(cd "$root/site" && bun run build --outDir "$output/public")
awk -v repo="$repo" '/^DEFAULT_REPO=/ { print "DEFAULT_REPO=\"" repo "\""; next } { print }' "$root/install.sh" > "$output/public/install.sh"
bash -n "$output/public/install.sh"
(cd "$output/public" && shasum -a 256 install.sh > install.sh.sha256 && command cp install.sh install)
printf 'Prepared installer site at %s (release repository: %s). No binaries included.\n' "$output" "$repo"
