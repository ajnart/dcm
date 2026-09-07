#!/usr/bin/env bash

set -euo pipefail
umask 077

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
REPO_ROOT="$(cd -- "$SCRIPT_DIR/.." && pwd -P)"
SESSIONS_DIR="$REPO_ROOT/.sessions"
COMPOSE_FILE="$REPO_ROOT/docker-compose.yml"
PORT_MIN=20000
PORT_MAX=44999
CURRENT_SESSION_PASSWORD_SCHEME="hmac-v1"
SESSIONS_LOCK="$SESSIONS_DIR/.ports.lock"
CREATE_STAGING_DIR=""
CREATE_RUN_ID=""
RUN_LOCK_FILE=""
DESTROY_IMAGE_MANIFEST=""
TOMBSTONE_TRANSIENTS_REMOVED=0
declare -A DESTROY_IMAGE_IDS=()
DESTROY_SERVICES=(prowlarr radarr sonarr qbittorrent jellyfin seerr homarr)

usage() {
  cat <<'EOF'
Usage:
  scripts/session.sh create [RUN_ID]
  scripts/session.sh up RUN_ID
  scripts/session.sh keys RUN_ID
  scripts/session.sh bootstrap RUN_ID
  scripts/session.sh verify RUN_ID
  scripts/session.sh browser-password RUN_ID @eN [@eN ...]
  scripts/session.sh browser-key capture|fill RUN_ID SERVICE @eN
  scripts/session.sh homarr-key RUN_ID < ONE_TIME_KEY
  scripts/session.sh homarr-finalize RUN_ID
  scripts/session.sh mcp-config RUN_ID
  scripts/session.sh mcp-verify RUN_ID
  scripts/session.sh connections-check RUN_ID
  scripts/session.sh connections RUN_ID
  scripts/session.sh handoff RUN_ID
  scripts/session.sh down RUN_ID
  scripts/session.sh status RUN_ID
  scripts/session.sh urls RUN_ID
  scripts/session.sh env RUN_ID
  scripts/session.sh doctor [RUN_ID]
  scripts/session.sh destroy RUN_ID --confirm RUN_ID

RUN_ID must start with a lowercase letter or digit and contain only lowercase
letters, digits, underscores, and hyphens (maximum 40 characters).

destroy is intentionally explicit. It only removes the validated run named
twice on the command line; no command targets all sessions or the legacy stack.
EOF
}

fail() {
  printf 'error: %s\n' "$*" >&2
  exit 1
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || fail "required command not found: $1"
}

ensure_sessions_root() {
  local resolved_sessions_dir
  local owner_uid
  local owner_gid

  require_command realpath
  require_command stat

  if [[ ! -e "$SESSIONS_DIR" && ! -L "$SESSIONS_DIR" ]]; then
    if ! mkdir -m 0700 -- "$SESSIONS_DIR" 2>/dev/null; then
      [[ -e "$SESSIONS_DIR" || -L "$SESSIONS_DIR" ]] || fail "could not create .sessions"
    fi
  fi

  [[ -d "$SESSIONS_DIR" && ! -L "$SESSIONS_DIR" ]] || fail ".sessions must be a real directory"
  resolved_sessions_dir="$(realpath -e -- "$SESSIONS_DIR")"
  [[ "$resolved_sessions_dir" == "$SESSIONS_DIR" ]] || fail ".sessions escaped the repository"
  [[ "$(dirname -- "$resolved_sessions_dir")" == "$REPO_ROOT" ]] || fail ".sessions escaped the repository"

  owner_uid="$(stat -c '%u' -- "$SESSIONS_DIR")"
  owner_gid="$(stat -c '%g' -- "$SESSIONS_DIR")"
  [[ "$owner_uid" == "$(id -u)" ]] || fail ".sessions must be owned by the current user"
  [[ "$owner_gid" == "$(id -g)" ]] || fail ".sessions must use the current user group"
  chmod 0700 -- "$SESSIONS_DIR"
  [[ "$(stat -c '%a' -- "$SESSIONS_DIR")" == "700" ]] || fail ".sessions must use mode 0700"

  if [[ ! -e "$SESSIONS_LOCK" && ! -L "$SESSIONS_LOCK" ]]; then
    : >> "$SESSIONS_LOCK"
  fi
  [[ -f "$SESSIONS_LOCK" && ! -L "$SESSIONS_LOCK" ]] || fail "session lock must be a regular file"
  [[ "$(realpath -e -- "$SESSIONS_LOCK")" == "$SESSIONS_LOCK" ]] || fail "session lock escaped .sessions"
  [[ "$(stat -c '%h' -- "$SESSIONS_LOCK")" == "1" ]] || fail "session lock must not be hard-linked"
  [[ "$(stat -c '%u' -- "$SESSIONS_LOCK")" == "$(id -u)" ]] || fail "session lock has the wrong owner"
  [[ "$(stat -c '%g' -- "$SESSIONS_LOCK")" == "$(id -g)" ]] || fail "session lock has the wrong group"
  chmod 0600 -- "$SESSIONS_LOCK"
  [[ "$(stat -c '%a' -- "$SESSIONS_LOCK")" == "600" ]] || fail "session lock must use mode 0600"
}

open_sessions_lock() {
  require_command flock
  ensure_sessions_root
  exec 9>>"$SESSIONS_LOCK"
  flock 9
  [[ "$(realpath -e -- "/proc/$$/fd/9")" == "$SESSIONS_LOCK" ]] || fail "opened the wrong session lock"
}

open_run_lock() {
  local run_id="$1"
  local lock_file

  validate_run_id "$run_id"
  ensure_sessions_root
  require_command flock
  lock_file="$SESSIONS_DIR/.run-$run_id.lock"
  if [[ ! -e "$lock_file" && ! -L "$lock_file" ]]; then
    : >> "$lock_file"
  fi
  [[ -f "$lock_file" && ! -L "$lock_file" ]] || fail "run lock must be a regular file"
  [[ "$(realpath -e -- "$lock_file")" == "$lock_file" ]] || fail "run lock escaped .sessions"
  [[ "$(stat -c '%h' -- "$lock_file")" == "1" ]] || fail "run lock must not be hard-linked"
  [[ "$(stat -c '%u' -- "$lock_file")" == "$(id -u)" ]] || fail "run lock has the wrong owner"
  [[ "$(stat -c '%g' -- "$lock_file")" == "$(id -g)" ]] || fail "run lock has the wrong group"
  chmod 0600 -- "$lock_file"
  [[ "$(stat -c '%a' -- "$lock_file")" == "600" ]] || fail "run lock must use mode 0600"

  exec 8>>"$lock_file"
  flock 8
  [[ "$(realpath -e -- "/proc/$$/fd/8")" == "$lock_file" ]] || fail "opened the wrong run lock"
  RUN_LOCK_FILE="$lock_file"
}

close_run_lock() {
  [[ -n "$RUN_LOCK_FILE" ]] || return 0
  flock -u 8
  exec 8>&-
  RUN_LOCK_FILE=""
}

validate_run_id() {
  local run_id="$1"

  if [[ ! "$run_id" =~ ^[a-z0-9][a-z0-9_-]{0,39}$ ]]; then
    fail "invalid RUN_ID: $run_id"
  fi
}

