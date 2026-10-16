#!/usr/bin/env bash
set -euo pipefail

version="${1:?usage: scripts/publish-channels.sh X.Y.Z}"
cd "$(dirname "$0")/.."

for channel in npm docker homebrew; do
  echo "== $channel"
  "scripts/publish-$channel.sh" "$version"
done
echo "all channels published for $version"
