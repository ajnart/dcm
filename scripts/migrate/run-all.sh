#!/usr/bin/env bash
set +x
set -euo pipefail
umask 077

usage="usage: scripts/migrate/run-all.sh --version X.Y.Z [--yes] [--approve-swap] [--approve-parking] [--from N --log-dir DIR] [--notes FILE] [--private] [--skip-gates] [--log-dir DIR] | --record-agent-step NAME --evidence FILE --log-dir DIR"
here="$(cd "$(dirname "$0")" && pwd)"
root="$(cd "$here/../.." && pwd)"
source "$here/lib.sh"
source "$here/release.sh"
source "$here/agent.sh"
(( BASH_VERSINFO[0] > 4 || (BASH_VERSINFO[0] == 4 && BASH_VERSINFO[1] >= 4) )) || die "needs bash 4.4 or later"

from=0 private=false skip_gates=false log_dir=""
version="" notes="" notes_hash="" record_agent_step="" evidence=""
approve_swap=false approve_parking=false
while [[ $# -gt 0 ]]; do
  case "$1" in
    --yes) YES=true ;;
    --approve-swap) approve_swap=true ;;
    --approve-parking) approve_parking=true ;;
    --version) version="${2:?$usage}"; shift ;;
    --notes) notes="${2:?$usage}"; shift ;;
    --record-agent-step) record_agent_step="${2:?$usage}"; shift ;;
    --evidence) evidence="${2:?$usage}"; shift ;;
    --from) from="${2:?$usage}"; shift ;;
    --private) private=true ;;
    --skip-gates) skip_gates=true ;;
    --log-dir) log_dir="${2:?$usage}"; shift ;;
    -h|--help) say "$usage"; exit 0 ;;
    *) die "$usage" ;;
  esac
  shift
done
[[ "$from" =~ ^([0-9]|1[0-9]|2[0-2])$ ]] || die "--from takes a step number 0-22"
if [[ -n "$version" ]]; then
  [[ "$version" =~ ^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$ ]] || die "--version must be X.Y.Z without leading zeros"
fi
if [[ "$from" -gt 0 ]]; then
  [[ -n "$log_dir" && -s "$log_dir/state.json" ]] || die "--from requires --log-dir from the original execution"
fi
if $YES; then
  if [[ ! -t 0 ]]; then
    [[ "$approve_swap" == true && "$approve_parking" == true ]] || die "noninteractive execution needs --approve-swap and --approve-parking, only after the user's explicit go"
  fi
  [[ -n "$version" ]] || die "--version is required; no release version is guessed"
fi

need git
need gh
need jq
need curl
unset GH_DEBUG GIT_TRACE GIT_TRACE_CURL GIT_CURL_VERBOSE GIT_TRACE_PACKET GIT_TRACE2 GIT_TRACE2_EVENT GIT_TRACE2_PERF
export GH_HOST=github.com GH_PROMPT_DISABLED=1
cd "$root"
if [[ -n "$record_agent_step" ]]; then
  $YES && die "recording agent evidence is local-only; do not combine it with --yes"
  agent_record "$record_agent_step" "$evidence" "$log_dir"
  exit 0
fi
if $YES; then github_git_auth; fi
if [[ -n "$notes" ]]; then
  [[ -f "$notes" ]] || die "release notes file not found"
  notes="$(cd "$(dirname "$notes")" && pwd)/$(basename "$notes")"
  notes_hash="$(shasum -a 256 "$notes" | cut -d ' ' -f1)"
fi

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
previous_version="" previous_tag=""
yes_flag=()
archive_flags=()
swap_flags=()
$YES && yes_flag=(--yes)
$private && archive_flags=(--private)
$approve_swap && swap_flags=(--confirmed)
$approve_parking && archive_flags+=(--confirmed)

resume_command() {
  printf 'scripts/migrate/run-all.sh'
  $YES && printf ' --yes'
  $private && printf ' --private'
  $skip_gates && printf ' --skip-gates'
  $approve_swap && printf ' --approve-swap'
  $approve_parking && printf ' --approve-parking'
  printf ' --version %q' "$version"
  if [[ -n "$notes" ]]; then printf ' --notes %q' "$notes"; fi
  printf ' --from %q --log-dir %q\n' "$current" "$log_dir"
}

