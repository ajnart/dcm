#!/usr/bin/env bash
set -euo pipefail

# Cloudflare Pages Git builds run this from the repository root and publish
# site/dist-pages, the same tree build-installer-site.sh prepares for a
# Direct Upload. Pages Functions (upvotes at /compose/api/*) come from the
# root functions/ directory, which Pages Git builds and a wrangler deploy run
# from the repository root both read.
cd "$(dirname "$0")/.."
stage="$(mktemp -d)"
bash scripts/build-installer-site.sh "$stage/site"
rm -rf site/dist-pages
cp -R "$stage/site/public" site/dist-pages
