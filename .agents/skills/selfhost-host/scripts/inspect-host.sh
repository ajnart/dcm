#!/usr/bin/env bash

set -u
set -o pipefail

umask 077

SCRIPT_NAME="inspect-host.sh"
LIMIT=24
MAX_LIMIT=50
MAX_PATHS=8
COMMAND_TIMEOUT_SECONDS=6
OUTPUT_FILE=""
PLATFORM_HINT="auto"
SKIP_DOCKER=false
REQUESTED_PATHS=()

usage() {
  cat <<'USAGE'
Usage: inspect-host.sh [options]

Emit a bounded, redacted JSON profile using read-only host probes.

Options:
  --path PATH              Inspect an explicit candidate path (repeat up to 8 times).
  --platform-hint KIND     auto, macos, linux, vps, unraid, truenas,
                           proxmox-vm, or proxmox-lxc.
  --limit N                Items per collection, from 1 through 50 (default: 24).
  --skip-docker            Do not query Docker or Docker Compose.
  --output FILE            Atomically create a new mode-0600 JSON file.
                           Existing paths and symlinks are refused.
  -h, --help               Show this help.

The script does not inspect environment values, container configuration, labels,
mount sources, secrets, or directory contents. Stderr from probes is discarded.
USAGE
}

fail() {
  printf '%s: %s\n' "$SCRIPT_NAME" "$1" >&2
  exit 2
}

require_value() {
  if [ "$#" -lt 2 ] || [ -z "$2" ]; then
    fail "$1 requires a value"
  fi
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --path)
      require_value "$@"
      if [ "${#REQUESTED_PATHS[@]}" -ge "$MAX_PATHS" ]; then
        fail "--path may be supplied at most $MAX_PATHS times"
      fi
      REQUESTED_PATHS+=("$2")
      shift 2
      ;;
    --platform-hint)
      require_value "$@"
      PLATFORM_HINT="$2"
      shift 2
      ;;
    --limit)
      require_value "$@"
      LIMIT="$2"
      shift 2
      ;;
    --skip-docker)
      SKIP_DOCKER=true
      shift
      ;;
    --output)
      require_value "$@"
      OUTPUT_FILE="$2"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    --)
      shift
      if [ "$#" -gt 0 ]; then
        fail "unexpected positional arguments"
      fi
      ;;
    *)
      fail "unknown option: $1"
      ;;
  esac
done

case "$LIMIT" in
  ''|*[!0-9]*) fail "--limit must be an integer from 1 through $MAX_LIMIT" ;;
esac
if [ "$LIMIT" -lt 1 ] || [ "$LIMIT" -gt "$MAX_LIMIT" ]; then
  fail "--limit must be an integer from 1 through $MAX_LIMIT"
fi

case "$PLATFORM_HINT" in
  auto|macos|linux|vps|unraid|truenas|proxmox-vm|proxmox-lxc) ;;
  *) fail "unsupported --platform-hint: $PLATFORM_HINT" ;;
esac

have_command() {
  command -v "$1" >/dev/null 2>&1
}

run_bounded() {
  if have_command timeout; then
    timeout "$COMMAND_TIMEOUT_SECONDS" "$@" 2>/dev/null
    return $?
  fi
  if have_command gtimeout; then
    gtimeout "$COMMAND_TIMEOUT_SECONDS" "$@" 2>/dev/null
    return $?
  fi
  "$@" 2>/dev/null
}

sanitize_text() {
  local value="$1"
  local maximum="$2"
  value=$(printf '%s' "$value" | LC_ALL=C tr '\r\n\t' '   ' | LC_ALL=C tr -cd '[:print:]')
  printf '%s' "$value" | LC_ALL=C cut -c "1-$maximum"
}

