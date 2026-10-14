#!/usr/bin/env bash
# Install the self-host CLI.
#
#   curl -fsSL https://self-host.fyi/install | bash
#
# Installs to ~/.local/bin, or /usr/local/bin when run as root.
# Environment:
#   SELF_HOST_VERSION      install this version (1.2.0, v1.2.0 or new-cli-v1.2.0) instead of the latest
#   SELF_HOST_INSTALL_DIR  install here instead of the default directory
#   SELF_HOST_GITHUB_TOKEN GitHub token to lift the anonymous API rate limit; defaults to `gh auth token` when gh is logged in
#   SELF_HOST_RELEASE_REPO owner/name of the repository that publishes releases (default below)
#   SELF_HOST_RELEASES_URL, SELF_HOST_WEB_URL  alternative API and github.com roots
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
API_URL=""
WEB_URL=""
tmp=""
staging=""

configure() {
  REPO="${SELF_HOST_RELEASE_REPO:-$DEFAULT_REPO}"
  [[ "$REPO" =~ ^[A-Za-z0-9_-][A-Za-z0-9_.-]*/[A-Za-z0-9_.-]+$ && "$REPO" != *..* && "$REPO" != */. ]] || die "SELF_HOST_RELEASE_REPO must look like owner/name, not '${REPO}'"
  # Optional GitHub token for a higher API rate limit. Tokens stay out of process arguments.
  TOKEN="${SELF_HOST_GITHUB_TOKEN:-}"
  if [ -z "$TOKEN" ] && [ -z "${SELF_HOST_RELEASES_URL:-}" ] && command -v gh >/dev/null 2>&1; then
    TOKEN="$(gh auth token 2>/dev/null || true)"
  fi
  case "$TOKEN" in *[!a-zA-Z0-9_.-]*) die "invalid token format" ;; esac
  API_URL="${SELF_HOST_RELEASES_URL:-https://api.github.com/repos/${REPO}}"
  WEB_URL="${SELF_HOST_WEB_URL:-https://github.com/${REPO}}"
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
    function ws() { while (substr(input,pos,1) ~ /[[:space:]]/) pos++ }
    function string_value( value,c,escape) {
      if (substr(input,pos++,1) != "\"") fail()
      value=""
      while (pos<=length(input)) {
        c=substr(input,pos++,1)
        if (c == "\"") return value
        if (c == "\\") {
          escape=substr(input,pos++,1)
          if (escape == "u") {
            c=substr(input,pos,4)
            if (length(c)!=4 || c ~ /[^0-9a-fA-F]/) fail()
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
      if (substr(input,pos,1) != "}") {
        while (1) {
          ws(); field=string_value(); ws()
          if (substr(input,pos++,1) != ":") fail()
          value=parse_value(); values[depth,field]=value; ws()
          if (substr(input,pos,1) == "}") break
          if (substr(input,pos++,1) != ",") fail()
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
      if (substr(input,pos,1) != "]") {
        while (1) {
          parse_value(); ws()
          if (substr(input,pos,1) == "]") break
          if (substr(input,pos++,1) != ",") fail()
        }
      }
      pos++; return ""
    }
    function parse_value( c,value) {
      ws(); c=substr(input,pos,1)
      if (c == "{") return object_value()
      if (c == "[") return array_value()
      if (c == "\"") return string_value()
      value=""
      while (pos<=length(input) && substr(input,pos,1) !~ /[][:space:],}]/) value=value substr(input,pos++,1)
      if (value !~ /^(true|false|null)$/ && value !~ /^-?(0|[1-9][0-9]*)(\.[0-9]+)?([eE][+-]?[0-9]+)?$/) fail()
      return value
    }
    { input=input $0 "\n" }
    END {
      if (invalid) exit 1
      pos=1; ws()
      if ((mode=="tags" || mode=="count") && substr(input,pos,1)!="[") fail()
      if ((mode=="asset" || mode=="assetname" || mode=="tag") && substr(input,pos,1)!="{") fail()
      parse_value(); ws()
      if (pos<=length(input) || invalid) exit 1
      if (mode=="count") print count+0
      else printf "%s",output
    }'
}

api_get() {
  if [ -n "$TOKEN" ]; then
    printf 'header = "Authorization: Bearer %s"\n' "$TOKEN" |
      curl --config - -fsSL -H "Accept: $2" "$1"
  else
    curl -fsSL -H "Accept: $2" "$1"
  fi
}

valid_version() {
  [[ "$1" =~ ^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$ ]]
}

# A CLI release is tagged vX.Y.Z or new-cli-vX.Y.Z and carries the self-host
# archives and checksums.txt (json_values filters on that), which keeps the
# legacy skill-pack releases out whatever their version.
latest_tag() {
  local body page count candidates="" tag version
  for page in {1..10}; do
    body="$(api_get "${API_URL}/releases?per_page=100&page=${page}" application/vnd.github+json)" ||
      die "could not look up CLI releases from ${API_URL} (403 is GitHub's anonymous limit of 60 requests an hour: wait, or set SELF_HOST_GITHUB_TOKEN)"
    while IFS= read -r tag; do
      case "$tag" in new-cli-v*) version="${tag#new-cli-v}" ;; v*) version="${tag#v}" ;; *) continue ;; esac
      if valid_version "$version"; then candidates="${candidates}${version} ${tag}"$'\n'; fi
    done < <(printf '%s' "$body" | json_values)
    count="$(printf '%s' "$body" | json_values "" count)" || die "invalid release-list JSON"
    if [ "$count" -lt 100 ]; then
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
  die "could not read release metadata for $* from ${API_URL} (404 means no such release; 403 is GitHub's anonymous rate limit, set SELF_HOST_GITHUB_TOKEN)"
}

