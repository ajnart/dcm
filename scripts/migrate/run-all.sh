#!/usr/bin/env bash
set +x
set -euo pipefail
umask 077

usage="usage: scripts/migrate/run-all.sh [--yes] [--from N --log-dir DIR] [--private] [--skip-gates] [--log-dir DIR]"
here="$(cd "$(dirname "$0")" && pwd)"
root="$(cd "$here/../.." && pwd)"
source "$here/lib.sh"
(( BASH_VERSINFO[0] > 4 || (BASH_VERSINFO[0] == 4 && BASH_VERSINFO[1] >= 4) )) || die "needs bash 4.4 or later"

from=0 private=false skip_gates=false log_dir=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --yes) YES=true ;;
    --from) from="${2:?$usage}"; shift ;;
    --private) private=true ;;
    --skip-gates) skip_gates=true ;;
    --log-dir) log_dir="${2:?$usage}"; shift ;;
    -h|--help) say "$usage"; exit 0 ;;
    *) die "$usage" ;;
  esac
  shift
done
[[ "$from" =~ ^[0-9]$ ]] || die "--from takes a step number 0-9"
if [[ "$from" -gt 0 ]]; then
  [[ -n "$log_dir" && -s "$log_dir/state.json" ]] || die "--from requires --log-dir from the original execution"
fi
if $YES; then
  [[ -t 0 ]] || die "run --yes in a terminal; repository renames and archiving need typed confirmations"
fi

need git
need gh
need jq
need curl
unset GH_DEBUG GIT_TRACE GIT_TRACE_CURL GIT_CURL_VERBOSE GIT_TRACE_PACKET GIT_TRACE2 GIT_TRACE2_EVENT GIT_TRACE2_PERF
github_git_auth
export GH_HOST=github.com GH_PROMPT_DISABLED=1
cd "$root"

log_dir="${log_dir:-$root/.scratch/migration/$(date -u +%Y%m%dT%H%M%SZ)-$$}"
mkdir -p "$log_dir"
log_dir="$(cd "$log_dir" && pwd)"
case "$log_dir/" in
  "$root/"*) git check-ignore -q -- "$log_dir" || die "--log-dir inside the repository must be git-ignored" ;;
esac
exec > >(tee -a "$log_dir/run.log") 2>&1

head_sha="$(git rev-parse HEAD)"
branch="$(git branch --show-current)"
old_id=1349952104
new_id=950728976
old="" new="" layout="" current="" locked=false
yes_flag=()
archive_flags=()
$YES && yes_flag=(--yes)
$private && archive_flags=(--private)

resume_command() {
  printf 'scripts/migrate/run-all.sh'
  $YES && printf ' --yes'
  $private && printf ' --private'
  $skip_gates && printf ' --skip-gates'
  printf ' --from %q --log-dir %q\n' "$current" "$log_dir"
}

on_exit() {
  local code=$?
  if $locked; then rmdir "$root/.scratch/migration/run.lock" || true; fi
  if [[ "$code" -ne 0 && -n "$current" ]]; then
    say "FAILED at step $current (exit $code). Logs: $log_dir/run.log and $log_dir/step-$current.log"
    if $YES && [[ -s "$log_dir/state.json" ]]; then
      say "After fixing the cause, resume with the same commit and options:"
      resume_command
    fi
    say "Rollback: docs/migration/dcm-takeover.md (no automatic rollback)."
  fi
  trap - EXIT
  exit "$code"
}
trap on_exit EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

refresh_repos() {
  old="$(gh api "repositories/$old_id" --jq .full_name)"
  new="$(gh api "repositories/$new_id" --jq .full_name)"
  case "$old:$new" in
    ajnart/self-host:ajnart/dcm) layout=before ;;
    ajnart/self-host-old:ajnart/dcm) layout=parked ;;
    ajnart/self-host-old:ajnart/self-host) layout=renamed ;;
    *) die "unexpected repository names: $old ($old_id), $new ($new_id)" ;;
  esac
  say "repository state: $layout; $old ($old_id) -> $new ($new_id)"
}

check_local() {
  [[ "$branch" == dev-dcm-merge ]] || die "check out dev-dcm-merge"
  [[ "$(git branch --show-current)" == "$branch" ]] || die "branch changed during the migration"
  [[ "$(git rev-parse HEAD)" == "$head_sha" ]] || die "HEAD changed during the migration"
  grep -q '^module github.com/ajnart/self-host$' go.mod || die "go.mod module path changed"
  if [[ -n "$(git status --porcelain)" ]]; then
    $YES && die "working tree is not clean; finish and commit concurrent work first"
    say "WARN working tree is not clean; execution will refuse it"
  fi
}