json_quote() {
  local value
  value=$(sanitize_text "$1" "${2:-256}")
  value=${value//\\/\\\\}
  value=${value//\"/\\\"}
  printf '"%s"' "$value"
}

json_string_or_null() {
  if [ -n "$1" ]; then
    json_quote "$1" "${2:-256}"
  else
    printf 'null'
  fi
}

line_count() {
  if [ -z "$1" ]; then
    printf '0'
    return
  fi
  printf '%s\n' "$1" | LC_ALL=C awk 'END { print NR }'
}

is_truncated() {
  local count
  count=$(line_count "$1")
  if [ "$count" -gt "$LIMIT" ]; then
    printf 'true'
  else
    printf 'false'
  fi
}

os_release_value() {
  local key="$1"
  LC_ALL=C awk -F= -v wanted="$key" '
    $1 == wanted {
      value = substr($0, index($0, "=") + 1)
      if (substr(value, 1, 1) == "\"" && substr(value, length(value), 1) == "\"") {
        value = substr(value, 2, length(value) - 2)
      }
      print value
      exit
    }
  ' /etc/os-release 2>/dev/null
}

KERNEL_NAME=$(run_bounded uname -s || true)
KERNEL_RELEASE=$(run_bounded uname -r || true)
ARCHITECTURE=$(run_bounded uname -m || true)
OS_ID=""
OS_VERSION=""
OBSERVED_KIND="unknown"
PLATFORM_STATE="not_observable"

case "$KERNEL_NAME" in
  Darwin)
    OBSERVED_KIND="macos"
    OS_ID="macos"
    PLATFORM_STATE="observed"
    if have_command sw_vers; then
      OS_VERSION=$(run_bounded sw_vers -productVersion || true)
    fi
    ;;
  Linux)
    OBSERVED_KIND="linux"
    PLATFORM_STATE="observed"
    if [ -r /etc/os-release ]; then
      OS_ID=$(os_release_value ID)
      OS_VERSION=$(os_release_value VERSION_ID)
    fi
    if [ -r /etc/unraid-version ]; then
      OBSERVED_KIND="unraid"
      OS_ID="unraid"
      OS_VERSION=$(LC_ALL=C awk -F= '$1 == "version" { gsub(/\"/, "", $2); print $2; exit }' /etc/unraid-version 2>/dev/null)
    elif have_command midclt; then
      OBSERVED_KIND="truenas"
      OS_ID="truenas"
    elif have_command pveversion; then
      OBSERVED_KIND="proxmox-host"
      OS_ID="proxmox-ve"
      OS_VERSION=$(run_bounded pveversion | LC_ALL=C sed -n '1p' || true)
    fi
    ;;
esac

VIRTUALIZATION_STATE="not_observable"
VIRTUALIZATION_TYPE=""
if have_command systemd-detect-virt; then
  VIRTUALIZATION_TYPE=$(run_bounded systemd-detect-virt || true)
  if [ -n "$VIRTUALIZATION_TYPE" ]; then
    VIRTUALIZATION_STATE="observed"
  fi
fi

EFFECTIVE_KIND="$OBSERVED_KIND"
EFFECTIVE_KIND_SOURCE="observed"
if [ "$PLATFORM_HINT" != "auto" ]; then
  EFFECTIVE_KIND="$PLATFORM_HINT"
  EFFECTIVE_KIND_SOURCE="chosen"
fi

UID_VALUE=""
GID_VALUE=""
GROUP_IDS=""
IDENTITY_STATE="not_observable"
if have_command id; then
  UID_VALUE=$(run_bounded id -u || true)
  GID_VALUE=$(run_bounded id -g || true)
  GROUP_IDS=$(run_bounded id -G || true)
  if [ -n "$UID_VALUE" ] && [ -n "$GID_VALUE" ]; then
    IDENTITY_STATE="observed"
  fi
fi

TIMEZONE_STATE="not_observable"
TIMEZONE_VALUE=""
if have_command timedatectl; then
  TIMEZONE_VALUE=$(run_bounded timedatectl show --property=Timezone --value || true)
fi
if [ -z "$TIMEZONE_VALUE" ] && [ -r /etc/timezone ]; then
  TIMEZONE_VALUE=$(LC_ALL=C sed -n '1p' /etc/timezone 2>/dev/null || true)
