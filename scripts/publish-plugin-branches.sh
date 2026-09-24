#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 2 ]]; then
  printf 'Usage: %s DISTRIBUTION_DIRECTORY VERSION\n' "$0" >&2
  exit 2
fi

distribution_root=$(realpath "$1")
version=$2
repository_root=$(git rev-parse --show-toplevel)
if [[ ! $version =~ ^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?$ ]]; then
  printf 'Invalid release version\n' >&2
  exit 2
fi
if [[ $distribution_root != "$repository_root"/* || ! -f "$distribution_root/codex/DISTRIBUTION-MANIFEST.json" || ! -f "$distribution_root/claude/DISTRIBUTION-MANIFEST.json" ]]; then
  printf 'Distribution must be a generated directory inside this checkout\n' >&2
  exit 2
fi
if [[ ${GITHUB_REF_NAME:-} != "v$version" || ${GITHUB_REF_TYPE:-} != tag ]]; then
  printf 'Branch publication requires the matching release tag workflow\n' >&2
  exit 2
fi
if ! git -C "$repository_root" remote get-url origin >/dev/null; then
  printf 'The origin remote is required\n' >&2
  exit 2
fi

manifest_field() {
  bun -e '
    const field = Bun.argv[1];
    const manifest = JSON.parse(await Bun.stdin.text());
    const value = manifest[field];
    if (typeof value !== "string" || !value) process.exit(2);
    process.stdout.write(value);
  ' "$1"
}

source_commit=$(manifest_field sourceCommit < "$distribution_root/codex/DISTRIBUTION-MANIFEST.json")
claude_commit=$(manifest_field sourceCommit < "$distribution_root/claude/DISTRIBUTION-MANIFEST.json")
archive_sha=$(manifest_field archiveSha256 < "$distribution_root/codex/DISTRIBUTION-MANIFEST.json")
claude_sha=$(manifest_field archiveSha256 < "$distribution_root/claude/DISTRIBUTION-MANIFEST.json")
codex_version=$(manifest_field version < "$distribution_root/codex/DISTRIBUTION-MANIFEST.json")
claude_version=$(manifest_field version < "$distribution_root/claude/DISTRIBUTION-MANIFEST.json")
if [[ ! $source_commit =~ ^[a-f0-9]{40}$ || $source_commit != "$claude_commit" || ! $archive_sha =~ ^[a-f0-9]{64}$ || $archive_sha != "$claude_sha" || $codex_version != "$version" || $claude_version != "$version" ]]; then
  printf 'Distribution provenance is missing or inconsistent\n' >&2
  exit 2
fi
git -C "$repository_root" cat-file -e "$source_commit^{commit}"

temporary_root=$(mktemp -d)
cleanup() {
  for provider in codex claude; do
    if [[ -d "$temporary_root/$provider" ]]; then
      git -C "$repository_root" worktree remove --force "$temporary_root/$provider" >/dev/null 2>&1 || true
    fi
    git -C "$repository_root" branch -D "publish-$provider-$version-$BASHPID" >/dev/null 2>&1 || true
  done
  rm -rf -- "$temporary_root"
}
trap cleanup EXIT

for provider in codex claude; do
  branch="plugin-$provider"
  local_branch="publish-$provider-$version-$BASHPID"
  target="$temporary_root/$provider"
  git -C "$repository_root" worktree add --detach "$target" HEAD >/dev/null
  if git -C "$repository_root" ls-remote --exit-code --heads origin "$branch" >/dev/null; then
    git -C "$repository_root" fetch --no-tags origin "refs/heads/$branch:refs/remotes/origin/$branch" >/dev/null
    previous_manifest=$(git -C "$repository_root" show "origin/$branch:DISTRIBUTION-MANIFEST.json")
    previous_commit=$(manifest_field sourceCommit <<< "$previous_manifest")
    previous_version=$(manifest_field version <<< "$previous_manifest")
    previous_sha=$(manifest_field archiveSha256 <<< "$previous_manifest")
    if ! git -C "$repository_root" merge-base --is-ancestor "$previous_commit" "$source_commit"; then
      printf '%s would replace a newer or unrelated source release\n' "$branch" >&2
      exit 2
    fi
    if [[ $previous_version == "$version" && $previous_sha != "$archive_sha" ]]; then
      printf '%s would change published archive bytes for the same version\n' "$branch" >&2
      exit 2
    fi
    git -C "$target" switch --create "$local_branch" --track "origin/$branch" >/dev/null
  else
    git -C "$target" switch --orphan "$local_branch" >/dev/null
  fi
  git -C "$target" rm -r -f --ignore-unmatch . >/dev/null
  git -C "$target" clean -fdx >/dev/null
  cp -a "$distribution_root/$provider/." "$target/"
  git -C "$target" add -A
  if git -C "$target" diff --cached --quiet; then
    printf '%s already contains this distribution\n' "$branch"
    continue
  fi
  git -C "$target" -c user.name='selfhost-skills release' -c user.email='actions@users.noreply.github.com' commit -m "Publish selfhost-skills v$version" >/dev/null
  git -C "$target" push origin "HEAD:refs/heads/$branch"
done
