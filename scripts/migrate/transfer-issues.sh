#!/usr/bin/env bash
# Step 7 of docs/migration/dcm-takeover.md (optional): move open issues of the old repo to the new one.
# Dry run unless --yes. Run it BEFORE making the old repo private.
#
# GitHub rules (docs: "Transferring an issue to another repository"): both repos must have the same
# owner, a private repo's issue cannot go to a public repo, only OPEN issues move (comments, assignees,
# and labels that exist on the target by name are kept). Pull requests and closed issues stay behind.
set -euo pipefail

usage="usage: scripts/migrate/transfer-issues.sh [--yes] [--old OWNER/REPO] [--new OWNER/REPO]"
here="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=lib.sh
source "$here/lib.sh"

old_repo="$OWNER/self-host-old"
new_repo="$OWNER/self-host"
while [[ $# -gt 0 ]]; do
  case "$1" in
    --yes) YES=true ;;
    --old) old_repo="${2:?$usage}"; shift ;;
    --new) new_repo="${2:?$usage}"; shift ;;
    -h|--help) say "$usage"; exit 0 ;;
    *) die "$usage" ;;
  esac
  shift
done

need gh
need jq
gh auth status >/dev/null 2>&1 || die "gh is not authenticated"
[[ "$old_repo" != "$new_repo" ]] || die "--old and --new are the same"
mode_banner

old_json="$(gh api "repos/$old_repo")" || die "$old_repo not found"
new_json="$(gh api "repos/$new_repo")" || die "$new_repo not found"
[[ "$(jq .id <<<"$old_json")" != "$(jq .id <<<"$new_json")" ]] || die "$old_repo and $new_repo are the same repository"
[[ "$(jq -r .owner.login <<<"$old_json")" == "$(jq -r .owner.login <<<"$new_json")" ]] || die "different owners"
[[ "$(jq -r .has_issues <<<"$new_json")" == true ]] || die "issues are disabled on $new_repo"
if [[ "$(jq -r .private <<<"$old_json")" == true && "$(jq -r .private <<<"$new_json")" == false ]]; then
  die "$old_repo is private and $new_repo is public: GitHub refuses; transfers had to happen before the private step"
fi

issues="$(gh issue list --repo "$old_repo" --state open --limit 1000 --json number,title --jq '.[] | "\(.number)\t\(.title)"')"
if [[ -z "$issues" ]]; then
  say "no open issues on $old_repo: nothing to transfer"
  exit 0
fi

say "open issues on $old_repo:"
printf '%s\n' "$issues" | sed 's/^/  #/'
say "(open PRs stay: $(gh pr list --repo "$old_repo" --state open --json number --jq length))"

while IFS=$'\t' read -r number _; do
  run gh issue transfer "$number" "$new_repo"
done <<<"$issues"