fi
if [ -z "$TIMEZONE_VALUE" ] && [ -L /etc/localtime ]; then
  LOCALTIME_LINK=$(readlink /etc/localtime 2>/dev/null || true)
  case "$LOCALTIME_LINK" in
    *zoneinfo/*) TIMEZONE_VALUE=${LOCALTIME_LINK##*zoneinfo/} ;;
  esac
fi
if [ -n "$TIMEZONE_VALUE" ]; then
  TIMEZONE_STATE="observed"
fi

SUBUID_STATE="not_observable"
SUBUID_VALUE=""
SUBGID_STATE="not_observable"
SUBGID_VALUE=""
LOGIN_NAME=""
if have_command id; then
  LOGIN_NAME=$(run_bounded id -un || true)
fi
if [ -n "$LOGIN_NAME" ] && [ -r /etc/subuid ]; then
  SUBUID_STATE="observed"
  if LC_ALL=C awk -F: -v wanted="$LOGIN_NAME" '$1 == wanted { found = 1 } END { exit !found }' /etc/subuid 2>/dev/null; then
    SUBUID_VALUE="true"
  else
    SUBUID_VALUE="false"
  fi
fi
if [ -n "$LOGIN_NAME" ] && [ -r /etc/subgid ]; then
  SUBGID_STATE="observed"
  if LC_ALL=C awk -F: -v wanted="$LOGIN_NAME" '$1 == wanted { found = 1 } END { exit !found }' /etc/subgid 2>/dev/null; then
    SUBGID_VALUE="true"
  else
    SUBGID_VALUE="false"
  fi
fi

NEWUIDMAP_STATE="not_installed"
NEWGIDMAP_STATE="not_installed"
if have_command newuidmap; then
  NEWUIDMAP_STATE="installed"
fi
if have_command newgidmap; then
  NEWGIDMAP_STATE="installed"
fi

FETCH_LIMIT=$((LIMIT + 1))
DOCKER_QUERY="attempted"
DOCKER_STATE="not_installed"
DOCKER_CLIENT_VERSION=""
DOCKER_SERVER_VERSION=""
COMPOSE_STATE="not_installed"
COMPOSE_VERSION=""
DOCKER_CONTEXT_STATE="not_observable"
DOCKER_CONTEXT_CURRENT=""
DOCKER_CONTEXTS=""
DOCKER_CONTEXTS_STATE="not_observable"
DOCKER_ROOTLESS_STATE="not_observable"
DOCKER_ROOTLESS_VALUE=""
CONTAINERS_STATE="not_observable"
CONTAINERS=""
DOCKER_NETWORKS_STATE="not_observable"
DOCKER_NETWORKS=""

if [ "$SKIP_DOCKER" = true ]; then
  DOCKER_QUERY="skipped_by_request"
  DOCKER_STATE="not_observable"
  COMPOSE_STATE="not_observable"
elif have_command docker; then
  DOCKER_STATE="installed"
  DOCKER_CLIENT_VERSION=$(run_bounded docker version --format '{{.Client.Version}}' || true)
  if [ -z "$DOCKER_CLIENT_VERSION" ]; then
    DOCKER_CLIENT_VERSION=$(run_bounded docker --version | LC_ALL=C awk '{ for (i = 1; i <= NF; i += 1) { if ($i == "version" && (i + 1) <= NF) { gsub(/,/, "", $(i + 1)); print $(i + 1); exit } } }' || true)
  fi

  if COMPOSE_VERSION=$(run_bounded docker compose version --short); then
    COMPOSE_STATE="installed"
  else
    COMPOSE_VERSION=""
  fi

  if DOCKER_CONTEXT_CURRENT=$(run_bounded docker context show); then
    DOCKER_CONTEXT_STATE="observed"
  else
    DOCKER_CONTEXT_CURRENT=""
  fi

  if DOCKER_CONTEXTS=$(run_bounded docker context ls --format '{{.Name}}' | LC_ALL=C sed -n "1,${FETCH_LIMIT}p"); then
    DOCKER_CONTEXTS_STATE="observed"
  else
    DOCKER_CONTEXTS=""
  fi

  DOCKER_SECURITY_OPTIONS=""
  if DOCKER_SECURITY_OPTIONS=$(run_bounded docker info --format '{{json .SecurityOptions}}'); then
    DOCKER_STATE="running"
    DOCKER_SERVER_VERSION=$(run_bounded docker version --format '{{.Server.Version}}' || true)
    DOCKER_ROOTLESS_STATE="observed"
    case "$DOCKER_SECURITY_OPTIONS" in
      *rootless*) DOCKER_ROOTLESS_VALUE="true" ;;
      *) DOCKER_ROOTLESS_VALUE="false" ;;
    esac

    if CONTAINERS=$(run_bounded docker ps --format '{{.Names}}\t{{.Image}}\t{{.State}}\t{{.Status}}\t{{.Ports}}' | LC_ALL=C sed -n "1,${FETCH_LIMIT}p"); then
      CONTAINERS_STATE="observed"
    else
      CONTAINERS=""
    fi

    if DOCKER_NETWORKS=$(run_bounded docker network ls --format '{{.Name}}\t{{.Driver}}\t{{.Scope}}' | LC_ALL=C sed -n "1,${FETCH_LIMIT}p"); then
      DOCKER_NETWORKS_STATE="observed"
    else
      DOCKER_NETWORKS=""
    fi
  else
    DOCKER_STATE="not_observable"
  fi
else
  DOCKER_CONTEXT_STATE="not_installed"
  DOCKER_CONTEXTS_STATE="not_installed"
  CONTAINERS_STATE="not_installed"
  DOCKER_NETWORKS_STATE="not_installed"
fi

LISTENERS_STATE="not_observable"
LISTENER_STYLE="colon"
LISTENERS=""
if have_command ss; then
  if LISTENERS=$(run_bounded ss -H -lntu | LC_ALL=C awk 'NF >= 5 { print $1 "\t" $5 }' | LC_ALL=C sed -n "1,${FETCH_LIMIT}p"); then
    LISTENERS_STATE="observed"
  else
    LISTENERS=""
  fi
elif [ "$KERNEL_NAME" = "Darwin" ] && have_command netstat; then
  LISTENER_STYLE="dot"
  if LISTENERS=$(
    {
      run_bounded netstat -an -p tcp
      run_bounded netstat -an -p udp
    } | LC_ALL=C awk '
      $1 ~ /^tcp/ && $NF == "LISTEN" { print "tcp\t" $4 }
      $1 ~ /^udp/ { print "udp\t" $4 }
    ' | LC_ALL=C sed -n "1,${FETCH_LIMIT}p"
  ); then
    LISTENERS_STATE="observed"
  else
    LISTENERS=""
  fi
elif have_command netstat; then
  if LISTENERS=$(run_bounded netstat -lntu | LC_ALL=C awk 'NR > 2 && ($1 ~ /^tcp/ || $1 ~ /^udp/) { print $1 "\t" $4 }' | LC_ALL=C sed -n "1,${FETCH_LIMIT}p"); then
    LISTENERS_STATE="observed"
  else
    LISTENERS=""
  fi
fi

PATH_CANDIDATES=("/")
for REQUESTED_PATH in "${REQUESTED_PATHS[@]}"; do
  ALREADY_PRESENT=false
  for EXISTING_PATH in "${PATH_CANDIDATES[@]}"; do
    if [ "$EXISTING_PATH" = "$REQUESTED_PATH" ]; then
      ALREADY_PRESENT=true
      break
    fi
  done
  if [ "$ALREADY_PRESENT" = false ]; then
    PATH_CANDIDATES+=("$REQUESTED_PATH")
  fi
done

set_recommendations() {
  DEPLOYMENT_BOUNDARY="docker-engine"
  CONFIG_ROOT="/srv/selfhost/config"
  DATA_ROOT="/srv/selfhost/data"
  MEDIA_ROOT="/srv/selfhost/media"
  DOWNLOADS_ROOT="/srv/selfhost/downloads"
  CACHE_ROOT="/srv/selfhost/cache"
  BACKUP_ROOT="<separate-backup-destination>/selfhost"
  DATABASE_STORAGE="bind-or-named-volume"
  IDENTITY_MODE="explicit-numeric-user"
  RECOMMENDATION_NOTES="Confirm rootful versus rootless Docker.\nValidate write access as each service identity."

  case "$EFFECTIVE_KIND" in
    macos)
      DEPLOYMENT_BOUNDARY="docker-desktop-vm"
      CONFIG_ROOT="~/Library/Application Support/selfhost"
      DATA_ROOT="~/Selfhost/data"
      MEDIA_ROOT="~/Selfhost/media"
      DOWNLOADS_ROOT="~/Selfhost/downloads"
      CACHE_ROOT="docker-named-volume"
      DATABASE_STORAGE="docker-named-volume"
      IDENTITY_MODE="docker-desktop-managed"
      RECOMMENDATION_NOTES="Confirm the owning account before expanding tilde.\nShare only deliberate bind paths with Docker Desktop.\nCheck arm64 images and Docker Desktop resource limits."
      ;;
    vps)
      RECOMMENDATION_NOTES="Use an explicit local or SSH Docker context.\nRequire provider firewall, host firewall, recovery access, one ingress owner, TLS, authentication, and off-host backup before public exposure."
      ;;
    unraid)
      CONFIG_ROOT="/mnt/user/appdata/selfhost"
      DATA_ROOT="/mnt/user/selfhost"
      MEDIA_ROOT="/mnt/user/media"
      DOWNLOADS_ROOT="/mnt/user/downloads"
      CACHE_ROOT="<chosen-cache-pool>/selfhost"
      IDENTITY_MODE="unraid-share-acl"
      RECOMMENDATION_NOTES="Preserve share ownership and ACL conventions.\nConfirm cache pool and mover behavior.\nFlash backup does not cover appdata or user data."
      ;;
    truenas)
      DEPLOYMENT_BOUNDARY="truenas-custom-app-or-vm"
      CONFIG_ROOT="/mnt/<pool>/apps/selfhost"
      DATA_ROOT="/mnt/<pool>/data"
      MEDIA_ROOT="/mnt/<pool>/media"
      DOWNLOADS_ROOT="/mnt/<pool>/downloads"
      CACHE_ROOT="/mnt/<pool>/cache/selfhost"
      IDENTITY_MODE="truenas-dataset-acl"
      RECOMMENDATION_NOTES="Choose datasets before mounts.\nMap container identities to dataset ACLs explicitly.\nReplicate snapshots to another failure domain."
      ;;
    proxmox-host)
      DEPLOYMENT_BOUNDARY="qemu-vm"
      CONFIG_ROOT="inside-qemu-vm:/srv/selfhost/config"
      DATA_ROOT="inside-qemu-vm:/srv/selfhost/data"
      MEDIA_ROOT="inside-qemu-vm:/srv/selfhost/media"
      DOWNLOADS_ROOT="inside-qemu-vm:/srv/selfhost/downloads"
      CACHE_ROOT="inside-qemu-vm:/srv/selfhost/cache"
      IDENTITY_MODE="guest-explicit-numeric-user"
      RECOMMENDATION_NOTES="Run Docker in a QEMU VM by default.\nKeep application containers off the Proxmox VE host.\nPlan guest and application-consistent backups separately."
      ;;
    proxmox-vm)
      DEPLOYMENT_BOUNDARY="qemu-vm-guest"
      IDENTITY_MODE="guest-explicit-numeric-user"
      RECOMMENDATION_NOTES="Confirm VM storage, bridge or VLAN, resource limits, and guest backups.\nValidate write access inside the guest as each service identity."
      ;;
    proxmox-lxc)
      DEPLOYMENT_BOUNDARY="nested-lxc-exception"
      IDENTITY_MODE="lxc-mapped-numeric-user"
      RECOMMENDATION_NOTES="Require explicit acceptance of nested LXC tradeoffs.\nConfirm UID/GID translation, device mappings, migration, shared-kernel exposure, and restore behavior."
      ;;
  esac
}

set_recommendations

emit_numeric_groups() {
  local group
  local emitted=0
  local total=0
  for group in $GROUP_IDS; do
    total=$((total + 1))
    if [ "$emitted" -ge 32 ]; then
      continue
    fi
    case "$group" in
      ''|*[!0-9]*) continue ;;
    esac
    if [ "$emitted" -gt 0 ]; then
      printf ', '
    fi
    printf '%s' "$group"
    emitted=$((emitted + 1))
  done
}

groups_truncated() {
  local group
  local total=0
  for group in $GROUP_IDS; do
    total=$((total + 1))
  done
  if [ "$total" -gt 32 ]; then
    printf 'true'
  else
    printf 'false'
  fi
}

emit_contexts() {
  local name
  local emitted=0
  while IFS= read -r name; do
    if [ -z "$name" ] || [ "$emitted" -ge "$LIMIT" ]; then
      continue
    fi
    if [ "$emitted" -gt 0 ]; then
      printf ', '
    fi
    json_quote "$name" 128
    emitted=$((emitted + 1))
  done <<EOF
$DOCKER_CONTEXTS
EOF
}

emit_containers() {
  local name image state status ports
  local emitted=0
  while IFS=$'\t' read -r name image state status ports; do
    if [ -z "$name$image$state$status$ports" ] || [ "$emitted" -ge "$LIMIT" ]; then
      continue
    fi
    if [ "$emitted" -gt 0 ]; then
      printf ',\n'
    fi
    printf '        {"name": '
    json_string_or_null "$name" 128
    printf ', "image": '
    json_string_or_null "$image" 256
    printf ', "state": '
    json_string_or_null "$state" 32
    printf ', "status": '
    json_string_or_null "$status" 160
    printf ', "publishedPorts": '
    json_string_or_null "$ports" 256
    printf '}'
    emitted=$((emitted + 1))
  done <<EOF
$CONTAINERS
EOF
}

emit_docker_networks() {
  local name driver scope
  local emitted=0
  while IFS=$'\t' read -r name driver scope; do
    if [ -z "$name$driver$scope" ] || [ "$emitted" -ge "$LIMIT" ]; then
      continue
    fi
    if [ "$emitted" -gt 0 ]; then
      printf ',\n'
    fi
    printf '        {"name": '
    json_string_or_null "$name" 128
    printf ', "driver": '
    json_string_or_null "$driver" 64
    printf ', "scope": '
    json_string_or_null "$scope" 64
    printf '}'
    emitted=$((emitted + 1))
  done <<EOF
$DOCKER_NETWORKS
EOF
}

emit_listeners() {
  local protocol endpoint bind port
  local emitted=0
  while IFS=$'\t' read -r protocol endpoint; do
    if [ -z "$protocol$endpoint" ] || [ "$emitted" -ge "$LIMIT" ]; then
      continue
    fi
    protocol=${protocol%6}
    protocol=${protocol%4}
    bind=""
    port=""
    if [ "$LISTENER_STYLE" = "dot" ]; then
      port=${endpoint##*.}
      bind=${endpoint%.*}
    else
      port=${endpoint##*:}
      bind=${endpoint%:*}
      bind=${bind#[}
      bind=${bind%]}
    fi
    if [ "$emitted" -gt 0 ]; then
      printf ',\n'
    fi
    printf '      {"protocol": '
    json_string_or_null "$protocol" 16
    printf ', "bind": '
    json_string_or_null "$bind" 96
    printf ', "port": '
    json_string_or_null "$port" 16
    printf '}'
    emitted=$((emitted + 1))
  done <<EOF
$LISTENERS
EOF
}

emit_storage_path() {
  local path="$1"
  local exists=false
  local directory=false
  local symlink=false
  local writable="null"
  local device_id=""
  local mount_point=""
  local filesystem_type=""
  local mount_options=""
  local network_filesystem="null"
  local read_only="null"
  local available_kb=""
  local available_bytes=""
  local available_inodes=""
  local df_line=""
  local inode_line=""

  if [ -e "$path" ] || [ -L "$path" ]; then
    exists=true
    if [ -d "$path" ]; then
      directory=true
    fi
    if [ -L "$path" ]; then
      symlink=true
    fi
    if [ -w "$path" ]; then
      writable=true
    else
      writable=false
    fi

    if [ "$KERNEL_NAME" = "Darwin" ]; then
      device_id=$(run_bounded stat -f '%d' "$path" || true)
    else
      device_id=$(run_bounded stat -c '%d' "$path" || true)
    fi

    if df_line=$(run_bounded df -Pk "$path" | LC_ALL=C awk 'NR == 2 { print $4 "\t" $6; exit }'); then
      IFS=$'\t' read -r available_kb mount_point <<EOF
$df_line
EOF
      case "$available_kb" in
        ''|*[!0-9]*) available_bytes="" ;;
        *) available_bytes=$((available_kb * 1024)) ;;
      esac
    fi

    if inode_line=$(run_bounded df -Pi "$path" | LC_ALL=C awk 'NR == 2 { print $4; exit }'); then
      case "$inode_line" in
        ''|*[!0-9]*) ;;
        *) available_inodes="$inode_line" ;;
      esac
    fi

    if have_command findmnt; then
      filesystem_type=$(run_bounded findmnt -n -T "$path" -o FSTYPE || true)
      mount_point=$(run_bounded findmnt -n -T "$path" -o TARGET || true)
      mount_options=$(run_bounded findmnt -n -T "$path" -o OPTIONS || true)
      if [ -n "$filesystem_type" ]; then
        network_filesystem=false
        case "$filesystem_type" in
          nfs|nfs4|cifs|smbfs|sshfs|fuse.sshfs|9p|ceph|glusterfs) network_filesystem=true ;;
        esac
      fi
      if [ -n "$mount_options" ]; then
        read_only=false
        case ",${mount_options}," in
          *,ro,*) read_only=true ;;
        esac
      fi
    fi
  fi

  printf '      {"path": '
  json_quote "$path" 512
  printf ', "exists": %s, "directory": %s, "symlink": %s, "writableByInspector": %s' "$exists" "$directory" "$symlink" "$writable"
  printf ', "deviceId": '
  json_string_or_null "$device_id" 64
  printf ', "mountPoint": '
  json_string_or_null "$mount_point" 512
  printf ', "filesystemType": '
  json_string_or_null "$filesystem_type" 64
  printf ', "networkFilesystem": %s, "readOnlyMount": %s' "$network_filesystem" "$read_only"
  printf ', "availableBytes": '
  if [ -n "$available_bytes" ]; then
    printf '%s' "$available_bytes"
  else
    printf 'null'
  fi
  printf ', "availableInodes": '
  if [ -n "$available_inodes" ]; then
    printf '%s' "$available_inodes"
  else
    printf 'null'
  fi
  printf '}'
}

emit_storage_paths() {
  local path
  local emitted=0
  for path in "${PATH_CANDIDATES[@]}"; do
    if [ "$emitted" -gt 0 ]; then
      printf ',\n'
    fi
    emit_storage_path "$path"
    emitted=$((emitted + 1))
  done
}

capability_state() {
  local command_name="$1"
  local unit_name="$2"
  local process_name="$3"
  if ! have_command "$command_name"; then
    printf 'not_installed'
    return
  fi
  if [ -n "$unit_name" ] && have_command systemctl; then
    if run_bounded systemctl is-active --quiet "$unit_name"; then
      printf 'running'
      return
    fi
  fi
  if [ -n "$process_name" ] && have_command pgrep; then
    if run_bounded pgrep -x "$process_name" >/dev/null; then
      printf 'running'
      return
    fi
  fi
  printf 'installed'
}

emit_capability() {
  local id="$1"
  local command_name="$2"
  local unit_name="$3"
  local process_name="$4"
  printf '{"id": '
  json_quote "$id" 64
  printf ', "state": '
  json_quote "$(capability_state "$command_name" "$unit_name" "$process_name")" 32
  printf '}'
}

emit_capabilities() {
  emit_capability caddy caddy caddy caddy
  printf ',\n      '
  emit_capability traefik traefik traefik traefik
  printf ',\n      '
  emit_capability cloudflared cloudflared cloudflared cloudflared
  printf ',\n      '
  emit_capability tailscale tailscale tailscaled tailscaled
  printf ',\n      '
  emit_capability headscale headscale headscale headscale
  printf ',\n      '
  emit_capability ngrok ngrok ngrok ngrok
  printf ',\n      '
  emit_capability wireguard wg '' ''
  printf ',\n      '
  emit_capability restic restic '' ''
  printf ',\n      '
  emit_capability kopia kopia '' ''
  printf ',\n      '
  emit_capability borg borg '' ''
  printf ',\n      '
  emit_capability rclone rclone '' ''
}

emit_recommendation_notes() {
  local note
  local emitted=0
  while IFS= read -r note; do
    if [ -z "$note" ]; then
      continue
    fi
    if [ "$emitted" -gt 0 ]; then
      printf ', '
    fi
    json_quote "$note" 256
    emitted=$((emitted + 1))
  done <<EOF
$RECOMMENDATION_NOTES
EOF
}

emit_report() {
  printf '{\n'
  printf '  "schemaVersion": 1,\n'
  printf '  "mode": "read-only",\n'
  printf '  "limits": {"itemsPerCollection": %s, "maximumCandidatePaths": %s, "probeTimeoutSecondsWhenAvailable": %s},\n' "$LIMIT" "$MAX_PATHS" "$COMMAND_TIMEOUT_SECONDS"
  printf '  "platform": {\n'
  printf '    "state": '
  json_quote "$PLATFORM_STATE" 32
  printf ',\n    "observedKind": '
  json_quote "$OBSERVED_KIND" 64
  printf ',\n    "effectiveKind": '
  json_quote "$EFFECTIVE_KIND" 64
  printf ',\n    "effectiveKindSource": '
  json_quote "$EFFECTIVE_KIND_SOURCE" 32
  printf ',\n    "kernel": {"name": '
  json_string_or_null "$KERNEL_NAME" 64
  printf ', "release": '
  json_string_or_null "$KERNEL_RELEASE" 128
  printf ', "architecture": '
  json_string_or_null "$ARCHITECTURE" 64
  printf '},\n    "distribution": {"id": '
  json_string_or_null "$OS_ID" 64
  printf ', "version": '
  json_string_or_null "$OS_VERSION" 128
  printf '},\n    "virtualization": {"state": '
  json_quote "$VIRTUALIZATION_STATE" 32
  printf ', "type": '
  json_string_or_null "$VIRTUALIZATION_TYPE" 64
  printf '}\n  },\n'

  printf '  "identity": {\n'
  printf '    "state": '
  json_quote "$IDENTITY_STATE" 32
  printf ', "uid": '
  if [ -n "$UID_VALUE" ]; then printf '%s' "$UID_VALUE"; else printf 'null'; fi
  printf ', "gid": '
  if [ -n "$GID_VALUE" ]; then printf '%s' "$GID_VALUE"; else printf 'null'; fi
  printf ',\n    "supplementaryGroupIds": ['
  emit_numeric_groups
  printf '], "groupsTruncated": %s,\n' "$(groups_truncated)"
  printf '    "timezone": {"state": '
  json_quote "$TIMEZONE_STATE" 32
  printf ', "value": '
  json_string_or_null "$TIMEZONE_VALUE" 128
  printf '},\n'
  printf '    "rootlessPrerequisites": {"newuidmap": '
  json_quote "$NEWUIDMAP_STATE" 32
  printf ', "newgidmap": '
  json_quote "$NEWGIDMAP_STATE" 32
  printf ', "subuid": {"state": '
  json_quote "$SUBUID_STATE" 32
  printf ', "present": '
  if [ -n "$SUBUID_VALUE" ]; then printf '%s' "$SUBUID_VALUE"; else printf 'null'; fi
  printf '}, "subgid": {"state": '
  json_quote "$SUBGID_STATE" 32
  printf ', "present": '
  if [ -n "$SUBGID_VALUE" ]; then printf '%s' "$SUBGID_VALUE"; else printf 'null'; fi
  printf '}}\n  },\n'

  printf '  "runtime": {\n'
  printf '    "docker": {"query": '
  json_quote "$DOCKER_QUERY" 32
  printf ', "state": '
  json_quote "$DOCKER_STATE" 32
  printf ', "clientVersion": '
  json_string_or_null "$DOCKER_CLIENT_VERSION" 64
  printf ', "serverVersion": '
  json_string_or_null "$DOCKER_SERVER_VERSION" 64
  printf ', "rootless": {"state": '
  json_quote "$DOCKER_ROOTLESS_STATE" 32
  printf ', "value": '
  if [ -n "$DOCKER_ROOTLESS_VALUE" ]; then printf '%s' "$DOCKER_ROOTLESS_VALUE"; else printf 'null'; fi
  printf '}},\n'
  printf '    "compose": {"state": '
  json_quote "$COMPOSE_STATE" 32
  printf ', "version": '
  json_string_or_null "$COMPOSE_VERSION" 64
  printf '},\n'
  printf '    "dockerContext": {"state": '
  json_quote "$DOCKER_CONTEXT_STATE" 32
  printf ', "current": '
  json_string_or_null "$DOCKER_CONTEXT_CURRENT" 128
  printf ', "availableState": '
  json_quote "$DOCKER_CONTEXTS_STATE" 32
  printf ', "available": ['
  emit_contexts
  printf '], "truncated": %s}\n' "$(is_truncated "$DOCKER_CONTEXTS")"
  printf '  },\n'

  printf '  "workloads": {\n'
  printf '    "containers": {"state": '
  json_quote "$CONTAINERS_STATE" 32
  printf ', "items": [\n'
  emit_containers
  printf '\n      ], "truncated": %s},\n' "$(is_truncated "$CONTAINERS")"
  printf '    "dockerNetworks": {"state": '
  json_quote "$DOCKER_NETWORKS_STATE" 32
  printf ', "items": [\n'
  emit_docker_networks
  printf '\n      ], "truncated": %s}\n' "$(is_truncated "$DOCKER_NETWORKS")"
  printf '  },\n'

  printf '  "network": {\n'
  printf '    "listeningPorts": {"state": '
  json_quote "$LISTENERS_STATE" 32
  printf ', "items": [\n'
  emit_listeners
  printf '\n    ], "truncated": %s}\n' "$(is_truncated "$LISTENERS")"
  printf '  },\n'

  printf '  "storage": {\n'
  printf '    "paths": [\n'
  emit_storage_paths
  printf '\n    ],\n'
  printf '    "recommendation": {\n'
  printf '      "source": "derived", "deploymentBoundary": '
  json_quote "$DEPLOYMENT_BOUNDARY" 96
  printf ',\n      "logicalRoots": {"config": '
  json_quote "$CONFIG_ROOT" 256
  printf ', "data": '
  json_quote "$DATA_ROOT" 256
  printf ', "media": '
  json_quote "$MEDIA_ROOT" 256
  printf ', "downloads": '
  json_quote "$DOWNLOADS_ROOT" 256
  printf ', "cache": '
  json_quote "$CACHE_ROOT" 256
  printf ', "backup": '
  json_quote "$BACKUP_ROOT" 256
  printf '},\n      "databaseStorage": '
  json_quote "$DATABASE_STORAGE" 96
  printf ', "identityMode": '
  json_quote "$IDENTITY_MODE" 96
  printf ',\n      "sameFilesystemConstraint": ["downloads", "media"],\n'
  printf '      "notes": ['
  emit_recommendation_notes
  printf ']\n    }\n'
  printf '  },\n'

  printf '  "capabilities": [\n      '
  emit_capabilities
  printf '\n  ],\n'
  printf '  "preferenceAllowlist": ["platformKind", "dockerContextName", "logicalPathMappings", "numericUid", "numericGid", "ianaTimezone", "ingressClass", "backupCadence", "externalResourceOwner"],\n'
  printf '  "safety": {\n'
  printf '    "environmentValuesEmitted": false,\n'
  printf '    "secretBearingFilesRead": false,\n'
  printf '    "recursiveScanPerformed": false,\n'
  printf '    "dockerInspectUsed": false,\n'
  printf '    "probeStderrIncluded": false,\n'
  printf '    "hostMutationPerformed": false,\n'
  if [ -n "$OUTPUT_FILE" ] && [ "$OUTPUT_FILE" != "-" ]; then
    printf '    "reportPersistence": "requested-new-file"\n'
  else
    printf '    "reportPersistence": "stdout-only"\n'
  fi
  printf '  }\n'
  printf '}\n'
}

if [ -z "$OUTPUT_FILE" ] || [ "$OUTPUT_FILE" = "-" ]; then
  emit_report
  exit 0
fi

if [ -e "$OUTPUT_FILE" ] || [ -L "$OUTPUT_FILE" ]; then
  fail "--output refuses to replace an existing path or symlink"
fi

OUTPUT_PARENT=$(dirname "$OUTPUT_FILE")
if [ ! -d "$OUTPUT_PARENT" ]; then
  fail "--output parent directory does not exist"
fi

TEMP_OUTPUT=$(mktemp "$OUTPUT_PARENT/.selfhost-host.XXXXXX") || fail "could not create a private temporary report"
cleanup_temp_output() {
  if [ -n "${TEMP_OUTPUT:-}" ] && [ -f "$TEMP_OUTPUT" ]; then
    rm -f "$TEMP_OUTPUT"
  fi
}
trap cleanup_temp_output EXIT HUP INT TERM

if ! emit_report >"$TEMP_OUTPUT"; then
  fail "could not write the report"
fi
chmod 600 "$TEMP_OUTPUT" 2>/dev/null || fail "could not restrict report permissions"
if ! ln "$TEMP_OUTPUT" "$OUTPUT_FILE"; then
  fail "could not create the report without replacing an existing path"
fi
cleanup_temp_output
TEMP_OUTPUT=""
trap - EXIT HUP INT TERM
