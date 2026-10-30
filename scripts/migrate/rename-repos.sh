#!/usr/bin/env bash
# Steps 3, 4 and 7 of docs/migration/dcm-takeover.md. Dry run unless --yes.
#
#   rename     ajnart/self-host -> ajnart/self-host-old, then ajnart/dcm -> ajnart/self-host
#   configure  copy description, homepage, topics, merge settings, labels, Actions policy and the
#              'protect main' ruleset from the old repo onto the new one. The Actions allow-list is the
#              old one plus every non-GitHub action used in .github/workflows/*.yml, and the workflow
#              token may create pull requests (dcm-add-container.yml).
#   archive    archive the old repo: it stays public and becomes read-only (last step). With --private
#              it is made private instead, which erases its stars and watchers and hides its issues, PRs
#              and release assets
#
# Ordering: the new name must be free, so the old repo moves first. GitHub then redirects
# ajnart/self-host to self-host-old until the name is taken, and drops that redirect when dcm takes it.
set -euo pipefail

usage="usage: scripts/migrate/rename-repos.sh rename|configure|archive [--yes] [--private] [--old OWNER/REPO] [--new OWNER/REPO] [--skip-release-check]"
here="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=lib.sh
source "$here/lib.sh"

step="${1:-}"
[[ "$step" == rename || "$step" == configure || "$step" == archive ]] || die "$usage"
shift

old_repo="" new_repo="" make_private=false
while [[ $# -gt 0 ]]; do
  case "$1" in
    --yes) YES=true ;;
    --old) old_repo="${2:?$usage}"; shift ;;
    --new) new_repo="${2:?$usage}"; shift ;;
    --private) make_private=true ;;
    --skip-release-check) SKIP_RELEASE_CHECK=true ;;
    -h|--help) say "$usage"; exit 0 ;;
    *) die "$usage" ;;
  esac
  shift
done

need gh
need jq
gh auth status >/dev/null 2>&1 || die "gh is not authenticated"
mode_banner

case "$step" in
rename)
  old_repo="${old_repo:-$OWNER/self-host}"
  new_repo="${new_repo:-$OWNER/dcm}"
  old_name="$OWNER/self-host-old"
  final="$OWNER/self-host"

  say "-- state"
  old_id="$(repo_id "$old_repo")"
  new_id="$(repo_id "$new_repo")"
  parked_id="$(repo_id "$old_name")"
  [[ -n "$old_id" ]] || die "$old_repo not found"
  [[ -n "$new_id" ]] || die "$new_repo not found"
  say "$old_repo id $old_id; $new_repo id $new_id; $old_name id ${parked_id:-<none>}"

  if [[ "$old_id" == "$new_id" ]]; then
    say "already done: $new_repo resolves to the same repository as $old_repo"; exit 0
  fi

  need git
  say "-- the new repo must contain everything of the old one"
  old_main="$(gh api "repos/$old_repo/commits/main" --jq .sha)"
  status="$(gh api "repos/$new_repo/compare/$old_main...main" --jq .status 2>/dev/null)" || status=""
  [[ "$status" == ahead || "$status" == identical ]] \
    || die "main of $new_repo does not contain $old_repo main $old_main (compare: ${status:-not found}); run push-merged-history.sh"
  say "main of $new_repo contains $old_repo main $old_main ($status)"
  old_tags="$(gh api "repos/$old_repo/git/matching-refs/tags" --paginate --jq '.[] | "\(.ref) \(.object.sha)"' | sort)"
  new_tags="$(gh api "repos/$new_repo/git/matching-refs/tags" --paginate --jq '.[] | "\(.ref) \(.object.sha)"' | sort)"
  lost="$(comm -23 <(printf '%s\n' "$old_tags") <(printf '%s\n' "$new_tags"))"
  [[ -z "$lost" ]] || die "tags of $old_repo missing or different on $new_repo:
$lost"
  say "all $(printf '%s\n' "$old_tags" | grep -c .) tags of $old_repo exist on $new_repo with the same objects"

  say "-- releases"
  check_release_parity "$old_repo" "$new_repo"

  say "-- things that do not move with a rename"
  say "open issues on $old_repo: $(gh issue list --repo "$old_repo" --state open --json number --jq length) (move them with transfer-issues.sh BEFORE the archive step)"
  say "open PRs on $old_repo: $(gh pr list --repo "$old_repo" --state open --json number --jq length) (PRs cannot be transferred)"
  say "visibility of $old_repo: $(gh api "repos/$old_repo" --jq .visibility)"

  if [[ -z "$parked_id" ]]; then
    confirm_tty "Rename $old_repo to $old_name?"
    run_json PATCH "repos/$old_repo" '{"name":"self-host-old"}'
    if $YES; then
      for _ in $(seq 1 30); do [[ -n "$(repo_id "$old_name")" ]] && break; sleep 2; done
      [[ "$(repo_id "$old_name")" == "$old_id" ]] || die "$old_name did not appear"
      say "renamed: $old_name is id $old_id"
    fi
  else
    say "$old_name already exists (id $parked_id): skipping the first rename"
    [[ "$parked_id" == "$old_id" ]] || die "$old_name exists but is a different repository than $old_repo"
  fi

  confirm_tty "Rename $new_repo to $final? The name must be free."
  run_json PATCH "repos/$new_repo" '{"name":"self-host"}'
  if $YES; then
    for _ in $(seq 1 30); do [[ "$(repo_id "$final")" == "$new_id" ]] && break; sleep 2; done
    [[ "$(repo_id "$final")" == "$new_id" ]] || die "$final does not resolve to $new_repo (id $new_id)"
    say "renamed: $final is id $new_id"
    say "next: scripts/migrate/rename-repos.sh configure --yes"
  fi
  ;;

configure)
  old_repo="${old_repo:-$OWNER/self-host-old}"
  new_repo="${new_repo:-$OWNER/self-host}"
  [[ "$old_repo" != "$new_repo" ]] || die "--old and --new are the same"
  old_id="$(repo_id "$old_repo")"
  new_id="$(repo_id "$new_repo")"
  [[ -n "$old_id" && -n "$new_id" ]] || die "$old_repo or $new_repo not found"
  [[ "$old_id" != "$new_id" ]] || die "$old_repo and $new_repo are the same repository; rename first"

  old_json="$(gh api "repos/$old_repo")"
  say "-- settings from $old_repo"
  settings="$(jq -c '{description, homepage, allow_squash_merge, allow_merge_commit, allow_rebase_merge, delete_branch_on_merge, squash_merge_commit_title, squash_merge_commit_message, allow_auto_merge}' <<<"$old_json")"
  run_json PATCH "repos/$new_repo" "$settings"

  say "-- topics (GitHub allows 20)"
  topics="$(jq -c '{names: .topics}' <<<"$old_json")"
  run_json PUT "repos/$new_repo/topics" "$topics"

  say "-- labels missing on $new_repo"
  existing="$(gh api "repos/$new_repo/labels" --paginate --jq '.[].name')"
  while IFS= read -r label; do
    name="$(jq -r .name <<<"$label")"
    if grep -qxF -- "$name" <<<"$existing"; then continue; fi
    run_json POST "repos/$new_repo/labels" "$(jq -c '{name, color, description}' <<<"$label")"
  done < <(gh api "repos/$old_repo/labels" --paginate --jq '.[] | @json')

  say "-- Actions policy"
  need git
  workflows="$(git rev-parse --show-toplevel)/.github/workflows"
  compgen -G "$workflows/*.yml" >/dev/null || die "no workflows in $workflows; run from the merged branch"
  needed="$(cat "$workflows"/*.yml \
    | sed -nE 's/^[[:space:]-]*uses:[[:space:]]*([^[:space:]#]+).*/\1/p' \
    | grep -vE '^(\./|docker://)' | grep -vE '^actions/' \
    | sed -E 's/@.*$//; s/$/@*/' | sort -u)"
  say "third-party actions used by $workflows/*.yml (github_owned_allowed covers actions/*):"
  say "  ${needed//$'\n'/$'\n'  }"
  perms="$(gh api "repos/$old_repo/actions/permissions")"
  allowed="$(jq -r .allowed_actions <<<"$perms")"
  run_json PUT "repos/$new_repo/actions/permissions" "$(jq -c '{enabled, allowed_actions}' <<<"$perms")"
  if [[ "$allowed" == selected ]]; then
    selected="$(gh api "repos/$old_repo/actions/permissions/selected-actions" \
      | jq -c --arg needed "$needed" '{github_owned_allowed, verified_allowed, patterns_allowed: ((.patterns_allowed // []) + ($needed | split("\n") | map(select(length > 0))) | unique)}')"
    say "patterns_allowed on $new_repo: $(jq -c .patterns_allowed <<<"$selected")"
    run_json PUT "repos/$new_repo/actions/permissions/selected-actions" "$selected"
  else
    say "allowed_actions is '$allowed' on $old_repo: no allow-list to write"
  fi
  say "workflow token: read-only by default, and may create pull requests (peter-evans/create-pull-request in dcm-add-container.yml needs it)"
  run_json PUT "repos/$new_repo/actions/permissions/workflow" \
    "$(gh api "repos/$old_repo/actions/permissions/workflow" | jq -c '{default_workflow_permissions, can_approve_pull_request_reviews: true}')"

  say "-- Dependabot security updates"
  if [[ "$(jq -r '.security_and_analysis.dependabot_security_updates.status // "disabled"' <<<"$old_json")" == enabled ]]; then
    run gh api -X PUT "repos/$new_repo/automated-security-fixes"
  fi

  say "-- rulesets (created last: 'protect main' blocks force pushes and has no bypass)"
  have="$(gh api "repos/$new_repo/rulesets" --jq '.[].name')"
  while IFS= read -r rs_id; do
    [[ -n "$rs_id" ]] || continue
    rs="$(gh api "repos/$old_repo/rulesets/$rs_id")"
    rs_name="$(jq -r .name <<<"$rs")"
    if grep -qxF -- "$rs_name" <<<"$have"; then say "  ruleset '$rs_name' already on $new_repo"; continue; fi
    run_json POST "repos/$new_repo/rulesets" "$(jq -c '{name, target, enforcement, conditions, rules, bypass_actors}' <<<"$rs")"
  done < <(gh api "repos/$old_repo/rulesets" --jq '.[].id')

  say "-- left as they are on $new_repo (dcm's values): wiki $(jq -r .has_wiki <<<"$(gh api "repos/$new_repo")"), discussions $(jq -r .has_discussions <<<"$(gh api "repos/$new_repo")")"
  say "-- decide by hand: license ($old_repo: $(jq -r '.license.spdx_id' <<<"$old_json"), $new_repo: $(gh api "repos/$new_repo" --jq '.license.spdx_id')); GitHub shows the root LICENSE file"
  ;;

