#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
REPOSITORY_ROOT="$(cd -- "$SCRIPT_DIR/.." && pwd -P)"
MINIMUM_NODE_VERSION="22.20.0"
MINIMUM_NODE_MAJOR=22
MINIMUM_NODE_MINOR=20
MINIMUM_NODE_PATCH=0
SMOKE_TEMP_DIR=""
SOURCE_SKILL_NAMES=()

fail() {
  printf 'FAIL smoke-install: %s\n' "$1" >&2
  exit 1
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || fail "required command is missing: $1"
}

require_node_version() {
  local version
  local major
  local minor
  local patch

  version="$(node -p 'process.versions.node')" \
    || fail "unable to read the Node.js version"
  if [[ ! "$version" =~ ^([0-9]+)\.([0-9]+)\.([0-9]+)(\+[0-9A-Za-z.-]+)?$ ]]; then
    fail "unable to parse the Node.js version"
  fi
  major=$((10#${BASH_REMATCH[1]}))
  minor=$((10#${BASH_REMATCH[2]}))
  patch=$((10#${BASH_REMATCH[3]}))

  if ((major < MINIMUM_NODE_MAJOR)); then
    fail "Node.js $MINIMUM_NODE_VERSION or newer is required"
  fi
  if ((major == MINIMUM_NODE_MAJOR && minor < MINIMUM_NODE_MINOR)); then
    fail "Node.js $MINIMUM_NODE_VERSION or newer is required"
  fi
  if ((
    major == MINIMUM_NODE_MAJOR
    && minor == MINIMUM_NODE_MINOR
    && patch < MINIMUM_NODE_PATCH
  )); then
    fail "Node.js $MINIMUM_NODE_VERSION or newer is required"
  fi
}

cleanup() {
  if [[ -z "$SMOKE_TEMP_DIR" ]]; then
    return
  fi
  case "$SMOKE_TEMP_DIR" in
    /tmp/selfhost-skills-smoke.*)
      rm -rf -- "$SMOKE_TEMP_DIR"
      ;;
    *)
      printf 'FAIL smoke-install: refusing to clean an unexpected path\n' >&2
      ;;
  esac
}

name_in_array() {
  local wanted="$1"
  local item
  shift
  for item in "$@"; do
    if [[ "$item" == "$wanted" ]]; then
      return 0
    fi
  done
  return 1
}

require_add_flag() {
  local flag="$1"
  local signature
  case "$flag" in
    --agent)
      signature="-a, --agent <agents>   Specify agents to install to"
      ;;
    --all)
      signature="--all                  Shorthand for --skill '*' --agent '*' -y"
      ;;
    --copy)
      signature="--copy                 Copy files instead of symlinking to agent directories"
      ;;
    --list)
      signature="-l, --list             List available skills in the repository without installing"
      ;;
    --skill)
      signature="-s, --skill <skills>   Specify skill names to install"
      ;;
    --yes)
      signature="-y, --yes              Skip confirmation prompts"
      ;;
    *)
      fail "internal unknown flag contract"
      ;;
  esac
  case "$ADD_HELP" in
    *"$signature"*)
      ;;
    *)
      fail "current skills CLI does not document required flag $flag"
      ;;
  esac
}

