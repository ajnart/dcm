#!/usr/bin/env bash
# Install the self-host CLI.
#
#   curl -fsSL https://raw.githubusercontent.com/ajnart/selfhost-skills/main/new-cli/install.sh | bash
#
# Installs to ~/.local/bin, or /usr/local/bin when run as root.
# Environment:
#   SELF_HOST_VERSION      install this version or tag (1.2.0 or new-cli-v1.2.0) instead of the latest
#   SELF_HOST_INSTALL_DIR  install here instead of the default directory
#   SELF_HOST_GITHUB_TOKEN token for the private repository; defaults to `gh auth token` when gh is logged in
#   SELF_HOST_RELEASES_URL, SELF_HOST_WEB_URL  alternative API and github.com roots
set +x
set -euo pipefail
# Optional private-repository access. Tokens stay out of process arguments.
TOKEN="${SELF_HOST_GITHUB_TOKEN:-}"
if [ -z "$TOKEN" ] && [ -z "${SELF_HOST_RELEASES_URL:-}" ] && command -v gh >/dev/null 2>&1; then
  TOKEN="$(gh auth token 2>/dev/null || true)"
fi
case "$TOKEN" in *[!a-zA-Z0-9_.-]*) printf "%s\n" "install.sh: invalid token format" >&2; exit 1 ;; esac

REPO="ajnart/selfhost-skills"
API_URL="${SELF_HOST_RELEASES_URL:-https://api.github.com/repos/${REPO}}"
WEB_URL="${SELF_HOST_WEB_URL:-https://github.com/${REPO}}"

tmp=""
staging=""
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
  awk -v wanted="${1:-}" -v mode="${2:-tags}" '
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
      if (depth==1 && tag!="") {
        count++
        if ((mode=="tags" || mode=="tag") && values[depth,"draft"]!="true" && values[depth,"prerelease"]!="true") output=output tag "\n"
      }
      if (depth==2 && mode=="asset" && values[depth,"name"]==wanted) output=output values[depth,"id"] "\n"
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
      if ((mode=="asset" || mode=="tag") && substr(input,pos,1)!="{") fail()
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

latest_tag() {
  local body page count candidates="" tag version
  for page in {1..10}; do
    body="$(api_get "${API_URL}/releases?per_page=100&page=${page}" application/vnd.github+json)" ||
      die "could not look up CLI releases (404 means no access to the private repository); run 'gh auth login' or set SELF_HOST_GITHUB_TOKEN"
    while IFS= read -r tag; do
      case "$tag" in new-cli-v*) version="${tag#new-cli-v}" ;; *) continue ;; esac
      if valid_version "$version"; then candidates="${candidates}${version}"$'\n'; fi
    done < <(printf '%s' "$body" | json_values)
    count="$(printf '%s' "$body" | json_values "" count)" || die "invalid release-list JSON"
    if [ "$count" -lt 100 ]; then
      version="$(printf '%s' "$candidates" | sed '/^$/d' | sort -t . -k1,1n -k2,2n -k3,3n | tail -n 1)"
      [ -n "$version" ] || die "no stable new-cli-v release is published"
      printf 'new-cli-v%s\n' "$version"
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

main() {
  need curl
  need tar
  need uname

  local os arch tag version archive dir expected actual metadata asset_id name members
  os="$(detect_os)"
  arch="$(detect_arch)"
  case "${os}_${arch}" in
    linux_amd64 | linux_arm64 | darwin_amd64 | darwin_arm64) ;;
    *) die "no release is built for ${os}/${arch}" ;;
  esac

  tag="${SELF_HOST_VERSION:-$(latest_tag)}"
  case "$tag" in new-cli-v*) version="${tag#new-cli-v}" ;; *) version="$tag"; tag="new-cli-v${tag}" ;; esac
  valid_version "$version" || die "expected a stable X.Y.Z version or new-cli-vX.Y.Z tag"
  archive="self-host_${version}_${os}_${arch}.tar.gz"
  dir="$(install_dir)"

  tmp="$(mktemp -d)"
  trap cleanup EXIT

  say "Downloading self-host ${version} for ${os}/${arch}"
  metadata="$(api_get "${API_URL}/releases/tags/${tag}" application/vnd.github+json)" || die "could not read release metadata for ${tag}"
  [ "$(printf '%s' "$metadata" | json_values "" tag)" = "$tag" ] || die "release metadata does not match requested stable CLI tag"
  for name in "$archive" checksums.txt; do
    if [ -n "$TOKEN" ]; then
      asset_id="$(printf '%s' "$metadata" | json_values "$name" asset)"
      [[ "$asset_id" =~ ^[1-9][0-9]*$ ]] || die "release ${tag} does not list ${name}"
      api_get "${API_URL}/releases/assets/${asset_id}" application/octet-stream > "${tmp}/${name}" || die "could not download ${name}"
    else
      curl -fsSL -o "${tmp}/${name}" "${WEB_URL}/releases/download/${tag}/${name}" || die "could not download ${name}"
    fi
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
    *) say "Warning: ${dir} is not on your PATH. Add it, for example:  export PATH=\"${dir}:\$PATH\"" ;;
  esac
  command -v docker >/dev/null 2>&1 ||
    say "Warning: Docker was not found. Install Docker with the Compose v2 plugin before deploying; self-host doctor checks it."
  say
  say "Next: run  self-host  for the dashboard, or  self-host install media --yes  for the media server."
  say "For an AI agent: bunx --bun skills@latest add ajnart/selfhost-skills --skill self-host, then ask it to self-host something."
}

main "$@"