safe_timezone() {
  local inherited_tz="$1"

  if (( ${#inherited_tz} <= 64 )) \
    && [[ "$inherited_tz" =~ ^[a-zA-Z][a-zA-Z0-9_-]*(/[a-zA-Z0-9_-]+)*$ ]] \
    && [[ -f "/usr/share/zoneinfo/$inherited_tz" ]]; then
    printf '%s\n' "$inherited_tz"
    return
  fi
  printf 'Europe/Berlin\n'
}

session_dir_for() {
  local run_id="$1"
  printf '%s/%s\n' "$SESSIONS_DIR" "$run_id"
}

tombstone_dir_for() {
  local run_id="$1"
  printf '%s/.destroy-%s.tombstone\n' "$SESSIONS_DIR" "$run_id"
}

validate_private_control_file() {
  local file_path="$1"
  local expected_parent="$2"
  local label="$3"

  [[ -f "$file_path" && ! -L "$file_path" ]] || fail "$label must be a regular file"
  [[ "$(dirname -- "$file_path")" == "$expected_parent" ]] || fail "$label escaped its session"
  [[ "$(realpath -e -- "$file_path")" == "$file_path" ]] || fail "$label escaped its session"
  [[ "$(stat -c '%h' -- "$file_path")" == "1" ]] || fail "$label must not be hard-linked"
  [[ "$(stat -c '%u' -- "$file_path")" == "$(id -u)" ]] || fail "$label has the wrong owner"
  [[ "$(stat -c '%g' -- "$file_path")" == "$(id -g)" ]] || fail "$label has the wrong group"
  [[ "$(stat -c '%a' -- "$file_path")" == "600" ]] || fail "$label must use mode 0600"
}

validate_homarr_api_key_file() {
  local file_path="$1"
  local expected_parent="$2"
  local label="$3"
  local line

  validate_private_control_file "$file_path" "$expected_parent" "$label"
  (( $(stat -c '%s' -- "$file_path") <= 512 )) || fail "$label is too large"
  IFS= read -r line < "$file_path" || fail "$label is incomplete"
  [[ "$(wc -l < "$file_path")" == "1" ]] || fail "$label must contain exactly one line"
  [[ "$line" =~ ^HOMARR_API_KEY=[A-Za-z0-9_-]{1,192}\.[A-Za-z0-9_-]{16,400}$ ]] \
    || fail "$label is invalid"
}

validate_connections_control_file() {
  local file_path="$1"
  local expected_parent="$2"
  local label="$3"

  validate_private_control_file "$file_path" "$expected_parent" "$label"
  (( $(stat -c '%s' -- "$file_path") <= 8192 )) || fail "$label is too large"
}

validate_legacy_credentials_control_file() {
  local file_path="$1"
  local expected_parent="$2"
  local label="$3"

  validate_private_control_file "$file_path" "$expected_parent" "$label"
  (( $(stat -c '%s' -- "$file_path") <= 8192 )) || fail "$label is too large"
}

validate_connections_schema_file() {
  local file_path="$1"
  local expected_parent="$2"
  local label="$3"
  local line
  local key
  local value
  local required_key
  local -A seen=()
  local -a required_keys=(
    RUN_ID
    PROWLARR_URL PROWLARR_USERNAME PROWLARR_API_KEY
    RADARR_URL RADARR_USERNAME RADARR_API_KEY
    SONARR_URL SONARR_USERNAME SONARR_API_KEY
    QBITTORRENT_URL QBITTORRENT_USERNAME
    JELLYFIN_URL JELLYFIN_USERNAME
    SEERR_URL SEERR_USERNAME SEERR_API_KEY
    HOMARR_URL HOMARR_USERNAME
  )

  validate_connections_control_file "$file_path" "$expected_parent" "$label"
  while IFS= read -r line || [[ -n "$line" ]]; do
    [[ "$line" == *=* ]] || fail "$label contains an invalid entry"
    key="${line%%=*}"
    value="${line#*=}"
    [[ "$key" =~ ^[A-Z][A-Z0-9_]*$ && -z "${seen[$key]+present}" ]] \
      || fail "$label contains an unexpected or duplicate entry"
    seen["$key"]=1

    case "$key" in
      RUN_ID)
        [[ "$value" == "$RUN_ID" ]] || fail "$label RUN_ID mismatch"
        ;;
      PROWLARR_URL)
        [[ "$value" == "http://localhost:$PROWLARR_PORT" ]] || fail "$label contains an invalid Prowlarr URL"
        ;;
      RADARR_URL)
        [[ "$value" == "http://localhost:$RADARR_PORT" ]] || fail "$label contains an invalid Radarr URL"
        ;;
      SONARR_URL)
        [[ "$value" == "http://localhost:$SONARR_PORT" ]] || fail "$label contains an invalid Sonarr URL"
        ;;
      QBITTORRENT_URL)
        [[ "$value" == "http://localhost:$QBITTORRENT_PORT" ]] || fail "$label contains an invalid qBittorrent URL"
        ;;
      JELLYFIN_URL)
        [[ "$value" == "http://localhost:$JELLYFIN_PORT" ]] || fail "$label contains an invalid Jellyfin URL"
        ;;
      SEERR_URL)
        [[ "$value" == "http://localhost:$SEERR_PORT" ]] || fail "$label contains an invalid Seerr URL"
        ;;
      HOMARR_URL)
        [[ "$value" == "http://localhost:$HOMARR_PORT" ]] || fail "$label contains an invalid Homarr URL"
        ;;
      *_USERNAME)
        [[ "$value" == "admin" ]] || fail "$label contains an invalid username"
        ;;
      PROWLARR_API_KEY|RADARR_API_KEY|SONARR_API_KEY|SEERR_API_KEY)
        [[ "$value" =~ ^[0-9a-f]{32}$ ]] || fail "$label contains an invalid service API key"
        ;;
      HOMARR_API_KEY)
        [[ "$value" =~ ^[A-Za-z0-9_-]{1,192}\.[A-Za-z0-9_-]{16,400}$ ]] \
          || fail "$label contains an invalid Homarr API key"
        ;;
      *)
        fail "$label contains an unexpected entry"
        ;;
    esac
  done < "$file_path"

  for required_key in "${required_keys[@]}"; do
    [[ -n "${seen[$required_key]+present}" ]] || fail "$label is incomplete"
  done
}

cleanup_validated_homarr_key_transients() {
  local parent_dir="$1"
  local transient
  local transient_name
  local -a transients=()

  shopt -s nullglob
  transients=("$parent_dir"/.homarr-api-key.env.*)
  shopt -u nullglob
  for transient in "${transients[@]}"; do
    transient_name="$(basename -- "$transient")"
    [[ "$transient_name" =~ ^\.homarr-api-key\.env\.[0-9a-f]{24}$ ]] \
      || fail "session contains an invalid Homarr API key transient"
    validate_private_control_file "$transient" "$parent_dir" "replacement Homarr API key file"
    (( $(stat -c '%s' -- "$transient") <= 512 )) \
      || fail "replacement Homarr API key file is too large"
    find "$transient" -maxdepth 0 -type f -delete
  done
}

cleanup_validated_connections_transients() {
  local parent_dir="$1"
  local transient
  local transient_name
  local -a transients=()

  shopt -s nullglob
  transients=("$parent_dir"/.connections.env.*)
  shopt -u nullglob
  for transient in "${transients[@]}"; do
    transient_name="$(basename -- "$transient")"
    [[ "$transient_name" =~ ^\.connections\.env\.[0-9a-f]{24}$ ]] \
      || fail "session contains an invalid connections transient"
    validate_private_control_file "$transient" "$parent_dir" "replacement connections file"
    (( $(stat -c '%s' -- "$transient") <= 8192 )) \
      || fail "replacement connections file is too large"
    find "$transient" -maxdepth 0 -type f -delete
  done
}

cleanup_validated_secret_transients() {
  local parent_dir="$1"
  local transient
  local transient_name
  local -a transients=()

  shopt -s nullglob
  transients=("$parent_dir"/.secrets.env.*)
  shopt -u nullglob
  for transient in "${transients[@]}"; do
    transient_name="$(basename -- "$transient")"
    [[ "$transient_name" =~ ^\.secrets\.env\.([[:alnum:]]{6}|[0-9a-f]{24})$ ]] \
      || fail "session contains an invalid secrets transient"
    validate_private_control_file "$transient" "$parent_dir" "replacement secrets file"
    find "$transient" -maxdepth 0 -type f -delete
  done
}

cleanup_validated_tombstone_transients() {
  local parent_dir="$1"
  local transient
  local transient_name
  local -a transients=()

  TOMBSTONE_TRANSIENTS_REMOVED=0
  shopt -s nullglob
  transients=("$parent_dir"/.destroy-tombstone.??????)
  shopt -u nullglob
  for transient in "${transients[@]}"; do
    transient_name="$(basename -- "$transient")"
    [[ "$transient_name" =~ ^\.destroy-tombstone\.[[:alnum:]]{6}$ ]] \
      || fail "session contains an invalid destroy tombstone transient"
    validate_private_control_file "$transient" "$parent_dir" "destroy tombstone transient"
    find "$transient" -maxdepth 0 -type f -delete
    TOMBSTONE_TRANSIENTS_REMOVED=$((TOMBSTONE_TRANSIENTS_REMOVED + 1))
  done
}

validate_manifest_syntax() {
  local manifest="$1"
  local line
  local key

  while IFS= read -r line || [[ -n "$line" ]]; do
    if [[ ! "$line" =~ ^[A-Z][A-Z0-9_]*=[a-zA-Z0-9_./:-]+$ ]]; then
      fail "invalid manifest entry in $manifest"
    fi

    key="${line%%=*}"
    case "$key" in
      RUN_ID|COMPOSE_PROJECT_NAME|SESSION_ROOT|AGENT_BROWSER_SESSION|PUID|PGID|TZ)
        ;;
      PROWLARR_PORT|RADARR_PORT|SONARR_PORT|QBITTORRENT_PORT)
        ;;
      JELLYFIN_PORT|SEERR_PORT|HOMARR_PORT)
        ;;
      SESSION_PASSWORD_SCHEME)
        [[ "${line#*=}" == "$CURRENT_SESSION_PASSWORD_SCHEME" ]] \
          || fail "invalid session password scheme"
        ;;
      *)
        fail "unexpected manifest key: $key"
        ;;
    esac
  done < "$manifest"
}

validate_port() {
  local name="$1"
  local value="$2"

  if [[ ! "$value" =~ ^[0-9]+$ ]]; then
    fail "$name is not a numeric port"
  fi

  if (( value < PORT_MIN || value > PORT_MAX )); then
    fail "$name is outside the managed port range"
  fi
}