verify_target_set() {
  local agent_root="$1"
  local target_count=0
  local target_name
  local target_skill

  [[ -d "$agent_root" ]] || fail "expected project install root was not created"
  for target_skill in "$agent_root"/*; do
    if [[ ! -e "$target_skill" && ! -L "$target_skill" ]]; then
      continue
    fi
    target_name="${target_skill##*/}"
    name_in_array "$target_name" "${SOURCE_SKILL_NAMES[@]}" \
      || fail "installer created an unexpected skill: $target_name"
    target_count=$((target_count + 1))
  done
  if ((target_count != ${#SOURCE_SKILL_NAMES[@]})); then
    fail "installed skill count does not match exact discovery"
  fi
}

verify_payload_tree() {
  local source_skill="$1"
  local target_skill="$2"
  local skill_name="$3"
  local source_directory
  local source_directory_count=0
  local source_file
  local source_file_count=0
  local relative_path
  local target_directory
  local target_directory_count=0
  local target_file
  local target_file_count=0

  [[ -d "$target_skill" ]] || fail "installed skill is missing: $skill_name"
  if [[ -n "$(find "$target_skill" -type l -print -quit)" ]]; then
    fail "installed payload contains a nested symlink: $skill_name"
  fi

  while IFS= read -r -d '' source_file; do
    relative_path="${source_file#"$source_skill"/}"
    target_file="$target_skill/$relative_path"
    [[ -f "$target_file" ]] || fail "installed payload is missing for $skill_name"
    [[ ! -L "$target_file" ]] || fail "installed payload is a symlink for $skill_name"
    cmp -s -- "$source_file" "$target_file" \
      || fail "installed payload differs for $skill_name"
    if [[ -x "$source_file" && ! -x "$target_file" ]]; then
      fail "installed executable mode differs for $skill_name"
    fi
    if [[ ! -x "$source_file" && -x "$target_file" ]]; then
      fail "installed executable mode differs for $skill_name"
    fi
    source_file_count=$((source_file_count + 1))
  done < <(find "$source_skill" -type f -print0)

  while IFS= read -r -d '' target_file; do
    target_file_count=$((target_file_count + 1))
  done < <(find "$target_skill" -type f -print0)
  if ((source_file_count != target_file_count)); then
    fail "installed file set differs for $skill_name"
  fi

  while IFS= read -r -d '' source_directory; do
    relative_path="${source_directory#"$source_skill"}"
    target_directory="$target_skill$relative_path"
    [[ -d "$target_directory" ]] \
      || fail "installed directory is missing for $skill_name"
    source_directory_count=$((source_directory_count + 1))
  done < <(find "$source_skill" -type d -print0)

  while IFS= read -r -d '' target_directory; do
    target_directory_count=$((target_directory_count + 1))
  done < <(find "$target_skill" -type d -print0)
  if ((source_directory_count != target_directory_count)); then
    fail "installed directory set differs for $skill_name"
  fi
}

verify_symlink_project() {
  local project_root="$1"
  local canonical_root="$project_root/.agents/skills"
  local claude_root="$project_root/.claude/skills"
  local canonical_skill
  local canonical_resolved
  local claude_skill
  local claude_resolved
  local skill_name
  local source_skill

  verify_target_set "$canonical_root"
  verify_target_set "$claude_root"
  for skill_name in "${SOURCE_SKILL_NAMES[@]}"; do
    source_skill="$REPOSITORY_ROOT/.agents/skills/$skill_name"
    canonical_skill="$canonical_root/$skill_name"
    claude_skill="$claude_root/$skill_name"
    [[ ! -L "$canonical_skill" ]] \
      || fail "canonical skill unexpectedly uses a symlink: $skill_name"
    verify_payload_tree "$source_skill" "$canonical_skill" "$skill_name"
    [[ -L "$claude_skill" ]] \
      || fail "default install did not create a client symlink: $skill_name"
    canonical_resolved="$(cd -- "$canonical_skill" && pwd -P)"
    claude_resolved="$(cd -- "$claude_skill" && pwd -P)"
    [[ "$claude_resolved" == "$canonical_resolved" ]] \
      || fail "client symlink does not resolve to the canonical skill: $skill_name"
  done
}

verify_copy_project() {
  local project_root="$1"
  local agent_root
  local skill_name
  local source_skill
  local target_skill

  for agent_root in \
    "$project_root/.agents/skills" \
    "$project_root/.claude/skills"; do
    verify_target_set "$agent_root"
    if [[ -n "$(find "$agent_root" -type l -print -quit)" ]]; then
      fail "copy-mode project contains a symlink"
    fi
    for skill_name in "${SOURCE_SKILL_NAMES[@]}"; do
      source_skill="$REPOSITORY_ROOT/.agents/skills/$skill_name"
      target_skill="$agent_root/$skill_name"
      [[ ! -L "$target_skill" ]] \
        || fail "copy-mode skill root is a symlink: $skill_name"
      verify_payload_tree "$source_skill" "$target_skill" "$skill_name"
    done
  done
}

trap cleanup EXIT
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM

require_command node
require_node_version
require_command npm
require_command npx
require_command git
require_command find
require_command cmp

node "$REPOSITORY_ROOT/scripts/validate-repo.mjs"

for source_skill in "$REPOSITORY_ROOT"/.agents/skills/*; do
  [[ -d "$source_skill" ]] || continue
  SOURCE_SKILL_NAMES+=("${source_skill##*/}")
done
((${#SOURCE_SKILL_NAMES[@]} > 0)) || fail "no source skills were found"

SMOKE_TEMP_DIR="$(mktemp -d /tmp/selfhost-skills-smoke.XXXXXX)"
[[ -d "$SMOKE_TEMP_DIR" ]] || fail "mktemp did not create the disposable directory"
LIST_PROJECT="$SMOKE_TEMP_DIR/list"
SYMLINK_PROJECT="$SMOKE_TEMP_DIR/symlink"
COPY_PROJECT="$SMOKE_TEMP_DIR/copy"
mkdir -p -- "$LIST_PROJECT" "$SYMLINK_PROJECT" "$COPY_PROJECT"

export DISABLE_TELEMETRY=1
export DO_NOT_TRACK=1
export NPM_CONFIG_AUDIT=false
export NPM_CONFIG_CACHE="$SMOKE_TEMP_DIR/npm-cache"
export NPM_CONFIG_FUND=false
export NPM_CONFIG_UPDATE_NOTIFIER=false
export NPM_CONFIG_USERCONFIG=/dev/null
export XDG_CACHE_HOME="$SMOKE_TEMP_DIR/xdg-cache"
export XDG_CONFIG_HOME="$SMOKE_TEMP_DIR/xdg-config"
export XDG_STATE_HOME="$SMOKE_TEMP_DIR/xdg-state"

ADD_HELP="$(
  cd -- "$LIST_PROJECT"
  npx --yes skills@latest add --help 2>&1
)" || fail "unable to resolve the current skills CLI help"

for required_flag in \
  "--list" \
  "--copy" \
  "--skill" \
  "--agent" \
  "--yes" \
  "--all"; do
  require_add_flag "$required_flag"
done

LIST_OUTPUT="$(
  cd -- "$LIST_PROJECT"
  npx --yes skills@latest add "$REPOSITORY_ROOT" --list
)" || fail "skills CLI could not list the local repository"
case "$LIST_OUTPUT" in
  *"Available Skills"*)
    ;;
  *)
    fail "skills CLI list output is missing its documented heading"
    ;;
