#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
repo="https://github.com/ajnart/selfhost.wiki.git"
work="$(mktemp -d "${TMPDIR:-/tmp}/self-host-wiki.XXXXXX")"
trap 'command rm -rf "$work"' EXIT

if ! git clone "$repo" "$work/wiki"; then
  echo "Could not clone the GitHub wiki. If it is uninitialized, create its first page in the GitHub UI:" >&2
  echo "https://github.com/ajnart/selfhost/wiki" >&2
  echo "Then rerun this script. If already initialized, check repository access. Nothing was published." >&2
  exit 1
fi

for page in "$root"/wiki/*.md; do
  if [[ ! -f "$page" ]]; then
    echo "No wiki Markdown pages found. Nothing was published." >&2
    exit 1
  fi
  command cp -f "$page" "$work/wiki/"
  git -C "$work/wiki" add -- "$(basename "$page")"
done

if git -C "$work/wiki" diff --cached --quiet; then
  echo "Wiki pages are already up to date."
  exit 0
fi

git -C "$work/wiki" commit -m "docs(wiki): sync repository pages"
git -C "$work/wiki" push origin HEAD
