#!/usr/bin/env bash
set -euo pipefail
export LC_ALL=C

if [ "$#" -lt 1 ] || [ "$#" -gt 2 ]; then
  echo "usage: scripts/release-new-apps.sh <previous-tag> [<ref>]" >&2
  exit 2
fi

prev="$1"
ref="${2:-HEAD}"

ids_in () {
  local ref="$1"
  if ! git cat-file -e "$ref:internal/apps" 2>/dev/null; then
    echo "release-new-apps: $ref has no internal/apps (not a Go-layout ref)" >&2
    return 1
  fi
  git grep -h -o -E 'ID: +"[a-z0-9-]+", +Name:' "$ref" -- 'internal/apps/*.go' \
    ':!*_test.go' ':!internal/apps/arrtest' \
    | sed -E 's/.*"(.*)",.*/\1/' | sort -u
}

previous_ids=$(ids_in "$prev")
current_ids=$(ids_in "$ref")
comm -13 <(printf '%s\n' "$previous_ids") <(printf '%s\n' "$current_ids")