on_exit() {
  local code=$?
  if $locked; then rmdir "$root/.scratch/migration/run.lock" || true; fi
  if [[ "$code" -ne 0 && -n "$current" ]]; then
    if [[ "$code" -eq 75 ]]; then
      say "PAUSED at step $current for verified agent/MCP work; this is an intentional handoff, not a migration failure."
    else
      say "FAILED at step $current (exit $code). Logs: $log_dir/run.log and $log_dir/step-$current.log"
    fi
    if $YES && [[ -s "$log_dir/state.json" ]]; then
      say "After completing the handoff or fixing the cause, resume with the same commit and options:"
      resume_command
    fi
    say "Rollback: docs/migration/dcm-takeover.md (no automatic rollback)."
    say "Do not delete a published version or overwrite its assets to retry. Original snapshots and release bytes stay in the log directory."
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
  local sha repo n settings
  $YES || { check_local; say "PLAN ONLY: no network requests, gates, installer, Docker or remote writes"; return 0; }
  check_local
  refresh_repos
  if [[ "$from" -lt 7 ]]; then [[ "$layout" == before ]] || die "resume the original run from step 7 or later"; fi
  for repo in "$old" "$new"; do
    [[ "$(gh api "repos/$repo" --jq .permissions.admin)" == true ]] || die "you are not admin on $repo"
  done
  for repo in "$old" "$new"; do
    sha="$(git ls-remote "https://github.com/$repo.git" refs/heads/main | cut -f1)"
    [[ -n "$sha" ]] || die "cannot read main on $repo"
    git merge-base --is-ancestor "$sha" "$head_sha" || die "$repo main is not contained in HEAD; fetch and merge it before retrying"
  done
  for command in docker python3 tar go bun shasum cmp; do need "$command"; done
  [[ ! ${POSTHOG_PROJECT_KEY+x} ]] || die "leave POSTHOG_PROJECT_KEY unset for release packaging"
  docker info >/dev/null
  docker buildx version >/dev/null
  [[ "$(gh api repos/ajnart/homebrew-tap --jq .permissions.push)" == true ]] || die "write access to ajnart/homebrew-tap is required"
  settings="$(jq -cn --arg head "$head_sha" --arg version "$version" --arg notes "$notes_hash" --argjson old "$old_id" --argjson new "$new_id" \
    --argjson private "$private" --argjson skip "$skip_gates" --argjson swap "$approve_swap" --argjson parking "$approve_parking" \
    '{head:$head,version:$version,notes:$notes,old_id:$old,new_id:$new,private:$private,skip_gates:$skip,approve_swap:$swap,approve_parking:$parking}')"
  if [[ -s "$log_dir/state.json" ]]; then
    jq -e --argjson settings "$settings" '.schema == 2 and .settings == $settings' \
      "$log_dir/state.json" >/dev/null || die "resume commit, repository identities or options differ from the original execution"
    previous_version="$(jq -r .previous_version "$log_dir/state.json")"
    previous_tag="$(jq -r .previous_tag "$log_dir/state.json")"
  else
    [[ "$from" -eq 0 ]] || die "cannot resume without state.json"
    release_preflight
    jq -n --argjson settings "$settings" --arg previous "$previous_version" --arg tag "$previous_tag" \
      '{schema:2,settings:$settings,previous_version:$previous,previous_tag:$tag}' > "$log_dir/state.json.partial"
    mv "$log_dir/state.json.partial" "$log_dir/state.json"
  fi
  for ((n=0; n<from; n++)); do
    [[ -f "$log_dir/step-$n.done" ]] || die "step $n has not completed in this log directory; cannot skip it"
  done
  say "Release: $previous_version -> $version. GHCR publishing requires your existing docker login with write:packages."
  say "Cloudflare and any necessary PostHog changes belong to the agent through MCP, with evidence checkpoints. No provider token is extracted or required by this script."
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
  bunx turbo run test:compose --force
  E2E_TARGETS=all E2E_LOG_DIR="$log_dir/e2e" go test -tags e2e -timeout 340m ./e2e/
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
  "$here/rename-repos.sh" rename --old "$old" --new "$new" --yes "${swap_flags[@]}"
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
  jq -cn --arg time "$(date -u +%FT%TZ)" --arg step "$n" --arg title "$title" '{time:$time,step:$step,title:$title,event:"started"}' >> "$log_dir/events.jsonl"
  local started=$SECONDS
  local -a statuses
  set +e
  (set -Ee; trap 'printf "error: %s:%s (exit %s)\n" "${BASH_SOURCE[0]}" "$LINENO" "$?" >&2' ERR; "$@") 2>&1 | tee -a "$log_dir/step-$n.log"
  statuses=("${PIPESTATUS[@]}")
  set -e
  jq -cn --arg time "$(date -u +%FT%TZ)" --arg step "$n" --argjson status "${statuses[0]}" \
    --argjson logging_status "${statuses[1]}" --argjson seconds "$((SECONDS - started))" \
    '{time:$time,step:$step,event:(if $status == 75 then "paused" else "finished" end),status:$status,logging_status:$logging_status,seconds:$seconds}' >> "$log_dir/events.jsonl"
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
say "Scope: GitHub migration, a verified new CLI release, Docker/Homebrew, site artifacts, public verification, CI watches and old repository parking."
say "Agent/MCP handoffs: Cloudflare preparation, site deployment, legacy redirects, and a telemetry configuration review only as needed."
say "Version: ${version:-<supply --version X.Y.Z>}. Missing agent evidence pauses the run with exit 75; it never silently skips a handoff."
if $YES; then
  mkdir -p "$root/.scratch/migration"
  mkdir "$root/.scratch/migration/run.lock" || die "another migration holds .scratch/migration/run.lock; check it before removing a stale lock"
  locked=true
fi
preflight

step 0 "local gates" gates
step 1 "snapshot rollback settings and original image digest" snapshot
step 2 "agent: snapshot Cloudflare and prevent stale Git auto-deploys" agent_checkpoint cloudflare-ready
step 3 "push merged history (fast-forward only)" "$here/push-merged-history.sh" "${yes_flag[@]}" \
  --dcm-url https://github.com/ajnart/dcm.git --self-host-url https://github.com/ajnart/self-host.git
step 4 "copy old releases into dcm before renaming" "$here/backport-releases.sh" --old ajnart/self-host --new ajnart/dcm "${yes_flag[@]}"
step 5 "configure dcm merge rules, Actions, labels and protection" "$here/rename-repos.sh" configure --old ajnart/self-host --new ajnart/dcm "${yes_flag[@]}"
step 6 "transfer open issues" "$here/transfer-issues.sh" --old ajnart/self-host --new ajnart/dcm "${yes_flag[@]}"
step 7 "swap repository names (explicit confirmation)" rename_repos
step 8 "verify repository IDs and public install/self-update" verify
step 9 "recheck releases after the swap" "$here/backport-releases.sh" --old ajnart/self-host-old --new ajnart/self-host "${yes_flag[@]}"
step 10 "package new CLI release and preserve its exact bytes" release_build
step 11 "create/repair draft, download/cmp assets, publish Latest" release_publish
step 12 "publish CLI Docker image from the release bytes" release_docker
step 13 "publish Homebrew cask from the same release bytes" release_homebrew
step 14 "build and preserve the merged Pages deployment bundle" agent_prepare_site
step 15 "agent: configure/deploy Pages through Cloudflare MCP" agent_checkpoint cloudflare-deployed
step 16 "verify public site, installer and upgrades to the new version" verify_public_site
step 17 "refresh DCM image and watch its workflow" release_refresh_dcm
step 18 "watch main-push CI and verify the new release in Actions" release_watch_ci
step 19 "agent: configure legacy redirects through Cloudflare MCP" agent_checkpoint legacy-redirects
step 20 "verify both redirect hosts preserve paths and query strings" verify_legacy_redirects
step 21 "agent: review PostHog settings only if migration requires it" agent_checkpoint telemetry-reviewed
step 22 "park old repository last (explicit confirmation)" "$here/rename-repos.sh" archive "${archive_flags[@]}" "${yes_flag[@]}"

if $YES; then say "Migration, release and Cloudflare cutover finished. Logs: $log_dir"; else say "Plan finished; nothing was pushed, renamed, uploaded, archived or deployed. Add --yes only when ready."; fi
say "No Pages project or DNS record is deleted by this script. No AUR account is assumed; PKGBUILD ships in the release."
say "Cloudflare strategy and any required PostHog configuration are recorded in the agent evidence files; do not mark them complete without live verification."
