#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
REPO_ROOT="$(cd -- "$SCRIPT_DIR/.." && pwd -P)"
DEFAULT_MANIFEST="$REPO_ROOT/prompts/manifest.txt"
PROMPT_FILE="$REPO_ROOT/PROMPT.md"

fail() {
  printf 'error: %s\n' "$*" >&2
  exit 1
}

validate_run_id() {
  local run_id="$1"

  if [[ ! "$run_id" =~ ^[a-z0-9][a-z0-9_-]{0,39}$ ]]; then
    fail "invalid RUN_ID: $run_id"
  fi
}

resolve_module() {
  local requested="$1"
  local candidate
  local resolved

  if [[ ! "$requested" =~ ^prompts/[a-zA-Z0-9_./-]+\.md$ ]]; then
    fail "module must be a Markdown file below prompts/: $requested"
  fi

  candidate="$REPO_ROOT/$requested"
  [[ -f "$candidate" && ! -L "$candidate" ]] || fail "module not found: $requested"
  resolved="$(realpath -e -- "$candidate")"
  [[ "$resolved" == "$REPO_ROOT/prompts/"* ]] || fail "module escaped prompts/: $requested"
  printf '%s\n' "$resolved"
}

render_module() {
  local requested="$1"
  local resolved

  resolved="$(resolve_module "$requested")"
  printf '\n---\n\n'
  sed -n '1,$p' "$resolved"
}

main() {
  local run_id="${1:-}"
  local module
  local -a modules=()

  [[ -n "$run_id" ]] || fail "usage: scripts/render-prompt.sh RUN_ID [prompts/extra.md ...]"
  validate_run_id "$run_id"

  [[ -f "$PROMPT_FILE" && ! -L "$PROMPT_FILE" ]] || fail "PROMPT.md must be a regular file"
  [[ "$(realpath -e -- "$PROMPT_FILE")" == "$PROMPT_FILE" ]] || fail "PROMPT.md escaped the repository"
  [[ -f "$DEFAULT_MANIFEST" && ! -L "$DEFAULT_MANIFEST" ]] || fail "prompt manifest is missing"
  while IFS= read -r module || [[ -n "$module" ]]; do
    [[ -n "$module" ]] || continue
    modules+=("$module")
  done < "$DEFAULT_MANIFEST"

  if (( $# > 1 )); then
    modules+=("${@:2}")
  fi

  printf '# Auto-Stack setup invocation\n\n'
  printf 'RUN_ID: `%s`\n\n' "$run_id"
  printf '```bash\nexport RUN_ID=%s\n```\n\n' "$run_id"
  printf 'This compiled prompt is immutable for this run. The controller and ordered modules follow.\n\n'
  sed -n '1,$p' "$PROMPT_FILE"

  for module in "${modules[@]}"; do
    render_module "$module"
  done
}

main "$@"