load_session() {
  local requested_run_id="$1"
  local session_dir
  local manifest
  local secrets
  local resolved_sessions_dir
  local resolved_session_dir
  local -a ports
  local -A seen_ports=()
  local port

  ensure_sessions_root
  validate_run_id "$requested_run_id"
  session_dir="$(session_dir_for "$requested_run_id")"
  manifest="$session_dir/manifest.env"
  secrets="$session_dir/secrets.env"

  [[ -d "$session_dir" ]] || fail "session does not exist: $requested_run_id"
  [[ ! -L "$session_dir" ]] || fail "session directory must not be a symlink"

  resolved_sessions_dir="$(realpath -e -- "$SESSIONS_DIR")"
  resolved_session_dir="$(realpath -e -- "$session_dir")"
  [[ "$(dirname -- "$resolved_session_dir")" == "$resolved_sessions_dir" ]] || fail "session escaped .sessions"
  [[ "$(stat -c '%u' -- "$resolved_session_dir")" == "$(id -u)" ]] || fail "session directory has the wrong owner"
  [[ "$(stat -c '%g' -- "$resolved_session_dir")" == "$(id -g)" ]] || fail "session directory has the wrong group"
  [[ "$(stat -c '%a' -- "$resolved_session_dir")" == "700" ]] || fail "session directory must use mode 0700"
  validate_private_control_file "$manifest" "$resolved_session_dir" "manifest"
  validate_private_control_file "$secrets" "$resolved_session_dir" "secrets file"

  validate_manifest_syntax "$manifest"

  if [[ -e "$resolved_session_dir/credentials.env" \
    || -L "$resolved_session_dir/credentials.env" ]]; then
    validate_legacy_credentials_control_file \
      "$resolved_session_dir/credentials.env" \
      "$resolved_session_dir" \
      "legacy credentials file"
  fi

  unset RUN_ID COMPOSE_PROJECT_NAME SESSION_ROOT AGENT_BROWSER_SESSION
  unset PUID PGID TZ PROWLARR_PORT RADARR_PORT SONARR_PORT
  unset QBITTORRENT_PORT JELLYFIN_PORT SEERR_PORT HOMARR_PORT
  unset SESSION_PASSWORD_SCHEME
  unset HOMARR_ENCRYPTION_KEY SONARR_API_KEY RADARR_API_KEY
  unset PROWLARR_API_KEY SEERR_API_KEY
  unset HOMARR_API_KEY
  # The generated manifest is syntax-restricted above before it is sourced.
  # shellcheck disable=SC1090
  source "$manifest"

  [[ "$RUN_ID" == "$requested_run_id" ]] || fail "manifest RUN_ID mismatch"
  [[ "$SESSION_ROOT" == "$resolved_session_dir" ]] || fail "manifest SESSION_ROOT mismatch"
  [[ "$COMPOSE_PROJECT_NAME" == "autostack-$RUN_ID" ]] || fail "manifest project mismatch"
  [[ "$AGENT_BROWSER_SESSION" == "auto-stack-$RUN_ID" ]] || fail "manifest browser session mismatch"
  if [[ -n "${SESSION_PASSWORD_SCHEME+x}" \
    && "$SESSION_PASSWORD_SCHEME" != "$CURRENT_SESSION_PASSWORD_SCHEME" ]]; then
    fail "invalid session password scheme"
  fi
  [[ "$PUID" =~ ^[0-9]+$ ]] || fail "invalid PUID"
  [[ "$PGID" =~ ^[0-9]+$ ]] || fail "invalid PGID"

  ports=(
    "$PROWLARR_PORT"
    "$RADARR_PORT"
    "$SONARR_PORT"
    "$QBITTORRENT_PORT"
    "$JELLYFIN_PORT"
    "$SEERR_PORT"
    "$HOMARR_PORT"
  )

  for port in "${ports[@]}"; do
    validate_port "manifest port" "$port"
    if [[ -n "${seen_ports[$port]+present}" ]]; then
      fail "manifest contains a duplicate port: $port"
    fi
    seen_ports["$port"]=1
  done

  [[ "$(grep -Ec '^HOMARR_ENCRYPTION_KEY=[0-9a-f]{64}$' "$secrets")" == "1" ]] || fail "invalid Homarr encryption key"
  [[ "$(grep -Ec '^SONARR_API_KEY=[0-9a-f]{32}$' "$secrets")" == "1" ]] || fail "invalid Sonarr API key"
  [[ "$(grep -Ec '^RADARR_API_KEY=[0-9a-f]{32}$' "$secrets")" == "1" ]] || fail "invalid Radarr API key"
  [[ "$(grep -Ec '^PROWLARR_API_KEY=[0-9a-f]{32}$' "$secrets")" == "1" ]] || fail "invalid Prowlarr API key"
  [[ "$(grep -Ec '^SEERR_API_KEY=[0-9a-f]{32}$' "$secrets")" == "1" ]] || fail "invalid Seerr API key"
  [[ "$(wc -l < "$secrets")" == "5" ]] || fail "unexpected secrets file entries"

  if [[ -e "$resolved_session_dir/homarr-api-key.env" \
    || -L "$resolved_session_dir/homarr-api-key.env" ]]; then
    validate_homarr_api_key_file \
      "$resolved_session_dir/homarr-api-key.env" \
      "$resolved_session_dir" \
      "Homarr API key file"
  fi
  if [[ -e "$resolved_session_dir/connections.env" \
    || -L "$resolved_session_dir/connections.env" ]]; then
    validate_connections_schema_file \
      "$resolved_session_dir/connections.env" \
      "$resolved_session_dir" \
      "connections file"
  fi

  SESSION_DIR="$resolved_session_dir"
  MANIFEST_FILE="$manifest"
  SECRETS_FILE="$secrets"
}

require_session_password_scheme() {
  [[ "${SESSION_PASSWORD_SCHEME:-}" == "$CURRENT_SESSION_PASSWORD_SCHEME" ]] \
    || fail "session password scheme requires recreation"
}

compose() {
  docker compose \
    --project-name "$COMPOSE_PROJECT_NAME" \
    --env-file "$MANIFEST_FILE" \
    --env-file "$SECRETS_FILE" \
    --file "$COMPOSE_FILE" \
    "$@"
}

extract_arr_api_key() {
  local service="$1"
  local target_name="$2"
  local value

  value="$(
    compose exec -T "$service" sh -c \
      "sed -n 's:.*<ApiKey>\\([^<]*\\)</ApiKey>.*:\\1:p' /config/config.xml" \
      2>/dev/null | tr -d '\r\n' | tr 'A-F' 'a-f'
  )"

  if [[ ! "$value" =~ ^[0-9a-f]{32}$ ]]; then
    fail "$service API key is not ready; wait for its UI to respond and retry"
  fi

  printf -v "$target_name" '%s' "$value"
}

sync_arr_api_keys() {
  local sonarr_api_key
  local radarr_api_key
  local prowlarr_api_key
  local replacement

  extract_arr_api_key sonarr sonarr_api_key
  extract_arr_api_key radarr radarr_api_key
  extract_arr_api_key prowlarr prowlarr_api_key

  # load_session proves that this file contains exactly five hex-only entries.
  # shellcheck disable=SC1090
  source "$SECRETS_FILE"
  replacement="$(mktemp "$SESSION_DIR/.secrets.env.XXXXXX")"
  chmod 600 -- "$replacement"
  validate_private_control_file "$replacement" "$SESSION_DIR" "replacement secrets file"
  {
    printf 'HOMARR_ENCRYPTION_KEY=%s\n' "$HOMARR_ENCRYPTION_KEY"
    printf 'SONARR_API_KEY=%s\n' "$sonarr_api_key"
    printf 'RADARR_API_KEY=%s\n' "$radarr_api_key"
    printf 'PROWLARR_API_KEY=%s\n' "$prowlarr_api_key"
    printf 'SEERR_API_KEY=%s\n' "$SEERR_API_KEY"
  } > "$replacement"
  validate_private_control_file "$replacement" "$SESSION_DIR" "replacement secrets file"
  mv -T -- "$replacement" "$SECRETS_FILE"
  validate_private_control_file "$SECRETS_FILE" "$SESSION_DIR" "secrets file"
  printf 'Synchronized this run\x27s Arr API keys without displaying them.\n'
}

