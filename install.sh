#!/usr/bin/env bash
# Install the self-host CLI.
#
#   curl -fsSL https://self-host.fyi/install | bash
#
# Installs to ~/.local/bin, or /usr/local/bin when run as root.
# Environment:
#   SELF_HOST_VERSION      install this version (1.2.0 or v1.2.0) instead of the latest
#   SELF_HOST_INSTALL_DIR  install here instead of the default directory
#   SELF_HOST_GITHUB_TOKEN GitHub token to lift the anonymous API rate limit; defaults to `gh auth token` when gh is logged in
#   SELF_HOST_RELEASE_REPO owner/name of the repository that publishes releases (default below)
#   SELF_HOST_RELEASES_URL, SELF_HOST_WEB_URL  alternative API and github.com roots (https, or http for localhost)
#   SELF_HOST_SKIP_SKILL_PROMPT=1  never offer to add the skill to an AI agent
#   SELF_HOST_TTY          file to ask the skill question on instead of /dev/tty (tests)
#
# Everything runs inside main, which is the last line: a truncated download
# defines functions at most and installs nothing.
set +x
set -euo pipefail

# The one place the repository name is written. After a GitHub rename the old
# name keeps redirecting, so changing it is cosmetic.
DEFAULT_REPO="ajnart/self-host"

REPO=""
TOKEN=""
TOKEN_IMPLICIT=0
API_URL=""
WEB_URL=""
HTTPS_ONLY=1
tmp=""
staging=""

configure() {
  REPO="${SELF_HOST_RELEASE_REPO:-$DEFAULT_REPO}"
  [[ "$REPO" =~ ^[A-Za-z0-9_-][A-Za-z0-9_.-]*/[A-Za-z0-9_.-]+$ && "$REPO" != *..* && "$REPO" != */. ]] || die "SELF_HOST_RELEASE_REPO must look like owner/name, not '${REPO}'"
  # Optional GitHub token for a higher API rate limit. Tokens stay out of process arguments.
  TOKEN="${SELF_HOST_GITHUB_TOKEN:-}"
  if [ -z "$TOKEN" ] && [ -z "${SELF_HOST_RELEASES_URL:-}" ] && command -v gh >/dev/null 2>&1; then
    TOKEN="$(gh auth token 2>/dev/null || true)"
    if [ -n "$TOKEN" ]; then TOKEN_IMPLICIT=1; fi
  fi
  case "$TOKEN" in *[!a-zA-Z0-9_.-]*) die "invalid token format" ;; esac
  API_URL="${SELF_HOST_RELEASES_URL:-https://api.github.com/repos/${REPO}}"
  WEB_URL="${SELF_HOST_WEB_URL:-https://github.com/${REPO}}"
  local url
  for url in "$API_URL" "$WEB_URL"; do
    case "$url" in
      https://*) ;;
      http://localhost | http://localhost[:/]* | http://127.0.0.1 | http://127.0.0.1[:/]*) HTTPS_ONLY=0 ;;
      *) die "SELF_HOST_RELEASES_URL and SELF_HOST_WEB_URL must be https URLs (http is allowed only for localhost)" ;;
    esac
  done
}

cleanup() {
  if [ -n "$tmp" ]; then
    rm -rf "$tmp"
  fi
  if [ -n "$staging" ]; then
    rm -f "$staging"
  fi
}

say() { printf '%s\n' "$*"; }
die() {
  printf 'install.sh: %s\n' "$*" >&2
  exit 1
}

need() {
  command -v "$1" >/dev/null 2>&1 || die "$1 is required but was not found"
}

detect_os() {
  case "$(uname -s)" in
    Linux) echo linux ;;
    Darwin) echo darwin ;;
    MINGW* | MSYS* | CYGWIN*) die "native Windows is unsupported; install WSL, then run this script inside it" ;;
    *) die "unsupported operating system $(uname -s); self-host supports Linux and macOS" ;;
  esac
}

detect_arch() {
  case "$(uname -m)" in
    x86_64 | amd64) echo amd64 ;;
    aarch64 | arm64) echo arm64 ;;
    *) die "unsupported CPU architecture $(uname -m)" ;;
  esac
}

install_dir() {
  if [ -n "${SELF_HOST_INSTALL_DIR:-}" ]; then
    echo "$SELF_HOST_INSTALL_DIR"
  elif [ "$(id -u)" -eq 0 ]; then
    echo /usr/local/bin
  else
    echo "${HOME}/.local/bin"
  fi
}

