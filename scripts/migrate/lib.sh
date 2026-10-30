#!/usr/bin/env bash
# Shared helpers for scripts/migrate/*.sh. Source it; do not run it.

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