preflight() {
  local sha repo n
  check_local
  refresh_repos
  if [[ "$from" -lt 6 ]]; then [[ "$layout" == before ]] || die "resume the original run from step 6 or later"; fi
  for repo in "$old" "$new"; do
    [[ "$(gh api "repos/$repo" --jq .permissions.admin)" == true ]] || die "you are not admin on $repo"
  done
  for repo in "$old" "$new"; do
    sha="$(git ls-remote "https://github.com/$repo.git" refs/heads/main | cut -f1)"
    [[ -n "$sha" ]] || die "cannot read main on $repo"
    git merge-base --is-ancestor "$sha" "$head_sha" || die "$repo main is not contained in HEAD; fetch and merge it before retrying"
  done
  $YES || { say "dry run: gates, generators, installer, snapshots and remote writes are not executed"; return 0; }
  if [[ -s "$log_dir/state.json" ]]; then
    jq -e --arg head "$head_sha" --argjson old "$old_id" --argjson new "$new_id" \
      --argjson private "$private" --argjson skip "$skip_gates" \
      '.head == $head and .old_id == $old and .new_id == $new and .private == $private and .skip_gates == $skip' \
      "$log_dir/state.json" >/dev/null || die "resume commit, repository identities or options differ from the original execution"
  else
    [[ "$from" -eq 0 ]] || die "cannot resume without state.json"
    jq -n --arg head "$head_sha" --argjson old "$old_id" --argjson new "$new_id" \
      --argjson private "$private" --argjson skip "$skip_gates" \
      '{head: $head, old_id: $old, new_id: $new, private: $private, skip_gates: $skip}' > "$log_dir/state.json"
  fi
  for ((n=0; n<from; n++)); do
    [[ -f "$log_dir/step-$n.done" ]] || die "step $n has not completed in this log directory; cannot skip it"
  done
  need docker
  need python3
  need tar
}

gates() {
  if $skip_gates; then say "WARN local gates skipped explicitly (--skip-gates)"; return 0; fi
  need go
  need bun
  export GOFLAGS=-buildvcs=false SELF_HOST_SITE_VERSION=0.0.0
  [[ -z "$(gofmt -l .)" ]] || die "gofmt -l reports files"
  go build ./...
  go vet ./...
  go vet -tags e2e ./e2e/
  go test ./...
  go test -race ./internal/tui/ ./internal/activity/
  bash -n install.sh
  bun install --frozen-lockfile
  go run ./tools/sitegen
  git diff --exit-code -- site/src/data dcm/src/data site/src/styles
  [[ -z "$(git ls-files --others --exclude-standard site/src/data dcm/src/data site/src/styles)" ]] || die "sitegen created untracked generated files"
  bunx turbo run build test lint check --force
  check_local
}

snapshot_file() {
  local file="$log_dir/$1"; shift
  if [[ -s "$file" ]]; then say "preserving snapshot: $file"; return 0; fi
  "$@" > "$file.partial"
  mv "$file.partial" "$file"
}

snapshot() {
  refresh_repos
  [[ "$layout" == before ]] || die "original snapshots must be captured before either rename"
  snapshot_file before-configure.json gh api "repos/$new"
  snapshot_file before-actions.json gh api "repos/$new/actions/permissions"
  snapshot_file before-workflow.json gh api "repos/$new/actions/permissions/workflow"
  snapshot_file before-labels.json gh api --paginate "repos/$new/labels"
  snapshot_file before-rulesets.json gh api "repos/$new/rulesets"
  snapshot_file before-old-releases.json gh api --paginate "repos/$old/releases?per_page=100"
  snapshot_file before-dcm-latest.digest docker buildx imagetools inspect ghcr.io/ajnart/dcm:latest --format '{{json .Manifest.Digest}}'
  grep -Eq '^"?sha256:[a-f0-9]{64}"?$' "$log_dir/before-dcm-latest.digest" || die "cannot record the original dcm image digest for rollback"
}

rename_repos() {
  refresh_repos
  if [[ "$layout" == renamed ]]; then say "both repositories already renamed; IDs match"; return 0; fi
  "$here/rename-repos.sh" rename --old "$old" --new "$new" --yes
}