collect_used_ports_locked() {
  local session_dir
  local resolved_session_dir
  local manifest
  local directory_run_id
  local manifest_run_id
  local manifest_session_root
  local manifest_project
  local manifest_browser_session
  local line
  local key
  local value
  local port_count
  local -a session_dirs=()
  local -A manifest_keys=()
  local -A used_ports=()

  [[ "$(realpath -e -- "/proc/$$/fd/9")" == "$SESSIONS_LOCK" ]] \
    || fail "used-port collection requires the global session lock"
  RESERVED_PORTS=()
  shopt -s nullglob
  session_dirs=("$SESSIONS_DIR"/*)
  shopt -u nullglob
  for session_dir in "${session_dirs[@]}"; do
    [[ -d "$session_dir" && ! -L "$session_dir" ]] || fail "invalid entry in .sessions"
    resolved_session_dir="$(realpath -e -- "$session_dir")"
    [[ "$resolved_session_dir" == "$session_dir" ]] || fail "existing session escaped .sessions"
    [[ "$(dirname -- "$resolved_session_dir")" == "$SESSIONS_DIR" ]] || fail "existing session escaped .sessions"
    [[ "$(stat -c '%u' -- "$resolved_session_dir")" == "$(id -u)" ]] || fail "existing session has the wrong owner"
    [[ "$(stat -c '%g' -- "$resolved_session_dir")" == "$(id -g)" ]] || fail "existing session has the wrong group"
    [[ "$(stat -c '%a' -- "$resolved_session_dir")" == "700" ]] || fail "existing session must use mode 0700"

    directory_run_id="$(basename -- "$resolved_session_dir")"
    validate_run_id "$directory_run_id"
    manifest="$resolved_session_dir/manifest.env"
    validate_private_control_file "$manifest" "$resolved_session_dir" "existing session manifest"
    validate_manifest_syntax "$manifest"

    manifest_keys=()
    manifest_run_id=""
    manifest_session_root=""
    manifest_project=""
    manifest_browser_session=""
    port_count=0
    while IFS= read -r line || [[ -n "$line" ]]; do
      key="${line%%=*}"
      value="${line#*=}"
      [[ -z "${manifest_keys[$key]+present}" ]] || fail "existing session manifest contains a duplicate key"
      manifest_keys["$key"]=1
      case "$key" in
        RUN_ID)
          manifest_run_id="$value"
          ;;
        SESSION_ROOT)
          manifest_session_root="$value"
          ;;
        COMPOSE_PROJECT_NAME)
          manifest_project="$value"
          ;;
        AGENT_BROWSER_SESSION)
          manifest_browser_session="$value"
          ;;
        *_PORT)
          validate_port "existing session port" "$value"
          [[ -z "${used_ports[$value]+present}" ]] || fail "existing sessions reuse a managed port"
          used_ports["$value"]=1
          RESERVED_PORTS+=("$value")
          port_count=$((port_count + 1))
          ;;
      esac
    done < "$manifest"
    if [[ "${#manifest_keys[@]}" != "14" && "${#manifest_keys[@]}" != "15" ]]; then
      fail "existing session manifest is incomplete"
    fi
    [[ "$port_count" == "7" ]] || fail "existing session manifest has an invalid port set"
    [[ "$manifest_run_id" == "$directory_run_id" ]] || fail "existing session manifest RUN_ID mismatch"
    [[ "$manifest_session_root" == "$resolved_session_dir" ]] || fail "existing session manifest root mismatch"
    [[ "$manifest_project" == "autostack-$directory_run_id" ]] || fail "existing session manifest project mismatch"
    [[ "$manifest_browser_session" == "auto-stack-$directory_run_id" ]] || fail "existing session manifest browser mismatch"
  done
}

collect_listening_ports() {
  local socket_table
  local hex_port

  LISTENING_PORTS=()
  for socket_table in /proc/net/tcp /proc/net/tcp6; do
    [[ -r "$socket_table" ]] || fail "cannot inspect listening ports: $socket_table"
    while IFS= read -r hex_port; do
      if [[ "$hex_port" =~ ^[0-9A-Fa-f]{4}$ ]]; then
        LISTENING_PORTS+=("$((16#$hex_port))")
      fi
    done < <(awk 'NR > 1 && $4 == "0A" { split($2, address, ":"); print address[2] }' "$socket_table")
  done
}

port_is_reserved() {
  local candidate="$1"
  local reserved
  local listening

  for reserved in "${RESERVED_PORTS[@]}"; do
    if [[ "$reserved" == "$candidate" ]]; then
      return 0
    fi
  done

  for listening in "${LISTENING_PORTS[@]}"; do
    if [[ "$listening" == "$candidate" ]]; then
      return 0
    fi
  done

  return 1
}

allocate_port() {
  local target_name="$1"
  local candidate="$NEXT_PORT"

  while (( candidate <= PORT_MAX )); do
    if ! port_is_reserved "$candidate"; then
      RESERVED_PORTS+=("$candidate")
      printf -v "$target_name" '%d' "$candidate"
      NEXT_PORT=$((candidate + 1))
      return
    fi
    candidate=$((candidate + 1))
  done

  fail "no free ports remain in $PORT_MIN-$PORT_MAX"
}

rollback_staged_session() {
  local staging_dir="${CREATE_STAGING_DIR:-}"
  local resolved_staging_dir

  [[ -n "$staging_dir" ]] || return 0
  if [[ -L "$staging_dir" || ! -d "$staging_dir" ]]; then
    printf 'error: refusing to roll back an invalid session staging path\n' >&2
    return 1
  fi

  resolved_staging_dir="$(realpath -e -- "$staging_dir")"
  if [[ "$(dirname -- "$resolved_staging_dir")" != "$SESSIONS_DIR" ]]; then
    printf 'error: refusing to roll back staging outside .sessions\n' >&2
    return 1
  fi
  if [[ "$(basename -- "$resolved_staging_dir")" != ".create-$CREATE_RUN_ID."* ]]; then
    printf 'error: refusing to roll back an unexpected staging directory\n' >&2
    return 1
  fi

  find "$resolved_staging_dir" -xdev -depth -delete
  CREATE_STAGING_DIR=""
  CREATE_RUN_ID=""
}

create_session() {
  local requested_run_id="${1:-}"
  local run_id
  local session_dir
  local tombstone_dir
  local staging_dir
  local manifest
  local secrets
  local browser_session
  local project_name
  local prowlarr_port
  local radarr_port
  local sonarr_port
  local qbittorrent_port
  local jellyfin_port
  local seerr_port
  local homarr_port
  local timezone

  require_command flock
  require_command openssl
  require_command awk
  require_command find
  require_command mktemp

  if [[ -n "$requested_run_id" ]]; then
    run_id="$requested_run_id"
  else
    run_id="run-$(date -u +%Y%m%d-%H%M%S)-$$"
  fi
  validate_run_id "$run_id"

  open_run_lock "$run_id"
  open_sessions_lock

  session_dir="$(session_dir_for "$run_id")"
  tombstone_dir="$(tombstone_dir_for "$run_id")"
  [[ ! -e "$session_dir" && ! -L "$session_dir" ]] || fail "session already exists: $run_id"
  [[ ! -e "$tombstone_dir" && ! -L "$tombstone_dir" ]] \
    || fail "destroy tombstone exists; retry destroy before creating this RUN_ID"

  collect_used_ports_locked
  collect_listening_ports
  NEXT_PORT=$PORT_MIN
  allocate_port prowlarr_port
  allocate_port radarr_port
  allocate_port sonarr_port
  allocate_port qbittorrent_port
  allocate_port jellyfin_port
  allocate_port seerr_port
  allocate_port homarr_port

  project_name="autostack-$run_id"
  browser_session="auto-stack-$run_id"
  timezone="$(safe_timezone "${TZ:-}")"
  staging_dir="$(mktemp -d "$SESSIONS_DIR/.create-$run_id.XXXXXX")"
  CREATE_STAGING_DIR="$staging_dir"
  CREATE_RUN_ID="$run_id"
  trap rollback_staged_session EXIT
  trap 'rollback_staged_session; exit 129' HUP
  trap 'rollback_staged_session; exit 130' INT
  trap 'rollback_staged_session; exit 143' TERM
  [[ -d "$staging_dir" && ! -L "$staging_dir" ]] || fail "could not create session staging directory"
  [[ "$(dirname -- "$(realpath -e -- "$staging_dir")")" == "$SESSIONS_DIR" ]] || fail "session staging escaped .sessions"

  manifest="$staging_dir/manifest.env"
  secrets="$staging_dir/secrets.env"

  mkdir -p -- \
    "$staging_dir/config/prowlarr" \
    "$staging_dir/config/radarr" \
    "$staging_dir/config/sonarr" \
    "$staging_dir/config/qbittorrent" \
    "$staging_dir/config/jellyfin" \
    "$staging_dir/config/seerr" \
    "$staging_dir/config/homarr" \
    "$staging_dir/data/torrents" \
    "$staging_dir/data/media/tv" \
    "$staging_dir/data/media/movies" \
    "$staging_dir/artifacts"

  # Seerr starts directly as UID 1000. Under rootless Docker that container UID
  # maps to a subordinate host UID, so a host-owned 0700 bind directory is not
  # writable even when the host user is also UID 1000. The parent session stays
  # private (0700); only this nested mount point needs write permission.
  chmod 0777 -- \
    "$staging_dir/config/seerr" \
    "$staging_dir/data" \
    "$staging_dir/data/torrents" \
    "$staging_dir/data/media" \
    "$staging_dir/data/media/tv" \
    "$staging_dir/data/media/movies"

  {
    printf 'RUN_ID=%s\n' "$run_id"
    printf 'COMPOSE_PROJECT_NAME=%s\n' "$project_name"
    printf 'SESSION_ROOT=%s\n' "$session_dir"
    printf 'AGENT_BROWSER_SESSION=%s\n' "$browser_session"
    printf 'SESSION_PASSWORD_SCHEME=%s\n' "$CURRENT_SESSION_PASSWORD_SCHEME"
    printf 'PUID=%s\n' "$(id -u)"
    printf 'PGID=%s\n' "$(id -g)"
    printf 'TZ=%s\n' "$timezone"
    printf 'PROWLARR_PORT=%s\n' "$prowlarr_port"
    printf 'RADARR_PORT=%s\n' "$radarr_port"
    printf 'SONARR_PORT=%s\n' "$sonarr_port"
    printf 'QBITTORRENT_PORT=%s\n' "$qbittorrent_port"
    printf 'JELLYFIN_PORT=%s\n' "$jellyfin_port"
    printf 'SEERR_PORT=%s\n' "$seerr_port"
    printf 'HOMARR_PORT=%s\n' "$homarr_port"
  } > "$manifest"

  {
    printf 'HOMARR_ENCRYPTION_KEY='
    openssl rand -hex 32
    printf 'SONARR_API_KEY='
    openssl rand -hex 16
    printf 'RADARR_API_KEY='
    openssl rand -hex 16
    printf 'PROWLARR_API_KEY='
    openssl rand -hex 16
    printf 'SEERR_API_KEY='
    openssl rand -hex 16
  } > "$secrets"
  chmod 600 -- "$manifest" "$secrets"
  validate_private_control_file "$manifest" "$staging_dir" "staged manifest"
  validate_private_control_file "$secrets" "$staging_dir" "staged secrets file"

  mv -T -- "$staging_dir" "$session_dir"
  CREATE_STAGING_DIR=""
  CREATE_RUN_ID=""
  trap - EXIT HUP INT TERM

  flock -u 9
  exec 9>&-
  close_run_lock

  printf 'Created session %s\n' "$run_id"
  printf 'Browser session: %s\n' "$browser_session"
  printf 'Start it with: scripts/session.sh up %s\n' "$run_id"
}

print_urls() {
  printf 'PROWLARR_URL=http://127.0.0.1:%s\n' "$PROWLARR_PORT"
  printf 'RADARR_URL=http://127.0.0.1:%s\n' "$RADARR_PORT"
  printf 'SONARR_URL=http://127.0.0.1:%s\n' "$SONARR_PORT"
  printf 'QBITTORRENT_URL=http://127.0.0.1:%s\n' "$QBITTORRENT_PORT"
  printf 'JELLYFIN_URL=http://127.0.0.1:%s\n' "$JELLYFIN_PORT"
  printf 'SEERR_URL=http://127.0.0.1:%s\n' "$SEERR_PORT"
  printf 'HOMARR_URL=http://127.0.0.1:%s\n' "$HOMARR_PORT"
}

print_env() {
  printf 'export RUN_ID=%q\n' "$RUN_ID"
  printf 'export COMPOSE_PROJECT_NAME=%q\n' "$COMPOSE_PROJECT_NAME"
  printf 'export SESSION_ROOT=%q\n' "$SESSION_ROOT"
  printf 'export AGENT_BROWSER_SESSION=%q\n' "$AGENT_BROWSER_SESSION"
  printf 'export PROWLARR_PORT=%q\n' "$PROWLARR_PORT"
  printf 'export RADARR_PORT=%q\n' "$RADARR_PORT"
  printf 'export SONARR_PORT=%q\n' "$SONARR_PORT"
  printf 'export QBITTORRENT_PORT=%q\n' "$QBITTORRENT_PORT"
  printf 'export JELLYFIN_PORT=%q\n' "$JELLYFIN_PORT"
  printf 'export SEERR_PORT=%q\n' "$SEERR_PORT"
  printf 'export HOMARR_PORT=%q\n' "$HOMARR_PORT"
}

doctor() {
  local run_id="${1:-}"

  require_command docker
  require_command awk
  require_command flock
  require_command openssl
  require_command realpath
  docker compose version >/dev/null

  if [[ -n "$run_id" ]]; then
    load_session "$run_id"
    compose config --quiet
    printf 'Session %s is valid.\n' "$RUN_ID"
  else
    printf 'Session prerequisites are available.\n'
  fi
}

validate_cleanup_root() {
  local cleanup_root="$1"
  local resolved_root

  [[ -d "$cleanup_root" && ! -L "$cleanup_root" ]] || fail "cleanup root is not a real directory"
  resolved_root="$(realpath -e -- "$cleanup_root")"
  [[ "$resolved_root" == "$cleanup_root" ]] || fail "cleanup root escaped its session"
  [[ "$resolved_root" == "$SESSION_DIR/"* ]] || fail "cleanup root escaped its session"
}

validate_destroy_image_manifest() {
  local manifest="$1"

  validate_private_control_file "$manifest" "$SESSION_DIR" "destroy image manifest"
}

load_destroy_image_manifest() {
  local service
  local image_id
  local line_count=0

  validate_destroy_image_manifest "$DESTROY_IMAGE_MANIFEST"
  DESTROY_IMAGE_IDS=()
  while IFS='=' read -r service image_id; do
    case "$service" in
      prowlarr|radarr|sonarr|qbittorrent|jellyfin|seerr|homarr)
        ;;
      *)
        fail "destroy image manifest contains an unexpected service"
        ;;
    esac
    [[ -z "${DESTROY_IMAGE_IDS[$service]+present}" ]] || fail "destroy image manifest contains a duplicate service"
    if [[ "$image_id" != "none" && ! "$image_id" =~ ^sha256:[0-9a-f]{64}$ ]]; then
      fail "destroy image manifest contains an invalid image ID"
    fi
    DESTROY_IMAGE_IDS["$service"]="$image_id"
    line_count=$((line_count + 1))
  done < "$DESTROY_IMAGE_MANIFEST"

  [[ "$line_count" == "${#DESTROY_SERVICES[@]}" ]] || fail "destroy image manifest is incomplete"
  for service in "${DESTROY_SERVICES[@]}"; do
    [[ -n "${DESTROY_IMAGE_IDS[$service]+present}" ]] || fail "destroy image manifest is incomplete"
  done
}

capture_destroy_image_manifest() {
  local pending_manifest="$SESSION_DIR/.destroy-images.pending"
  local service
  local container_id
  local image_id

  if [[ -e "$pending_manifest" || -L "$pending_manifest" ]]; then
    validate_private_control_file "$pending_manifest" "$SESSION_DIR" "pending destroy image manifest"
    find "$pending_manifest" -maxdepth 0 -type f -delete
  fi

  DESTROY_IMAGE_IDS=()
  for service in "${DESTROY_SERVICES[@]}"; do
    image_id="none"
    container_id="$(compose ps -a -q "$service" 2>/dev/null | tr -d '\r\n')"
    if [[ -n "$container_id" ]]; then
      [[ "$container_id" =~ ^[0-9a-f]{12,64}$ ]] || fail "could not identify the existing $service container"
      image_id="$(docker inspect --type container --format '{{.Image}}' "$container_id" 2>/dev/null | tr -d '\r\n')"
      [[ "$image_id" =~ ^sha256:[0-9a-f]{64}$ ]] || fail "could not capture the existing $service image"
    fi
    DESTROY_IMAGE_IDS["$service"]="$image_id"
  done

  trap '' HUP INT TERM
  : > "$pending_manifest"
  chmod 0600 -- "$pending_manifest"
  validate_private_control_file "$pending_manifest" "$SESSION_DIR" "pending destroy image manifest"
  for service in "${DESTROY_SERVICES[@]}"; do
    printf '%s=%s\n' "$service" "${DESTROY_IMAGE_IDS[$service]}" >> "$pending_manifest"
  done
  validate_private_control_file "$pending_manifest" "$SESSION_DIR" "pending destroy image manifest"
  mv -T -- "$pending_manifest" "$DESTROY_IMAGE_MANIFEST"
  trap - HUP INT TERM
  validate_destroy_image_manifest "$DESTROY_IMAGE_MANIFEST"
}

prepare_destroy_images() {
  DESTROY_IMAGE_MANIFEST="$SESSION_DIR/destroy-images.env"
  if [[ -e "$DESTROY_IMAGE_MANIFEST" || -L "$DESTROY_IMAGE_MANIFEST" ]]; then
    load_destroy_image_manifest
    return
  fi
  capture_destroy_image_manifest
}

normalize_cleaned_root() {
  local cleanup_root="$1"
  local label="$2"

  validate_cleanup_root "$cleanup_root"
  [[ "$(stat -c '%u' -- "$cleanup_root")" == "$(id -u)" ]] || fail "$label root has the wrong owner"
  [[ "$(stat -c '%g' -- "$cleanup_root")" == "$(id -g)" ]] || fail "$label root has the wrong group"
  chmod 0700 -- "$cleanup_root"
  [[ "$(stat -c '%a' -- "$cleanup_root")" == "700" ]] || fail "$label root must use mode 0700"
}

cleanup_tree_with_image() {
  local cleanup_root="$1"
  local image_id="$2"
  local label="$3"
  local subordinate_entry
  local remaining_entry

  validate_cleanup_root "$cleanup_root"
  if [[ "$(stat -c '%u' -- "$cleanup_root")" != "$(id -u)" ]]; then
    subordinate_entry="$cleanup_root"
  else
    subordinate_entry="$(
      find "$cleanup_root" -xdev -mindepth 1 \
        ! -uid "$(id -u)" \
        -print -quit 2>/dev/null || true
    )"
  fi

  if ! find "$cleanup_root" -xdev -depth -mindepth 1 -delete 2>/dev/null; then
    [[ -n "$subordinate_entry" ]] || fail "$label host cleanup failed without subordinate-owned content"
    [[ "$image_id" =~ ^sha256:[0-9a-f]{64}$ ]] || fail "$label has no captured service image for cleanup"
    validate_cleanup_root "$cleanup_root"
    docker image inspect "$image_id" >/dev/null 2>&1 || fail "$label captured service image is unavailable"
    docker run \
      --rm \
      --pull never \
      --network none \
      --read-only \
      --user 0:0 \
      --entrypoint /bin/sh \
      --volume "$cleanup_root:/target" \
      "$image_id" \
      -c 'find /target -xdev -mindepth 1 -depth -delete && chown 0:0 /target && chmod 0700 /target'
  fi

  remaining_entry="$(find "$cleanup_root" -xdev -mindepth 1 -print -quit)"
  [[ -z "$remaining_entry" ]] || fail "$label cleanup left unexpected content"
  normalize_cleaned_root "$cleanup_root" "$label"
}

cleanup_tree_on_host() {
  local cleanup_root="$1"
  local label="$2"
  local remaining_entry

  validate_cleanup_root "$cleanup_root"
  find "$cleanup_root" -xdev -depth -mindepth 1 -delete 2>/dev/null || fail "$label requires host-owned content"
  remaining_entry="$(find "$cleanup_root" -xdev -mindepth 1 -print -quit)"
  [[ -z "$remaining_entry" ]] || fail "$label cleanup left unexpected content"
  normalize_cleaned_root "$cleanup_root" "$label"
}

validate_config_layout() {
  local config_root="$SESSION_DIR/config"
  local entry

  validate_cleanup_root "$config_root"
  while IFS= read -r -d '' entry; do
    case "$(basename -- "$entry")" in
      prowlarr|radarr|sonarr|qbittorrent|jellyfin|seerr|homarr)
        validate_cleanup_root "$entry"
        ;;
      *)
        fail "session config contains an unexpected cleanup root"
        ;;
    esac
  done < <(find "$config_root" -xdev -mindepth 1 -maxdepth 1 -print0)

  for entry in "${DESTROY_SERVICES[@]}"; do
    validate_cleanup_root "$config_root/$entry"
  done
}

validate_tombstone_dir() {
  local tombstone_dir="$1"
  local resolved_tombstone

  [[ -d "$tombstone_dir" && ! -L "$tombstone_dir" ]] || fail "destroy tombstone must be a real directory"
  resolved_tombstone="$(realpath -e -- "$tombstone_dir")"
  [[ "$resolved_tombstone" == "$tombstone_dir" ]] || fail "destroy tombstone escaped .sessions"
  [[ "$(dirname -- "$resolved_tombstone")" == "$SESSIONS_DIR" ]] || fail "destroy tombstone escaped .sessions"
  [[ "$(stat -c '%u' -- "$resolved_tombstone")" == "$(id -u)" ]] || fail "destroy tombstone has the wrong owner"
  [[ "$(stat -c '%g' -- "$resolved_tombstone")" == "$(id -g)" ]] || fail "destroy tombstone has the wrong group"
  [[ "$(stat -c '%a' -- "$resolved_tombstone")" == "700" ]] || fail "destroy tombstone must use mode 0700"
}

validate_tombstone_marker() {
  local marker_file="$1"
  local tombstone_dir="$2"
  local run_id="$3"
  local marker_value

  validate_private_control_file "$marker_file" "$tombstone_dir" "destroy tombstone marker"
  IFS= read -r marker_value < "$marker_file" || fail "destroy tombstone marker is incomplete"
  [[ "$marker_value" == "RUN_ID=$run_id" ]] || fail "destroy tombstone marker does not match RUN_ID"
  [[ "$(wc -l < "$marker_file")" == "1" ]] || fail "destroy tombstone marker is invalid"
}

prepare_destroy_tombstone_marker() {
  local run_id="$1"
  local marker_file="$SESSION_DIR/destroy-tombstone.env"
  local marker_temp

  cleanup_validated_tombstone_transients "$SESSION_DIR"
  if [[ -e "$marker_file" || -L "$marker_file" ]]; then
    validate_tombstone_marker "$marker_file" "$SESSION_DIR" "$run_id"
    return
  fi

  marker_temp="$(mktemp "$SESSION_DIR/.destroy-tombstone.XXXXXX")"
  chmod 0600 -- "$marker_temp"
  printf 'RUN_ID=%s\n' "$run_id" > "$marker_temp"
  validate_tombstone_marker "$marker_temp" "$SESSION_DIR" "$run_id"
  sync -f -- "$marker_temp"
  mv -T -- "$marker_temp" "$marker_file"
  validate_tombstone_marker "$marker_file" "$SESSION_DIR" "$run_id"
  sync -f -- "$SESSION_DIR"
}

validate_marked_removal_dir() {
  local directory="$1"
  local expected_parent="$2"
  local label="$3"
  local resolved_directory

  [[ -d "$directory" && ! -L "$directory" ]] || fail "$label must be a real directory"
  resolved_directory="$(realpath -e -- "$directory")"
  [[ "$resolved_directory" == "$directory" ]] || fail "$label escaped its session"
  [[ "$(dirname -- "$resolved_directory")" == "$expected_parent" ]] || fail "$label escaped its session"
  [[ "$(stat -c '%u' -- "$resolved_directory")" == "$(id -u)" ]] || fail "$label has the wrong owner"
  [[ "$(stat -c '%g' -- "$resolved_directory")" == "$(id -g)" ]] || fail "$label has the wrong group"
  [[ "$(stat -c '%a' -- "$resolved_directory")" == "700" ]] || fail "$label must use mode 0700"
}

remove_marked_empty_content_roots() {
  local run_id="$1"
  local marker_file="$SESSION_DIR/destroy-tombstone.env"
  local config_root="$SESSION_DIR/config"
  local service
  local service_dir
  local root_dir
  local entry
  local remaining_entry
  local unexpected_entry

  [[ "$(realpath -e -- "/proc/$$/fd/9")" == "$SESSIONS_LOCK" ]] \
    || fail "marked removal requires the global session lock"
  validate_tombstone_marker "$marker_file" "$SESSION_DIR" "$run_id"
  cleanup_validated_secret_transients "$SESSION_DIR"
  cleanup_validated_homarr_key_transients "$SESSION_DIR"
  cleanup_validated_connections_transients "$SESSION_DIR"
  cleanup_validated_tombstone_transients "$SESSION_DIR"

  if [[ -e "$SESSION_DIR/homarr-api-key.env" || -L "$SESSION_DIR/homarr-api-key.env" ]]; then
    validate_homarr_api_key_file "$SESSION_DIR/homarr-api-key.env" "$SESSION_DIR" "Homarr API key file"
  fi
  if [[ -e "$SESSION_DIR/connections.env" || -L "$SESSION_DIR/connections.env" ]]; then
    validate_connections_control_file "$SESSION_DIR/connections.env" "$SESSION_DIR" "connections file"
  fi
  if [[ -e "$SESSION_DIR/credentials.env" || -L "$SESSION_DIR/credentials.env" ]]; then
    validate_legacy_credentials_control_file \
      "$SESSION_DIR/credentials.env" \
      "$SESSION_DIR" \
      "legacy credentials file"
  fi

  unexpected_entry="$(
    find "$SESSION_DIR" -xdev -mindepth 1 -maxdepth 1 \
      ! -path "$MANIFEST_FILE" \
      ! -path "$SECRETS_FILE" \
      ! -path "$SESSION_DIR/homarr-api-key.env" \
      ! -path "$SESSION_DIR/connections.env" \
      ! -path "$SESSION_DIR/credentials.env" \
      ! -path "$DESTROY_IMAGE_MANIFEST" \
      ! -path "$marker_file" \
      ! -path "$config_root" \
      ! -path "$SESSION_DIR/data" \
      ! -path "$SESSION_DIR/artifacts" \
      -print -quit
  )"
  [[ -z "$unexpected_entry" ]] || fail "marked session contains unexpected content"

  if [[ -e "$config_root" || -L "$config_root" ]]; then
    validate_marked_removal_dir "$config_root" "$SESSION_DIR" "config root"
    while IFS= read -r -d '' entry; do
      case "$(basename -- "$entry")" in
        prowlarr|radarr|sonarr|qbittorrent|jellyfin|seerr|homarr)
          ;;
        *)
          fail "config root contains an unexpected entry"
          ;;
      esac
    done < <(find "$config_root" -xdev -mindepth 1 -maxdepth 1 -print0)

    for service in "${DESTROY_SERVICES[@]}"; do
      service_dir="$config_root/$service"
      if [[ ! -e "$service_dir" && ! -L "$service_dir" ]]; then
        continue
      fi
      validate_marked_removal_dir "$service_dir" "$config_root" "$service config root"
      remaining_entry="$(find "$service_dir" -xdev -mindepth 1 -print -quit)"
      [[ -z "$remaining_entry" ]] || fail "$service config root is not empty"
      rmdir -- "$service_dir"
    done
    remaining_entry="$(find "$config_root" -xdev -mindepth 1 -print -quit)"
    [[ -z "$remaining_entry" ]] || fail "config root is not empty"
    rmdir -- "$config_root"
  fi

  for root_dir in "$SESSION_DIR/data" "$SESSION_DIR/artifacts"; do
    if [[ ! -e "$root_dir" && ! -L "$root_dir" ]]; then
      continue
    fi
    validate_marked_removal_dir "$root_dir" "$SESSION_DIR" "session content root"
    remaining_entry="$(find "$root_dir" -xdev -mindepth 1 -print -quit)"
    [[ -z "$remaining_entry" ]] || fail "session content root is not empty"
    rmdir -- "$root_dir"
  done
}

finalize_marked_normal_session() {
  local run_id="$1"

  load_session "$run_id"
  cleanup_validated_secret_transients "$SESSION_DIR"
  cleanup_validated_homarr_key_transients "$SESSION_DIR"
  cleanup_validated_connections_transients "$SESSION_DIR"
  cleanup_validated_tombstone_transients "$SESSION_DIR"
  DESTROY_IMAGE_MANIFEST="$SESSION_DIR/destroy-images.env"
  load_destroy_image_manifest
  validate_tombstone_marker "$SESSION_DIR/destroy-tombstone.env" "$SESSION_DIR" "$run_id"
  remove_marked_empty_content_roots "$run_id"
  publish_destroy_tombstone "$run_id"
}

finish_destroy_tombstone() {
  local run_id="$1"
  local tombstone_dir
  local marker_file
  local control_file
  local remaining_entry
  local unexpected_entry

  tombstone_dir="$(tombstone_dir_for "$run_id")"
  marker_file="$tombstone_dir/destroy-tombstone.env"
  [[ ! -e "$(session_dir_for "$run_id")" && ! -L "$(session_dir_for "$run_id")" ]] \
    || fail "normal session still exists beside destroy tombstone"
  validate_tombstone_dir "$tombstone_dir"
  cleanup_validated_secret_transients "$tombstone_dir"
  cleanup_validated_homarr_key_transients "$tombstone_dir"
  cleanup_validated_connections_transients "$tombstone_dir"
  cleanup_validated_tombstone_transients "$tombstone_dir"

  if [[ -e "$tombstone_dir/homarr-api-key.env" || -L "$tombstone_dir/homarr-api-key.env" ]]; then
    validate_homarr_api_key_file \
      "$tombstone_dir/homarr-api-key.env" \
      "$tombstone_dir" \
      "destroy tombstone Homarr API key file"
  fi
  if [[ -e "$tombstone_dir/connections.env" || -L "$tombstone_dir/connections.env" ]]; then
    validate_connections_control_file \
      "$tombstone_dir/connections.env" \
      "$tombstone_dir" \
      "destroy tombstone connections file"
  fi
  if [[ -e "$tombstone_dir/credentials.env" || -L "$tombstone_dir/credentials.env" ]]; then
    validate_legacy_credentials_control_file \
      "$tombstone_dir/credentials.env" \
      "$tombstone_dir" \
      "destroy tombstone legacy credentials file"
  fi

  unexpected_entry="$(
    find "$tombstone_dir" -xdev -mindepth 1 -maxdepth 1 \
      ! -path "$tombstone_dir/manifest.env" \
      ! -path "$tombstone_dir/secrets.env" \
      ! -path "$tombstone_dir/homarr-api-key.env" \
      ! -path "$tombstone_dir/connections.env" \
      ! -path "$tombstone_dir/credentials.env" \
      ! -path "$tombstone_dir/destroy-images.env" \
      ! -path "$marker_file" \
      -print -quit
  )"
  [[ -z "$unexpected_entry" ]] || fail "destroy tombstone contains unexpected content"

  if [[ ! -e "$marker_file" && ! -L "$marker_file" ]]; then
    remaining_entry="$(find "$tombstone_dir" -xdev -mindepth 1 -print -quit)"
    [[ -z "$remaining_entry" ]] || fail "destroy tombstone marker is missing"
    rmdir -- "$tombstone_dir"
    return
  fi

  validate_tombstone_marker "$marker_file" "$tombstone_dir" "$run_id"
  for control_file in \
    "$tombstone_dir/credentials.env" \
    "$tombstone_dir/manifest.env" \
    "$tombstone_dir/secrets.env" \
    "$tombstone_dir/homarr-api-key.env" \
    "$tombstone_dir/connections.env" \
    "$tombstone_dir/destroy-images.env"; do
    if [[ -e "$control_file" || -L "$control_file" ]]; then
      validate_private_control_file "$control_file" "$tombstone_dir" "destroy tombstone control file"
      find "$control_file" -maxdepth 0 -type f -delete
    fi
  done
  validate_tombstone_marker "$marker_file" "$tombstone_dir" "$run_id"
  find "$marker_file" -maxdepth 0 -type f -delete
  rmdir -- "$tombstone_dir"
}

publish_destroy_tombstone() {
  local run_id="$1"
  local tombstone_dir
  local marker_file
  local remaining_entry

  tombstone_dir="$(tombstone_dir_for "$run_id")"
  [[ ! -e "$tombstone_dir" && ! -L "$tombstone_dir" ]] || fail "destroy tombstone already exists"
  load_session "$run_id"
  cleanup_validated_secret_transients "$SESSION_DIR"
  cleanup_validated_homarr_key_transients "$SESSION_DIR"
  cleanup_validated_connections_transients "$SESSION_DIR"
  cleanup_validated_tombstone_transients "$SESSION_DIR"
  DESTROY_IMAGE_MANIFEST="$SESSION_DIR/destroy-images.env"
  load_destroy_image_manifest
  marker_file="$SESSION_DIR/destroy-tombstone.env"
  validate_tombstone_marker "$marker_file" "$SESSION_DIR" "$run_id"

  if [[ -e "$SESSION_DIR/homarr-api-key.env" || -L "$SESSION_DIR/homarr-api-key.env" ]]; then
    validate_homarr_api_key_file "$SESSION_DIR/homarr-api-key.env" "$SESSION_DIR" "Homarr API key file"
  fi

  remaining_entry="$(
    find "$SESSION_DIR" -xdev -mindepth 1 -maxdepth 1 \
      ! -path "$MANIFEST_FILE" \
      ! -path "$SECRETS_FILE" \
      ! -path "$SESSION_DIR/homarr-api-key.env" \
      ! -path "$SESSION_DIR/connections.env" \
      ! -path "$SESSION_DIR/credentials.env" \
      ! -path "$DESTROY_IMAGE_MANIFEST" \
      ! -path "$marker_file" \
      -print -quit
  )"
  [[ -z "$remaining_entry" ]] || fail "control-only session contains unexpected content"

  mv -T -- "$SESSION_DIR" "$tombstone_dir"
  finish_destroy_tombstone "$run_id"
}

release_destroy_locks() {
  close_run_lock
  flock -u 9
  exec 9>&-
}

destroy_session() {
  local run_id="$1"
  local confirm_flag="${2:-}"
  local confirmed_run_id="${3:-}"
  local service
  local data_image="none"
  local normal_session_dir
  local tombstone_dir
  local remaining_entry
  local tombstone_transient_retry=0

  if [[ "$confirm_flag" != "--confirm" || "$confirmed_run_id" != "$run_id" ]]; then
    fail "destroy requires: destroy RUN_ID --confirm RUN_ID"
  fi

  require_command find
  require_command mktemp
  require_command sync
  open_run_lock "$run_id"
  normal_session_dir="$(session_dir_for "$run_id")"
  tombstone_dir="$(tombstone_dir_for "$run_id")"

  if [[ -e "$tombstone_dir" || -L "$tombstone_dir" ]]; then
    [[ ! -e "$normal_session_dir" && ! -L "$normal_session_dir" ]] \
      || fail "normal session and destroy tombstone both exist"
    open_sessions_lock
    trap '' HUP INT TERM
    finish_destroy_tombstone "$run_id"
    trap - HUP INT TERM
    release_destroy_locks
    printf 'Destroyed session %s\n' "$run_id"
    return
  fi

  if [[ -e "$normal_session_dir/destroy-tombstone.env" \
    || -L "$normal_session_dir/destroy-tombstone.env" ]]; then
    [[ -d "$normal_session_dir" && ! -L "$normal_session_dir" ]] \
      || fail "invalid control-only session"
    open_sessions_lock
    trap '' HUP INT TERM
    finalize_marked_normal_session "$run_id"
    trap - HUP INT TERM
    release_destroy_locks
    printf 'Destroyed session %s\n' "$run_id"
    return
  fi

  load_session "$run_id"
  cleanup_validated_secret_transients "$SESSION_DIR"
  cleanup_validated_homarr_key_transients "$SESSION_DIR"
  cleanup_validated_connections_transients "$SESSION_DIR"
  cleanup_validated_tombstone_transients "$SESSION_DIR"
  tombstone_transient_retry="$TOMBSTONE_TRANSIENTS_REMOVED"
  if (( tombstone_transient_retry > 0 )); then
    if [[ ! -e "$SESSION_DIR/config" && ! -L "$SESSION_DIR/config" \
      && ! -e "$SESSION_DIR/data" && ! -L "$SESSION_DIR/data" \
      && ! -e "$SESSION_DIR/artifacts" && ! -L "$SESSION_DIR/artifacts" ]]; then
      open_sessions_lock
      load_session "$run_id"
      cleanup_validated_secret_transients "$SESSION_DIR"
      cleanup_validated_homarr_key_transients "$SESSION_DIR"
      cleanup_validated_connections_transients "$SESSION_DIR"
      cleanup_validated_tombstone_transients "$SESSION_DIR"
      DESTROY_IMAGE_MANIFEST="$SESSION_DIR/destroy-images.env"
      load_destroy_image_manifest
      remaining_entry="$(
        find "$SESSION_DIR" -xdev -mindepth 1 -maxdepth 1 \
          ! -path "$MANIFEST_FILE" \
          ! -path "$SECRETS_FILE" \
          ! -path "$SESSION_DIR/homarr-api-key.env" \
          ! -path "$SESSION_DIR/connections.env" \
          ! -path "$SESSION_DIR/credentials.env" \
          ! -path "$DESTROY_IMAGE_MANIFEST" \
          -print -quit
      )"
      [[ -z "$remaining_entry" ]] || fail "control-only session contains unexpected content"
      trap '' HUP INT TERM
      prepare_destroy_tombstone_marker "$run_id"
      finalize_marked_normal_session "$run_id"
      trap - HUP INT TERM
      release_destroy_locks
      printf 'Destroyed session %s\n' "$run_id"
      return
    fi
    if [[ ! -e "$SESSION_DIR/config" || -L "$SESSION_DIR/config" \
      || ! -e "$SESSION_DIR/data" || -L "$SESSION_DIR/data" \
      || ! -e "$SESSION_DIR/artifacts" || -L "$SESSION_DIR/artifacts" ]]; then
      fail "destroy tombstone transient accompanies a partial content layout"
    fi
  fi
  validate_config_layout
  validate_cleanup_root "$SESSION_DIR/data"
  validate_cleanup_root "$SESSION_DIR/artifacts"
  prepare_destroy_images

  printf 'Destroying only session %s (%s)\n' "$RUN_ID" "$COMPOSE_PROJECT_NAME"
  compose down --remove-orphans

  for service in "${DESTROY_SERVICES[@]}"; do
    cleanup_tree_with_image \
      "$SESSION_DIR/config/$service" \
      "${DESTROY_IMAGE_IDS[$service]}" \
      "$service config"
  done

  for service in radarr sonarr qbittorrent jellyfin; do
    if [[ "${DESTROY_IMAGE_IDS[$service]}" != "none" ]]; then
      data_image="${DESTROY_IMAGE_IDS[$service]}"
      break
    fi
  done
  cleanup_tree_with_image "$SESSION_DIR/data" "$data_image" "shared data"
  cleanup_tree_on_host "$SESSION_DIR/artifacts" "session artifacts"
  validate_config_layout

  remaining_entry="$(
    find "$SESSION_DIR" -xdev -mindepth 1 -maxdepth 1 \
      ! -path "$MANIFEST_FILE" \
      ! -path "$SECRETS_FILE" \
      ! -path "$SESSION_DIR/homarr-api-key.env" \
      ! -path "$SESSION_DIR/connections.env" \
      ! -path "$SESSION_DIR/credentials.env" \
      ! -path "$DESTROY_IMAGE_MANIFEST" \
      ! -path "$SESSION_DIR/config" \
      ! -path "$SESSION_DIR/data" \
      ! -path "$SESSION_DIR/artifacts" \
      -print -quit
  )"
  [[ -z "$remaining_entry" ]] || fail "session cleanup left unexpected content"

  # The shared lock covers the atomic removal of this run's port reservation;
  # per-run cleanup above remains concurrent with other runs.
  open_sessions_lock
  [[ ! -e "$tombstone_dir" && ! -L "$tombstone_dir" ]] || fail "destroy tombstone appeared during cleanup"
  load_session "$run_id"
  load_destroy_image_manifest

  # Publish and fsync the validated retry marker before removing the first
  # bind-root directory. Each subsequent exact rmdir is safely replayable.
  trap '' HUP INT TERM
  prepare_destroy_tombstone_marker "$run_id"
  finalize_marked_normal_session "$run_id"
  trap - HUP INT TERM
  release_destroy_locks
  printf 'Destroyed session %s\n' "$run_id"
}

main() {
  local command="${1:-}"
  local run_id="${2:-}"

  case "$command" in
    create)
      [[ "$#" -le 2 ]] || fail "create accepts at most one RUN_ID"
      create_session "$run_id"
      ;;
    up)
      [[ "$#" -eq 2 ]] || fail "up requires one RUN_ID"
      open_run_lock "$run_id"
      load_session "$run_id"
      require_session_password_scheme
      compose up -d
      close_run_lock
      ;;
    keys)
      [[ "$#" -eq 2 ]] || fail "keys requires one RUN_ID"
      require_command bun
      open_run_lock "$run_id"
      load_session "$run_id"
      require_session_password_scheme
      cleanup_validated_connections_transients "$SESSION_DIR"
      sync_arr_api_keys
      exec bun "$SCRIPT_DIR/lib/session-context.ts" connections "$run_id"
      ;;
    bootstrap)
      [[ "$#" -eq 2 ]] || fail "bootstrap requires one RUN_ID"
      require_command bun
      open_run_lock "$run_id"
      load_session "$run_id"
      require_session_password_scheme
      cleanup_validated_connections_transients "$SESSION_DIR"
      exec bun "$SCRIPT_DIR/bootstrap-core.ts" "$run_id"
      ;;
    verify)
      [[ "$#" -eq 2 ]] || fail "verify requires one RUN_ID"
      require_command bun
      open_run_lock "$run_id"
      load_session "$run_id"
      require_session_password_scheme
      exec bun "$SCRIPT_DIR/verify-core.ts" "$run_id"
      ;;
    browser-password)
      [[ "$#" -ge 3 && "$#" -le 6 ]] \
        || fail "browser-password requires one RUN_ID and one to four @eN refs"
      require_command bun
      open_run_lock "$run_id"
      load_session "$run_id"
      require_session_password_scheme
      exec bun "$SCRIPT_DIR/fill-browser-password.ts" "$run_id" "${@:3}"
      ;;
    browser-key)
      [[ "$#" -eq 5 ]] \
        || fail "browser-key requires capture|fill RUN_ID SERVICE @eN"
      require_command bun
      run_id="$3"
      open_run_lock "$run_id"
      load_session "$run_id"
      require_session_password_scheme
      cleanup_validated_homarr_key_transients "$SESSION_DIR"
      cleanup_validated_connections_transients "$SESSION_DIR"
      exec bun "$SCRIPT_DIR/browser-api-key.ts" "$2" "$run_id" "$4" "$5"
      ;;
    homarr-key)
      [[ "$#" -eq 2 ]] || fail "homarr-key requires one RUN_ID"
      require_command bun
      open_run_lock "$run_id"
      load_session "$run_id"
      require_session_password_scheme
      cleanup_validated_homarr_key_transients "$SESSION_DIR"
      cleanup_validated_connections_transients "$SESSION_DIR"
      exec bun "$SCRIPT_DIR/store-homarr-key.ts" "$run_id"
      ;;
    homarr-finalize)
      [[ "$#" -eq 2 ]] || fail "homarr-finalize requires one RUN_ID"
      require_command bun
      open_run_lock "$run_id"
      load_session "$run_id"
      require_session_password_scheme
      exec bun "$SCRIPT_DIR/homarr-finalize.ts" "$run_id"
      ;;
    mcp-config)
      [[ "$#" -eq 2 ]] || fail "mcp-config requires one RUN_ID"
      require_command bun
      open_run_lock "$run_id"
      load_session "$run_id"
      require_session_password_scheme
      exec bun "$SCRIPT_DIR/write-mcp-config.ts" "$run_id"
      ;;
    mcp-verify)
      [[ "$#" -eq 2 ]] || fail "mcp-verify requires one RUN_ID"
      require_command bun
      open_run_lock "$run_id"
      exec bun "$SCRIPT_DIR/verify-homarr-mcp.ts" "$run_id"
      ;;
    connections-check)
      [[ "$#" -eq 2 ]] || fail "connections-check requires one RUN_ID"
      open_run_lock "$run_id"
      load_session "$run_id"
      require_session_password_scheme
      [[ -e "$SESSION_DIR/connections.env" && ! -L "$SESSION_DIR/connections.env" ]] \
        || fail "connections file is missing"
      validate_connections_schema_file \
        "$SESSION_DIR/connections.env" \
        "$SESSION_DIR" \
        "connections file"
      close_run_lock
      printf 'PASS private connections file schema\n'
      ;;
    connections)
      [[ "$#" -eq 2 ]] || fail "connections requires one RUN_ID"
      require_command bun
      open_run_lock "$run_id"
      load_session "$run_id"
      require_session_password_scheme
      cleanup_validated_connections_transients "$SESSION_DIR"
      exec bun "$SCRIPT_DIR/lib/session-context.ts" connections "$run_id"
      ;;
    handoff)
      [[ "$#" -eq 2 ]] || fail "handoff requires one RUN_ID"
      require_command bun
      open_run_lock "$run_id"
      load_session "$run_id"
      require_session_password_scheme
      cleanup_validated_connections_transients "$SESSION_DIR"
      exec bun "$SCRIPT_DIR/lib/session-context.ts" handoff "$run_id"
      ;;
    down)
      [[ "$#" -eq 2 ]] || fail "down requires one RUN_ID"
      open_run_lock "$run_id"
      load_session "$run_id"
      compose down --remove-orphans
      close_run_lock
      ;;
    status)
      [[ "$#" -eq 2 ]] || fail "status requires one RUN_ID"
      load_session "$run_id"
      compose ps
      ;;
    urls)
      [[ "$#" -eq 2 ]] || fail "urls requires one RUN_ID"
      load_session "$run_id"
      print_urls
      ;;
    env)
      [[ "$#" -eq 2 ]] || fail "env requires one RUN_ID"
      load_session "$run_id"
      print_env
      ;;
    doctor)
      [[ "$#" -le 2 ]] || fail "doctor accepts at most one RUN_ID"
      doctor "$run_id"
      ;;
    destroy)
      [[ "$#" -eq 4 ]] || fail "destroy requires: destroy RUN_ID --confirm RUN_ID"
      destroy_session "$run_id" "$3" "$4"
      ;;
    -h|--help|help|'')
      usage
      ;;
    *)
      usage >&2
      fail "unknown command: $command"
      ;;
  esac
}

main "$@"
