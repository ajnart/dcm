#!/usr/bin/env bash
# Step 1 of docs/migration/dcm-takeover.md: publish the merged history (self-host + dcm) to ajnart/dcm.
# Dry run unless --yes. Uses a URL, never touches your remotes.
set -euo pipefail

usage="usage: scripts/migrate/push-merged-history.sh [--yes] [--branch dev-dcm-merge] [--dcm-url URL] [--self-host-url URL] [--skip-origin-check]"
here="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=lib.sh
source "$here/lib.sh"

expected_branch=dev-dcm-merge
dcm_url="https://github.com/$OWNER/dcm.git"
self_host_url="https://github.com/$OWNER/self-host.git"
skip_origin=false
while [[ $# -gt 0 ]]; do
  case "$1" in
    --yes) YES=true ;;
    --skip-origin-check) skip_origin=true ;;
    --branch) expected_branch="${2:?$usage}"; shift ;;
    --dcm-url) dcm_url="${2:?$usage}"; shift ;;
    --self-host-url) self_host_url="${2:?$usage}"; shift ;;
    -h|--help) say "$usage"; exit 0 ;;
    *) die "$usage" ;;
  esac
  shift
done

need git
github_git_auth
cd "$(git rev-parse --show-toplevel)"
mode_banner

say "-- working tree"
if [[ -n "$(git status --porcelain)" ]]; then
  $YES && die "working tree is not clean; commit or remove changes first"
  say "WARN working tree is not clean (fatal with --yes); only committed work is pushed"
fi
branch="$(git branch --show-current)"
[[ "$branch" == "$expected_branch" ]] || die "on '$branch', expected '$expected_branch' (--branch to override)"
head_sha="$(git rev-parse HEAD)"
say "branch $branch at $head_sha"

say "-- history"
say "root commits:"
git log --max-parents=0 --format='  %h %ad %s' --date=short HEAD
say "commits reachable from HEAD: $(git rev-list --count HEAD)"

say "-- ajnart/dcm main"
dcm_main="$(git ls-remote "$dcm_url" refs/heads/main | awk '{print $1}')"
if [[ -z "$dcm_main" ]]; then
  say "dcm has no main branch; the push creates it"
else
  git cat-file -e "$dcm_main^{commit}" 2>/dev/null || die "dcm main $dcm_main is not in this clone; run: git fetch $dcm_url main"
  if git merge-base --is-ancestor "$dcm_main" HEAD; then
    say "dcm main $dcm_main is an ancestor of HEAD: the push is a fast-forward, no force needed"
  else
    die "dcm main $dcm_main is not an ancestor of HEAD; merge it first; force pushes are never allowed"
  fi
fi

if ! $skip_origin; then
  say "-- ajnart/self-host (old repo)"
  sh_main="$(git ls-remote "$self_host_url" refs/heads/main | awk '{print $1}')"
  [[ -n "$sh_main" ]] || die "cannot read main of $self_host_url (--skip-origin-check to skip)"
  git cat-file -e "$sh_main^{commit}" 2>/dev/null || die "self-host main $sh_main is not in this clone; run: git fetch $self_host_url main"
  git merge-base --is-ancestor "$sh_main" HEAD \
    || die "self-host main $sh_main is not in HEAD: merge it into $branch first or those commits are lost"
  say "self-host main $sh_main is contained in HEAD"
fi

say "-- self-host tags"
to_push=()
bad=0
for t in $(git tag --list | sort -V); do
  is_cli_tag "$t" || continue
  local_oid="$(git rev-parse "refs/tags/$t")"
  commit="$(git rev-parse "refs/tags/$t^{commit}")"
  if ! git merge-base --is-ancestor "$commit" HEAD; then
    say "  FAIL $t -> $commit is not an ancestor of HEAD"; bad=$((bad + 1)); continue
  fi
  if ! $skip_origin; then
    origin_oid="$(remote_tag_oid "$self_host_url" "$t")"
    if [[ "$origin_oid" != "$local_oid" ]]; then
      say "  FAIL $t local $local_oid differs from self-host ${origin_oid:-<missing>}"; bad=$((bad + 1)); continue
    fi
  fi
  dcm_oid="$(remote_tag_oid "$dcm_url" "$t")"
  if [[ -z "$dcm_oid" ]]; then
    to_push+=("$t")
    say "  push $t $commit"
  elif [[ "$dcm_oid" == "$local_oid" ]]; then
    say "  skip $t (already on dcm)"
  else
    say "  FAIL $t exists on dcm as $dcm_oid, differs from $local_oid"; bad=$((bad + 1))
  fi
done
[[ $bad -eq 0 ]] || die "$bad tag problem(s); nothing pushed"

say "-- dcm's own tags (left untouched)"
git ls-remote --tags "$dcm_url" | awk '{print "  " $2 " " $1}'

say "-- plan"
say "push 1: HEAD -> main"
say "  triggers .github/workflows/ci.yml, and dcm-image.yml (push to main touching dcm/**): that publishes ghcr.io/ajnart/dcm:latest early."
say "  This replaces the DCM latest image before the repository swap; preserve its original digest for rollback."
if [[ ${#to_push[@]} -eq 0 ]]; then
  say "push 2: none (no tags to push)"
elif [[ ${#to_push[@]} -le 3 ]]; then
  say "push 2: ${#to_push[@]} tag(s) in one push; three or fewer DO trigger tag workflows (release.yml, e2e.yml); GitHub creates no events only above three"
else
  say "push 2: ${#to_push[@]} tags in ONE push: GitHub creates no workflow events when more than three tags are pushed at once, so release.yml and e2e.yml do not run"
fi

run git -c push.followTags=false push "$dcm_url" "$head_sha:refs/heads/main"
if [[ ${#to_push[@]} -gt 0 ]]; then
  refspecs=()
  for t in "${to_push[@]}"; do refspecs+=("refs/tags/$t:refs/tags/$t"); done
  run git -c push.followTags=false push --atomic "$dcm_url" "${refspecs[@]}"
fi

if $YES; then
  say "-- verify"
  now="$(git ls-remote "$dcm_url" refs/heads/main | awk '{print $1}')"
  [[ "$now" == "$head_sha" ]] || die "dcm main is $now, expected $head_sha"
  for t in ${to_push[@]+"${to_push[@]}"}; do
    [[ "$(remote_tag_oid "$dcm_url" "$t")" == "$(git rev-parse "refs/tags/$t")" ]] || die "tag $t missing or different on dcm"
  done
  say "dcm main is $head_sha and ${#to_push[@]} tag(s) match"
  say "next: check https://github.com/$OWNER/dcm/actions for unexpected runs, then scripts/migrate/backport-releases.sh --old $OWNER/self-host --new $OWNER/dcm"
fi
