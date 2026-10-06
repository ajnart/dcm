#!/usr/bin/env bash
# Install the self-host CLI.
#
#   curl -fsSL https://raw.githubusercontent.com/ajnart/self-host/main/install.sh | bash
#
# Installs to ~/.local/bin, or /usr/local/bin when run as root.
# Environment:
#   SELF_HOST_VERSION      install this tag (for example v1.2.0) instead of the latest
#   SELF_HOST_INSTALL_DIR  install here instead of the default directory
set -euo pipefail

REPO="ajnart/self-host"
API_URL="${SELF_HOST_RELEASES_URL:-https://api.github.com/repos/${REPO}}"
DOWNLOAD_URL="${SELF_HOST_DOWNLOAD_URL:-https://github.com/${REPO}/releases/download}"

tmp=""
cleanup() {
  if [ -n "$tmp" ]; then
    rm -rf "$tmp"
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

latest_tag() {
  local body tag
  body="$(curl -fsSL -H 'Accept: application/vnd.github+json' "${API_URL}/releases/latest")" ||
    die "could not look up the latest release at ${API_URL}"
  tag="$(printf '%s' "$body" | sed -n 's/.*"tag_name"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -n 1)"
  [ -n "$tag" ] || die "the release lookup returned no tag"
  echo "$tag"
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

  local os arch tag version archive dir expected actual
  os="$(detect_os)"
  arch="$(detect_arch)"
  case "${os}_${arch}" in
    linux_amd64 | linux_arm64 | darwin_arm64) ;;
    *) die "no release is built for ${os}/${arch}" ;;
  esac

  tag="${SELF_HOST_VERSION:-$(latest_tag)}"
  case "$tag" in v*) ;; *) tag="v${tag}" ;; esac
  version="${tag#v}"
  archive="self-host_${version}_${os}_${arch}.tar.gz"
  dir="$(install_dir)"

  tmp="$(mktemp -d)"
  trap cleanup EXIT

  say "Downloading self-host ${version} for ${os}/${arch}"
  curl -fsSL -o "${tmp}/${archive}" "${DOWNLOAD_URL}/${tag}/${archive}" ||
    die "could not download ${archive}"
  curl -fsSL -o "${tmp}/checksums.txt" "${DOWNLOAD_URL}/${tag}/checksums.txt" ||
    die "could not download checksums.txt"

  expected="$(awk -v name="$archive" '$2 == name || $2 == "*" name { print $1; exit }' "${tmp}/checksums.txt")"
  [ -n "$expected" ] || die "checksums.txt does not list ${archive}"
  actual="$(sha256_of "${tmp}/${archive}")"
  if [ "$expected" != "$actual" ]; then
    die "checksum mismatch for ${archive}: expected ${expected}, got ${actual}; nothing was installed"
  fi

  tar -xzf "${tmp}/${archive}" -C "$tmp" self-host ||
    die "${archive} does not contain a self-host binary"
  mkdir -p "$dir" || die "cannot create ${dir}"
  [ -w "$dir" ] || die "cannot write to ${dir}; rerun with sudo or set SELF_HOST_INSTALL_DIR"
  # Install next to the target and rename, so a running self-host is replaced atomically.
  cp "${tmp}/self-host" "${dir}/.self-host.new"
  chmod 0755 "${dir}/.self-host.new"
  mv -f "${dir}/.self-host.new" "${dir}/self-host"

  say "Installed ${dir}/self-host (${version}, checksum verified)"
  case ":${PATH}:" in
    *":${dir}:"*) ;;
    *) say "Warning: ${dir} is not on your PATH. Add it, for example:  export PATH=\"${dir}:\$PATH\"" ;;
  esac
  say
  say "Next: run  self-host  for the dashboard, or  self-host install media --yes  for the media server."
}

main "$@"