# Parse only scalar fields of JSON objects; nested assets cannot become tags.
# This keeps the installer independent of jq, Python, Node and source checkout.
json_values() {
  env LC_ALL=C awk -v wanted="${1:-}" -v mode="${2:-tags}" '
    function fail() { invalid=1; exit 1 }
    function ws() { while (pos<=len && ch[pos] ~ /[[:space:]]/) pos++ }
    function string_value( value,c,escape) {
      if (ch[pos++] != "\"") fail()
      value=""
      while (pos<=len) {
        c=ch[pos++]
        if (c == "\"") return value
        if (c == "\\") {
          escape=ch[pos++]
          if (escape == "u") {
            c=ch[pos] ch[pos+1] ch[pos+2] ch[pos+3]
            if (pos+3>len || c ~ /[^0-9a-fA-F]/) fail()
            pos+=4; value=value "\\u" c
          } else if (escape ~ /^["\\\/bfnrt]$/) value=value escape
          else fail()
        } else {
          if (c ~ /[[:cntrl:]]/) fail()
          value=value c
        }
      }
      fail()
    }
    function cli_release(tag,  ver,i,n,platforms) {
      ver=tag
      if (!sub(/^new-cli-v/, "", ver)) sub(/^v/, "", ver)
      if (!sums) return 0
      n=split("linux_amd64 linux_arm64 darwin_amd64 darwin_arm64", platforms, " ")
      for (i=1; i<=n; i++) if (index(names, "\nself-host_" ver "_" platforms[i] ".tar.gz\n")) return 1
      return 0
    }
    function object_value( field,value,tag) {
      pos++; depth++; ws()
      if (ch[pos] != "}") {
        while (1) {
          ws(); field=string_value(); ws()
          if (ch[pos++] != ":") fail()
          value=parse_value(); values[depth,field]=value; ws()
          if (ch[pos] == "}") break
          if (ch[pos++] != ",") fail()
        }
      }
      pos++
      tag=values[depth,"tag_name"]
      if (depth==2) {
        if (values[depth,"name"]=="checksums.txt") sums=1
        names=names "\n" values[depth,"name"] "\n"
        if (mode=="asset" && values[depth,"name"]==wanted) output=output values[depth,"id"] "\n"
        if (mode=="assetname" && values[depth,"name"]==wanted) output=output wanted "\n"
      }
      if (depth==1 && tag!="") {
        count++
        if (mode=="tag" && values[depth,"draft"]!="true" && values[depth,"prerelease"]!="true") output=output tag "\n"
        if (mode=="tags" && values[depth,"draft"]!="true" && values[depth,"prerelease"]!="true" && cli_release(tag)) output=output tag "\n"
      }
      if (depth==1) { sums=0; names="" }
      for (field in values) if (index(field,depth SUBSEP)==1) delete values[field]
      depth--
      return ""
    }
    function array_value() {
      pos++; ws()
      if (ch[pos] != "]") {
        while (1) {
          parse_value(); ws()
          if (ch[pos] == "]") break
          if (ch[pos++] != ",") fail()
        }
      }
      pos++; return ""
    }
    function parse_value( c,value) {
      ws(); c=ch[pos]
      if (c == "{") return object_value()
      if (c == "[") return array_value()
      if (c == "\"") return string_value()
      value=""
      while (pos<=len && !index("[],} \t\n\r\f\v", ch[pos])) value=value ch[pos++]
      if (value !~ /^(true|false|null)$/ && value !~ /^-?(0|[1-9][0-9]*)(\.[0-9]+)?([eE][+-]?[0-9]+)?$/) fail()
      return value
    }
    { input=input $0 "\n" }
    END {
      if (invalid) exit 1
      len=split(input, ch, "")
      pos=1; ws()
      if (mode=="tags" && ch[pos]!="[") fail()
      if ((mode=="asset" || mode=="assetname" || mode=="tag") && ch[pos]!="{") fail()
      parse_value(); ws()
      if (pos<=len || invalid) exit 1
      printf "%s",output
      if (mode=="tags") print "#" count+0
    }'
}

# with_token is true while requests carry the token: not set, or dropped after
# GitHub refused an implicitly adopted gh token (the flag file survives the
# subshells that capture responses).
with_token() {
  [ -n "$TOKEN" ] && [ ! -e "${tmp}/anonymous" ]
}

api_fetch() {
  local proto=(--proto '=https' --proto-redir '=https' --tlsv1.2) wget_proto=(--https-only)
  if [ "$HTTPS_ONLY" != 1 ]; then
    proto=(--proto '=http,https' --proto-redir '=http,https')
    wget_proto=(--max-redirect=10)
  elif ! wget --help 2>&1 | grep -q -- --https-only; then
    wget_proto=(--max-redirect=10)
  fi
  if command -v curl >/dev/null 2>&1; then
    if with_token; then
      printf 'header = "Authorization: Bearer %s"\n' "$TOKEN" |
        curl --config - "${proto[@]}" -fsSL -H "Accept: $2" "$1"
    else
      curl "${proto[@]}" -fsSL -H "Accept: $2" "$1"
    fi
  elif with_token; then
    (umask 077 && printf 'header = Authorization: Bearer %s\n' "$TOKEN" > "${tmp}/wgetrc")
    WGETRC="${tmp}/wgetrc" wget "${wget_proto[@]}" -nv -O- --header="Accept: $2" "$1"
  else
    wget "${wget_proto[@]}" -nv -O- --header="Accept: $2" "$1"
  fi
}

# http_error is true when the last failed request was refused with one of the
# given HTTP statuses (curl, GNU wget and busybox all print the number).
http_error() {
  local status
  for status in "$@"; do
    grep -Eq "(^|[^0-9])${status}([^0-9]|\$)" "${tmp}/error" 2>/dev/null && return 0
  done
  return 1
}

api_get() {
  local status=0
  api_fetch "$@" 2>"${tmp}/error" || status=$?
  if [ "$status" -ne 0 ] && [ "$TOKEN_IMPLICIT" = 1 ] && with_token && http_error 401 403; then
    : > "${tmp}/anonymous"
    status=0
    api_fetch "$@" 2>"${tmp}/error" || status=$?
  fi
  if [ "$status" -ne 0 ]; then cat "${tmp}/error" >&2; fi
  return "$status"
}

valid_version() {
  [[ "$1" =~ ^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$ ]]
}

# A CLI release is tagged vX.Y.Z or new-cli-vX.Y.Z and carries the self-host
# archives and checksums.txt (json_values filters on that), which keeps the
# legacy skill-pack releases out whatever their version.
latest_tag() {
  local body listing page count line candidates="" tag version per_page=100
  for page in {1..10}; do
    body="$(api_get "${API_URL}/releases?per_page=${per_page}&page=${page}" application/vnd.github+json)" ||
      die "could not look up CLI releases from ${API_URL} (a 403 means GitHub's rate limit of 60 anonymous requests an hour, or a token it refused: wait, or set SELF_HOST_GITHUB_TOKEN)"
    listing="$(printf '%s' "$body" | json_values)" || die "invalid release-list JSON"
    count=0
    while IFS= read -r line; do
      case "$line" in
        "#"*) count="${line#"#"}"; continue ;;
        new-cli-v*) tag="$line"; version="${tag#new-cli-v}" ;;
        v*) tag="$line"; version="${tag#v}" ;;
        *) continue ;;
      esac
      if valid_version "$version"; then candidates="${candidates}${version} ${tag}"$'\n'; fi
    done <<< "$listing"
    if [ "$count" -lt "$per_page" ]; then
      tag="$(printf '%s' "$candidates" | sed '/^$/d' | sort -t . -k1,1n -k2,2n -k3,3n | tail -n 1 | cut -d ' ' -f 2)"
      [ -n "$tag" ] || die "no CLI release is published (a vX.Y.Z tag with the self-host archives and checksums.txt)"
      printf '%s\n' "$tag"
      return
    fi
  done
  die "CLI release lookup exceeded 1000 releases"
}

