#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd -P)"
output="${1:?Provide a new output directory outside the checkout}"
repo="${SITE_RELEASE_REPO:-ajnart/selfhost-skills}"
case "$repo" in
  ajnart/selfhost | ajnart/selfhost-skills) ;;
  *) printf 'Unsupported release repository: %s\n' "$repo" >&2; exit 1 ;;
esac
if [ "$repo" = ajnart/selfhost ]; then
  canonical="$(gh repo view "$repo" --json nameWithOwner --jq .nameWithOwner)" || {
    printf 'The canonical repository is unavailable; keep the rename release gate closed.\n' >&2
    exit 1
  }
  [ "$canonical" = "$repo" ] || exit 1
fi
parent="$(cd "$(dirname "$output")" && pwd -P)"
leaf="$(basename "$output")"
case "$leaf" in . | .. | /) exit 1 ;; esac
output="${parent}/${leaf}"
case "$output" in
  "$root" | "$root"/*) printf 'Build outside the checkout.\n' >&2; exit 1 ;;
esac
mkdir "$output"
mkdir "$output/public"
for name in index.html site.css catalog.js catalog.json logo.svg og.png intro.json reel.jpg apple-touch-icon.png icon-192.png icon-512.png site.webmanifest llms.txt 404.html _headers; do
  command cp "$root/site/$name" "$output/public/$name"
done
command cp "$root/video/reel/out/selfhost-reel.mp4" "$output/public/reel.mp4"
mkdir "$output/public/js"
for path in "$root"/site/js/*.js; do
  command cp "$path" "$output/public/js/"
done
command cp "$root/site/wrangler.toml" "$output/wrangler.toml"
awk -v repo="$repo" '/^DEFAULT_REPO=/ { print "DEFAULT_REPO=\"" repo "\""; next } { print }' "$root/install.sh" > "$output/public/install.sh"
bash -n "$output/public/install.sh"
(cd "$output/public" && shasum -a 256 install.sh > install.sh.sha256 && command cp install.sh install)
printf 'Prepared installer site at %s (release repository: %s). No binaries included.\n' "$output" "$repo"