verify() {
  refresh_repos
  [[ "$layout" == renamed ]] || die "repository names do not match the intended swap"
  [[ "$(gh api repos/ajnart/self-host --jq .id)" == "$new_id" ]] || die "self-host is not the former dcm repository"
  [[ "$(gh api repos/ajnart/dcm --jq .id)" == "$new_id" ]] || die "dcm does not redirect to the former dcm repository"
  [[ "$(gh api repos/ajnart/self-host/commits/main --jq .sha)" == "$head_sha" ]] || die "new main differs from the approved commit"
  curl -fsSL --connect-timeout 15 --max-time 60 https://raw.githubusercontent.com/ajnart/self-host/main/install.sh -o "$log_dir/remote-install.sh"
  cmp install.sh "$log_dir/remote-install.sh" || die "published installer differs from the merged installer"
  env -u SELF_HOST_GITHUB_TOKEN VERIFY_INSTALL_URL=https://raw.githubusercontent.com/ajnart/self-host/main/install.sh "$root/scripts/verify-install.sh"
}

step() {
  local n="$1" title="$2"; shift 2
  [[ "$n" -ge "$from" ]] || { say "step $n skipped (--from $from): $title"; return 0; }
  current="$n"
  say "$(date -u +%FT%TZ) step $n: $title"
  printf '+ '; printf '%q ' "$@"; printf '\n'
  if ! $YES; then say "DRY RUN: not executed"; current=""; return 0; fi
  check_local
  local started=$SECONDS
  local -a statuses
  set +e
  (set -e; "$@") 2>&1 | tee -a "$log_dir/step-$n.log"
  statuses=("${PIPESTATUS[@]}")
  set -e
  [[ "${statuses[0]}" -eq 0 ]] || exit "${statuses[0]}"
  [[ "${statuses[1]}" -eq 0 ]] || exit "${statuses[1]}"
  check_local
  date -u +%FT%TZ > "$log_dir/step-$n.done"
  say "step $n OK ($((SECONDS - started))s)"
  current=""
}

mode_banner
say "logs: $log_dir/run.log; per-step logs and resume state stay in the same directory (no token tracing)"
say "commit $head_sha on $branch"
say "Scope: GitHub history, releases, settings, issues, rename, installer verification and old repository parking."
say "Cloudflare deployment/redirects and a new version are separate, explicit follow-up operations."
if $YES; then
  mkdir -p "$root/.scratch/migration"
  mkdir "$root/.scratch/migration/run.lock" || die "another migration holds .scratch/migration/run.lock; check it before removing a stale lock"
  locked=true
fi
preflight

step 0 "local gates" gates
step 1 "snapshot rollback settings and original image digest" snapshot
step 2 "push merged history (fast-forward only)" "$here/push-merged-history.sh" "${yes_flag[@]}" \
  --dcm-url https://github.com/ajnart/dcm.git --self-host-url https://github.com/ajnart/self-host.git
step 3 "copy old releases into dcm before renaming" "$here/backport-releases.sh" --old ajnart/self-host --new ajnart/dcm "${yes_flag[@]}"
step 4 "configure dcm merge rules, Actions, labels and protection" "$here/rename-repos.sh" configure --old ajnart/self-host --new ajnart/dcm "${yes_flag[@]}"
step 5 "transfer open issues" "$here/transfer-issues.sh" --old ajnart/self-host --new ajnart/dcm "${yes_flag[@]}"
step 6 "swap repository names (typed confirmations)" rename_repos
step 7 "verify repository IDs and public install/self-update" verify
step 8 "recheck releases after the swap" "$here/backport-releases.sh" --old ajnart/self-host-old --new ajnart/self-host "${yes_flag[@]}"
step 9 "park old repository (typed confirmation)" "$here/rename-repos.sh" archive "${archive_flags[@]}" "${yes_flag[@]}"

if $YES; then say "GitHub migration finished. Logs: $log_dir"; else say "Dry run finished; nothing was pushed, renamed, uploaded, archived or deployed."; fi
say "Still required (docs/migration/dcm-takeover.md sections 8-10; docs/releasing.md):"
say "  Choose the next unused version, release it, and publish its package channels."
say "  Reconnect/recreate Cloudflare Pages or deploy manually; verify /compose before enabling either legacy-domain redirect."
say "  Check GHCR source linkage and the first CI/image runs; follow each run with gh run watch RUN_ID --compact --exit-status."