sha256_of() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | cut -d ' ' -f 1
  elif command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$1" | cut -d ' ' -f 1
  else
    die "sha256sum or shasum is required to verify the download"
  fi
}

# path_help says exactly how to put dir on PATH for the person's login shell.
path_help() {
  local dir="$1" shown="$1" file line
  if [ "$dir" = "${HOME:-}/.local/bin" ]; then shown='$HOME/.local/bin'; fi
  case "$(basename "${SHELL:-}")" in
    fish)
      say "Warning: ${dir} is not on your PATH. Add it for fish, then open a new terminal:"
      say "  fish_add_path ${shown}"
      return
      ;;
    zsh) file='~/.zshrc' ;;
    bash)
      if [ "$(uname -s)" = Darwin ]; then file='~/.bash_profile'; else file='~/.bashrc'; fi
      ;;
    *) file="" ;;
  esac
  line="export PATH=\"${shown}:\$PATH\""
  if [ -n "$file" ]; then
    say "Warning: ${dir} is not on your PATH. Add it, then open a new terminal:"
    say "  echo '${line}' >> ${file}"
  else
    say "Warning: ${dir} is not on your PATH. Add this line to your shell's startup file, then open a new terminal:"
    say "  ${line}"
  fi
}

# resolve_release sets tag, version and metadata for the first candidate tag
# that is a published CLI release listing the archive and checksums.txt.
resolve_release() {
  local archive="$1" candidate found="" listed
  shift
  for candidate in "$@"; do
    metadata="$(api_get "${API_URL}/releases/tags/${candidate}" application/vnd.github+json 2>/dev/null)" || continue
    [ "$(printf '%s' "$metadata" | json_values "" tag)" = "$candidate" ] || die "release metadata does not match requested stable CLI tag"
    listed="$(printf '%s' "$metadata" | json_values "$archive" assetname)" || listed=""
    [ -n "$listed" ] || { found="$candidate"; continue; }
    tag="$candidate"
    return
  done
  if [ -n "$found" ]; then
    die "release ${found} is not a CLI release: it does not list ${archive}"
  fi
  die "could not read release metadata for $* from ${API_URL} (404 means no such release; 403 means GitHub's rate limit of 60 anonymous requests an hour, or a token it refused: wait, or set SELF_HOST_GITHUB_TOKEN)"
}