esac

LISTED_SKILL_NAMES=()
while IFS= read -r list_line; do
  list_line="${list_line%$'\r'}"
  listed_name=""
  case "$list_line" in
    "│    "*)
      listed_name="${list_line#"│    "}"
      ;;
    "|    "*)
      listed_name="${list_line#"|    "}"
      ;;
  esac
  if [[ "$listed_name" =~ ^[a-z0-9]+(-[a-z0-9]+)*$ ]]; then
    name_in_array "$listed_name" "${LISTED_SKILL_NAMES[@]}" \
      && fail "skills CLI listed a duplicate skill: $listed_name"
    LISTED_SKILL_NAMES+=("$listed_name")
  fi
done <<< "$LIST_OUTPUT"

if ((${#LISTED_SKILL_NAMES[@]} != ${#SOURCE_SKILL_NAMES[@]})); then
  fail "skills CLI list did not return the exact source skill count"
fi
for skill_name in "${SOURCE_SKILL_NAMES[@]}"; do
  name_in_array "$skill_name" "${LISTED_SKILL_NAMES[@]}" \
    || fail "skills CLI did not list exact skill name: $skill_name"
done
for skill_name in "${LISTED_SKILL_NAMES[@]}"; do
  name_in_array "$skill_name" "${SOURCE_SKILL_NAMES[@]}" \
    || fail "skills CLI listed an unexpected skill: $skill_name"
done

(
  cd -- "$SYMLINK_PROJECT"
  npx --yes skills@latest add "$REPOSITORY_ROOT" \
    --skill '*' \
    --agent codex \
    --agent claude-code \
    --yes
) || fail "default symlink-mode disposable install failed"

(
  cd -- "$COPY_PROJECT"
  npx --yes skills@latest add "$REPOSITORY_ROOT" \
    --skill '*' \
    --agent codex \
    --agent claude-code \
    --copy \
    --yes
) || fail "copy-mode disposable install failed"

verify_symlink_project "$SYMLINK_PROJECT"
verify_copy_project "$COPY_PROJECT"

for payload_kind in scripts references assets; do
  [[ -d "$SYMLINK_PROJECT/.agents/skills/selfhost-media/$payload_kind" ]] \
    || fail "default install is missing selfhost-media $payload_kind"
  [[ -d "$COPY_PROJECT/.agents/skills/selfhost-media/$payload_kind" ]] \
    || fail "copy install is missing selfhost-media $payload_kind"
  [[ -d "$COPY_PROJECT/.claude/skills/selfhost-media/$payload_kind" ]] \
    || fail "Claude Code copy is missing selfhost-media $payload_kind"
done

printf 'PASS smoke-install: %d exact skills verified in default symlink and copy projects\n' \
  "${#SOURCE_SKILL_NAMES[@]}"
