#!/usr/bin/env bash
set -euo pipefail

# A release does not push to main, so the Git-connected Pages project does not
# rebuild on its own; this deploys the same build to production so the site
# shows the new version.
version="${1:?usage: scripts/publish-site.sh X.Y.Z}"
cd "$(dirname "$0")/.."
gh release view "v$version" -R ajnart/self-host --json isDraft --jq '.isDraft' | grep -qx false \
  || { echo "release v$version is not published yet" >&2; exit 1; }
bash scripts/build-site-pages.sh
grep -q "v$version" site/dist-pages/index.html || { echo "the site build does not show v$version" >&2; exit 1; }
test -f site/dist-pages/compose.html || { echo "the site build has no Docker Compose Maker at /compose" >&2; exit 1; }
wrangler pages deploy site/dist-pages --project-name self-host-fyi --branch main --commit-dirty=true