archive)
  old_repo="${old_repo:-$OWNER/self-host-old}"
  new_repo="${new_repo:-$OWNER/self-host}"
  old_id="$(repo_id "$old_repo")"
  [[ -n "$old_id" ]] || die "$old_repo not found"
  [[ "$old_id" != "$(repo_id "$new_repo")" ]] || die "$old_repo and $new_repo are the same repository"
  old_json="$(gh api "repos/$old_repo")"
  if $make_private; then
    [[ "$(jq -r .visibility <<<"$old_json")" == public ]] || { say "$old_repo is already $(jq -r .visibility <<<"$old_json")"; exit 0; }
  else
    [[ "$(jq -r .archived <<<"$old_json")" == false ]] || { say "$old_repo is already archived"; exit 0; }
  fi

  say "-- preflight"
  check_release_parity "$old_repo" "$new_repo"
  open_issues="$(gh issue list --repo "$old_repo" --state open --json number --jq length)"
  [[ "$open_issues" -eq 0 ]] || die "$open_issues open issue(s) on $old_repo: run transfer-issues.sh first (an archived repo is read-only; a private repo's issues cannot move to a public one)"
  say "no open issues on $old_repo"
  say "stars: $(jq .stargazers_count <<<"$old_json"), forks: $(jq .forks_count <<<"$old_json")"

  if $make_private; then
    say "--private: stars and watchers are erased, public forks detach, issues and PRs are hidden, and anything still linking to $old_repo release assets stops working"
    confirm_tty "Make $old_repo private?"
    run_json PATCH "repos/$old_repo" '{"private":true}'
  else
    say "archive: $old_repo stays public with its stars, issues, PRs and release assets, but becomes read-only (undo: PATCH archived=false; it cannot be renamed while archived)"
    confirm_tty "Archive $old_repo?"
    run_json PATCH "repos/$old_repo" '{"archived":true}'
  fi
  ;;
esac