skill_command() {
  if command -v bunx >/dev/null 2>&1; then
    echo bunx --bun skills@latest add "$REPO" --skill self-host
  elif command -v npx >/dev/null 2>&1; then
    echo npx --yes skills add "$REPO" --skill self-host
  fi
}

skill_hint() {
  say "To add the self-host skill to your AI agent (needs Bun or Node.js), run:"
  say "  bunx --bun skills@latest add ${REPO} --skill self-host"
  say "or paste this into your AI:"
  say "  Install the self-host skill from github.com/${REPO} and help me run my own movie server."
}

# offer_skill asks over the terminal, never over stdin (which is the download
# when piped), and only when a terminal can be opened. Without one it prints
# the hint. A failure here never fails an install that already succeeded.
offer_skill() {
  local tty="${SELF_HOST_TTY:-/dev/tty}" answer="" command_line
  if [ -z "${SELF_HOST_SKIP_SKILL_PROMPT:-}" ] && { exec 3<"$tty"; } 2>/dev/null; then
    printf 'Add the self-host skill to your AI agent too? y/n '
    read -r answer <&3 || answer=""
    say
    case "$answer" in y | Y | yes | YES | Yes)
      command_line="$(skill_command)"
      if [ -n "$command_line" ]; then
        say "Running: ${command_line}"
        # shellcheck disable=SC2086
        if $command_line <&3; then
          exec 3<&-
          return
        fi
        say "That did not finish."
      fi
      ;;
    esac
    exec 3<&-
  fi
  skill_hint
}

main() {
  need curl
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
    if [ -n "$TOKEN" ]; then
      asset_id="$(printf '%s' "$metadata" | json_values "$name" asset)"
      [[ "$asset_id" =~ ^[1-9][0-9]*$ ]] || die "release ${tag} does not list ${name}"
      api_get "${API_URL}/releases/assets/${asset_id}" application/octet-stream > "${tmp}/${name}" || die "could not download ${name} from ${API_URL}/releases/assets/${asset_id}"
    else
      curl -fsSL -o "${tmp}/${name}" "${WEB_URL}/releases/download/${tag}/${name}" || die "could not download ${name} from ${WEB_URL}/releases/download/${tag}/${name}"
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
  command -v docker >/dev/null 2>&1 ||
    say "Warning: Docker was not found. Install Docker with the Compose v2 plugin before deploying; self-host doctor checks it."
  say
  say "Next: run  self-host  for the dashboard, or  self-host install media --yes  for the media server."
  say
  offer_skill
}

main "$@"
