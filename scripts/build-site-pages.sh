#!/usr/bin/env bash
set -euo pipefail

# Cloudflare Pages Git builds run this from the repository root and publish
# site/dist-pages, the same tree build-installer-site.sh prepares for a
# Direct Upload. The site is static: no Pages Functions, no _routes.json.
cd "$(dirname "$0")/.."
stage="$(mktemp -d)"
bash scripts/build-installer-site.sh "$stage/site"
rm -rf site/dist-pages
cp -R "$stage/site/public" site/dist-pages