download_failed() {
  if http_error 403; then
    die "could not download $1 from $2 (a 403 means GitHub's rate limit; wait, or set SELF_HOST_GITHUB_TOKEN)"
  fi
  die "could not download $1 from $2"
}

skill_hint() {
  say "To make the self-host skill discoverable by your AI agents, run:"
  say "  self-host skill install"
  say "or paste this into your AI:"
  say "  Install the self-host skill from github.com/${REPO} and help me set up my own home server."
}

# offer_skill asks over the terminal, never over stdin (which is the download
# when piped), and only when a terminal can be opened. Without one, or with no
# answer within a minute (a scheduled task can have a terminal and nobody at
# it), it prints the hint. A failure here never fails an install that already
# succeeded.
offer_skill() {
  local tty="${SELF_HOST_TTY:-/dev/tty}" answer="" installed_binary="$1"
  if [ -z "${SELF_HOST_SKIP_SKILL_PROMPT:-}" ] && { exec 3<"$tty"; } 2>/dev/null; then
    printf 'Add the self-host skill to your AI agent too? y/n '
    read -r -t 60 answer <&3 || answer=""
    say
    case "$answer" in y | Y | yes | YES | Yes)
      say "Running: ${installed_binary} skill install"
      if "$installed_binary" skill install <&3; then
        exec 3<&-
        return
      fi
      say "That did not finish."
      ;;
    esac
    exec 3<&-
  fi
  skill_hint
}

# docker_socket_warning only reads: it never runs sudo or changes groups, and
# a failing probe never fails the install.
docker_socket_warning() {
  local out
  out="$(docker info 2>&1 </dev/null)" || true
  case "$out" in
    *[Pp]ermission\ denied*)
      say "Warning: Docker is installed but your user may not use its socket (permission denied)."
      say "  Run: sudo \"\$(command -v self-host)\"   (the Project stays yours; ~/.local/bin is not on sudo's PATH)."
      say "  Or use rootless Docker (no root; some Apps lose low ports, host networking or devices)."
      say "  The docker group works but gives root-equivalent access without a password: sudo usermod -aG docker \$USER"
      ;;
  esac
}

