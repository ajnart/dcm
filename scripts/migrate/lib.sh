#!/usr/bin/env bash
# Shared helpers for scripts/migrate/*.sh. Source it; do not run it.

# shellcheck disable=SC2034
OWNER=ajnart
YES=false

say() { printf '%s\n' "$*"; }
die() { printf 'error: %s\n' "$*" >&2; exit 1; }
need() { command -v "$1" >/dev/null 2>&1 || die "$1 is required"; }

# run prints the command, and executes it only with --yes.
run() {
  printf '+ %s\n' "$*"
  if $YES; then "$@"; fi
}

# run_json METHOD PATH JSON prints the request and sends JSON as the body only with --yes.
run_json() {
  local method="$1" path="$2" body="$3"
  printf '+ gh api -X %s %s --input - <<< %s\n' "$method" "$path" "$body"
  if $YES; then printf '%s' "$body" | gh api -X "$method" "$path" --input - >/dev/null; fi
}

mode_banner() {
  if $YES; then
    say "== EXECUTING (--yes)"
  else
    say "== DRY RUN: nothing is changed; add --yes to execute"
  fi
}

# confirm_tty asks for a typed confirmation before something hard to reverse, only with --yes.
confirm_tty() {
  $YES || return 0
  [[ -t 0 ]] || die "$1 needs an interactive terminal for confirmation"
  local reply
  read -r -p "$1 Type 'yes' to continue: " reply
  [[ "$reply" == "yes" ]] || die "aborted"
}

repo_exists() { gh api "repos/$1" --jq .full_name >/dev/null 2>&1; }

# remote_tag_oid URL TAG prints the object id of refs/tags/TAG on a remote, or nothing.
remote_tag_oid() { git ls-remote --tags "$1" "refs/tags/$2" | awk '{print $1}' | head -n1; }

is_cli_tag() { [[ "$1" =~ ^(new-cli-)?v(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$ ]]; }

repo_id() {
  local out
  out="$(gh api "repos/$1" --jq .id 2>/dev/null)" || out=""
  printf '%s' "$out"
}

release_tags() { gh release list --repo "$1" --limit 1000 --json tagName --jq '.[].tagName'; }

# asset_list TAG REPO prints "name size" per asset of a release, sorted.
asset_list() { gh release view "$1" --repo "$2" --json assets --jq '.assets[] | "\(.name) \(.size)"' 2>/dev/null | sort; }

# assets_lacking TAG OLD NEW prints the "name size" lines of OLD's release that NEW lacks or has with another size.
assets_lacking() { comm -23 <(asset_list "$1" "$2") <(asset_list "$1" "$3"); }

SKIP_RELEASE_CHECK=false

# check_release_parity OLD NEW: every release of OLD must exist on NEW with the same asset names and sizes, or installers break.
check_release_parity() {
  local missing=0 t lost
  while read -r t; do
    [[ -n "$t" ]] || continue
    if ! gh release view "$t" --repo "$2" >/dev/null 2>&1; then
      say "  missing on $2: $t"; missing=$((missing + 1)); continue
    fi
    lost="$(assets_lacking "$t" "$1" "$2")"
    [[ -z "$lost" ]] || { say "  assets missing or different on $2 for $t: $(tr '\n' ';' <<<"$lost")"; missing=$((missing + 1)); }
  done < <(release_tags "$1")
  if [[ $missing -gt 0 ]]; then
    $SKIP_RELEASE_CHECK && { say "WARN $missing release(s) missing or with different assets (--skip-release-check)"; return 0; }
    die "$missing release(s) of $1 are missing on $2 or differ in assets; run backport-releases.sh first (install.sh and self-update read the releases of whichever repo is named ajnart/self-host)"
  fi
  say "every release of $1 exists on $2 with the same assets"
}