main() {
  command -v curl >/dev/null 2>&1 || command -v wget >/dev/null 2>&1 || die "curl or wget is required but neither was found"
  need tar
  need uname
  configure

  local os arch tag version archive dir expected actual metadata asset_id name members
  os="$(detect_os)"
  arch="$(detect_arch)"
  case "${os}_${arch}" in
    linux_amd64 | linux_arm64 | darwin_amd64 | darwin_arm64) ;;
    *) die "no release is built for ${os}/${arch}" ;;
  esac

  if [ -n "${SELF_HOST_VERSION:-}" ]; then
    case "$SELF_HOST_VERSION" in
      new-cli-v*) version="${SELF_HOST_VERSION#new-cli-v}" ;;
      v*) version="${SELF_HOST_VERSION#v}" ;;
      *) version="$SELF_HOST_VERSION" ;;
    esac
    valid_version "$version" || die "expected a stable X.Y.Z version, vX.Y.Z or new-cli-vX.Y.Z tag"
    archive="self-host_${version}_${os}_${arch}.tar.gz"
    tmp="$(mktemp -d)"
    trap cleanup EXIT
    case "$SELF_HOST_VERSION" in
      new-cli-v*) resolve_release "$archive" "new-cli-v${version}" ;;
      *) resolve_release "$archive" "v${version}" "new-cli-v${version}" ;;
    esac
  else
    tmp="$(mktemp -d)"
    trap cleanup EXIT
    tag="$(latest_tag)"
    case "$tag" in new-cli-v*) version="${tag#new-cli-v}" ;; *) version="${tag#v}" ;; esac
    archive="self-host_${version}_${os}_${arch}.tar.gz"
    resolve_release "$archive" "$tag"
  fi
  dir="$(install_dir)"

  say "Downloading self-host ${version} for ${os}/${arch}"
  for name in "$archive" checksums.txt; do
    if with_token; then
      asset_id="$(printf '%s' "$metadata" | json_values "$name" asset)"
      [[ "$asset_id" =~ ^[1-9][0-9]*$ ]] || die "release ${tag} does not list ${name}"
      api_get "${API_URL}/releases/assets/${asset_id}" application/octet-stream > "${tmp}/${name}" || download_failed "$name" "${API_URL}/releases/assets/${asset_id}"
    else
      api_get "${WEB_URL}/releases/download/${tag}/${name}" application/octet-stream > "${tmp}/${name}" || download_failed "$name" "${WEB_URL}/releases/download/${tag}/${name}"
    fi
    [ -s "${tmp}/${name}" ] || die "downloaded ${name} is empty; nothing was installed"
  done

  expected="$(awk -v name="$archive" '$2 == name || $2 == "*" name { count++; digest=$1 } END { if (count == 1) print digest }' "${tmp}/checksums.txt")"
  [[ "$expected" =~ ^[a-fA-F0-9]{64}$ ]] || die "checksums.txt must list exactly one valid SHA256 for ${archive}"
  expected="$(printf '%s' "$expected" | tr 'A-F' 'a-f')"
  actual="$(sha256_of "${tmp}/${archive}")"
  if [ "$expected" != "$actual" ]; then
    die "checksum mismatch for ${archive}: expected ${expected}, got ${actual}; nothing was installed"
  fi

  # A checksum-valid archive must still contain one ordinary binary, never a link.
  members="$(tar -tvzf "${tmp}/${archive}" self-host)" || die "cannot inspect self-host in ${archive}"
  printf '%s\n' "$members" | awk '{ count++; if (substr($0, 1, 1) != "-") invalid=1 } END { exit (count != 1 || invalid) }' ||
    die "${archive} must contain exactly one regular self-host binary; links are unsupported"
  tar -xzf "${tmp}/${archive}" -C "$tmp" self-host ||
    die "${archive} does not contain a self-host binary"
  [ -f "${tmp}/self-host" ] && [ ! -L "${tmp}/self-host" ] || die "${archive} does not contain a regular self-host binary"
  mkdir -p "$dir" || die "cannot create ${dir}"
  [ -w "$dir" ] || die "cannot write to ${dir}; rerun with sudo or set SELF_HOST_INSTALL_DIR"
  # Install next to the target and rename, so a running self-host is replaced atomically.
  staging="$(mktemp "${dir}/.self-host.new.XXXXXX")" || die "cannot create an install staging file in ${dir}"
  cp "${tmp}/self-host" "$staging" || die "cannot write ${staging}"
  chmod 0755 "$staging" || die "cannot make ${staging} executable"
  mv -f "$staging" "${dir}/self-host" || die "cannot replace ${dir}/self-host"
  staging=""

  say "Installed ${dir}/self-host (${version}, checksum verified)"
  case ":${PATH}:" in
    *":${dir}:"*) ;;
    *) path_help "$dir" ;;
  esac
  if command -v docker >/dev/null 2>&1; then
    docker_socket_warning
  else
    say "Warning: Docker was not found. Install Docker with the Compose v2 plugin before deploying; self-host doctor checks it."
  fi
  say
  say "Next: run  self-host  for the dashboard, or  self-host install media --yes  for the media server."
  say
  offer_skill "${dir}/self-host"
}

main "$@"
