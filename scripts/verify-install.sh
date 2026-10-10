#!/usr/bin/env bash
# Repeatable check of the documented one-line install. Repository tooling, not
# part of the shipped binary or the release.
#
# It runs the exact one-liner,  curl -fsSL <raw install.sh URL> | bash,  in a
# throwaway HOME with SELF_HOST_INSTALL_DIR inside the sandbox, then asserts:
#   1. self-host --version equals the latest published CLI release
#   2. self-host skill works
#   3. a pinned old version (SELF_HOST_VERSION, default 0.1.2) upgrades to the
#      latest through  self-host self-update
#
# Environment:
#   SELF_HOST_GITHUB_TOKEN   only while the repository is private. Sent as a
#                            curl header for the raw URL and passed to the
#                            installer; never printed. Once the repository is
#                            public, run this with no token.
#   VERIFY_INSTALL_URL       the URL to pipe into bash. Defaults to the raw
#                            install.sh on main. A file:// URL tests a local
#                            script before it is pushed.
#   SELF_HOST_RELEASE_REPO   repository that publishes the releases
#   VERIFY_PINNED_VERSION    the old version to upgrade from (default 0.1.2)
#   VERIFY_EXPECTED_VERSION  skip the release lookup and expect this version
#
# Needs curl, bash, tar and python3.
set +x
set -euo pipefail

REPO="${SELF_HOST_RELEASE_REPO:-ajnart/selfhost-skills}"
URL="${VERIFY_INSTALL_URL:-https://raw.githubusercontent.com/${REPO}/main/install.sh}"
PINNED="${VERIFY_PINNED_VERSION:-0.1.2}"
TOKEN="${SELF_HOST_GITHUB_TOKEN:-}"

sandbox="$(mktemp -d "${TMPDIR:-/tmp}/self-host-verify.XXXXXX")"
trap 'rm -rf "$sandbox"' EXIT
mkdir -p "$sandbox/home"

failures=0
pass() { printf 'PASS  %s\n' "$*"; }
fail() {
  printf 'FAIL  %s\n' "$*" >&2
  failures=$((failures + 1))
}

# A token file keeps the secret out of process arguments and the output.
curl_config="$sandbox/curl.conf"
: >"$curl_config"
chmod 600 "$curl_config"
if [ -n "$TOKEN" ]; then
  printf 'header = "Authorization: Bearer %s"\n' "$TOKEN" >"$curl_config"
fi

# sandboxed runs a command with the sandbox HOME and nothing of the person's
# own login. Without a token it also hides gh, so a logged-in gh cannot make a
# public-repository run pass for the wrong reason.
sandboxed() {
  if [ -n "$TOKEN" ]; then
    env -i HOME="$sandbox/home" PATH="$PATH" SHELL=/bin/bash TMPDIR="$sandbox" \
      SELF_HOST_GITHUB_TOKEN="$TOKEN" SELF_HOST_RELEASE_REPO="$REPO" "$@"
  else
    env -i HOME="$sandbox/home" PATH="$PATH" SHELL=/bin/bash TMPDIR="$sandbox" \
      GH_HOST=gh.invalid SELF_HOST_RELEASE_REPO="$REPO" "$@"
  fi
}

# one_liner is the documented command, exactly, with the token header added
# only for a private repository.
one_liner() {
  local install_dir="$1"
  shift
  sandboxed SELF_HOST_INSTALL_DIR="$install_dir" "$@" \
    bash -c 'curl -fsSL -K "$0" "$1" | bash' "$curl_config" "$URL"
}

expected_version() {
  if [ -n "${VERIFY_EXPECTED_VERSION:-}" ]; then
    printf '%s\n' "$VERIFY_EXPECTED_VERSION"
    return
  fi
  curl -fsSL -K "$curl_config" -H 'Accept: application/vnd.github+json' \
    "https://api.github.com/repos/${REPO}/releases?per_page=100" |
    python3 -I -c '
import json, re, sys
best = None
for rel in json.load(sys.stdin):
    if rel.get("draft") or rel.get("prerelease"):
        continue
    m = re.fullmatch(r"(?:new-cli-)?v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)", rel["tag_name"])
    if not m:
        continue
    version = ".".join(m.groups())
    names = {a["name"] for a in rel.get("assets", [])}
    if "checksums.txt" not in names or not any(n.startswith("self-host_%s_" % version) and n.endswith(".tar.gz") for n in names):
        continue
    key = tuple(int(g) for g in m.groups())
    if best is None or key > best[0]:
        best = (key, version)
if best is None:
    sys.exit("no published CLI release found")
print(best[1])'
}

echo "Installer:  $URL"
echo "Repository: $REPO ($([ -n "$TOKEN" ] && echo 'with a token' || echo 'no token'))"
latest="$(expected_version)"
echo "Latest CLI release: $latest"
echo

# 1 and 2: a fresh install of the latest release.
latest_dir="$sandbox/latest/bin"
if output="$(one_liner "$latest_dir" 2>&1)"; then
  pass "curl | bash installed into the sandbox"
else
  fail "curl | bash failed:"
  printf '%s\n' "$output" | sed 's/^/      /' >&2
fi
if [ -x "$latest_dir/self-host" ]; then
  got="$(sandboxed "$latest_dir/self-host" --version 2>&1 || true)"
  if [ "$got" = "$latest" ]; then pass "self-host --version is $got, the latest release"; else fail "self-host --version is '$got', want $latest"; fi
  if sandboxed "$latest_dir/self-host" skill 2>/dev/null | grep -q .; then pass "self-host skill prints the guide"; else fail "self-host skill printed nothing or failed"; fi
  case "$output" in
    *"not on your PATH"*) pass "the installer said how to put $latest_dir on PATH" ;;
    *) fail "the installer did not explain PATH for a directory that is not on it" ;;
  esac
else
  fail "no binary at $latest_dir/self-host"
fi

# 3: a pinned old version upgrades itself.
pinned_dir="$sandbox/pinned/bin"
if [ "$PINNED" = "$latest" ]; then
  echo "SKIP  pinned $PINNED is already the latest release"
elif output="$(one_liner "$pinned_dir" SELF_HOST_VERSION="$PINNED" 2>&1)"; then
  got="$(sandboxed "$pinned_dir/self-host" --version 2>&1 || true)"
  if [ "$got" = "$PINNED" ]; then pass "SELF_HOST_VERSION=$PINNED installed $got"; else fail "pinned install reports '$got', want $PINNED"; fi
  if update="$(sandboxed "$pinned_dir/self-host" self-update 2>&1)"; then
    got="$(sandboxed "$pinned_dir/self-host" --version 2>&1 || true)"
    if [ "$got" = "$latest" ]; then pass "self-host self-update upgraded $PINNED to $got"; else fail "after self-update --version is '$got', want $latest"; fi
  else
    fail "self-host self-update failed:"
    printf '%s\n' "$update" | sed 's/^/      /' >&2
  fi
else
  fail "pinned install of $PINNED failed:"
  printf '%s\n' "$output" | sed 's/^/      /' >&2
fi

echo
if [ "$failures" -eq 0 ]; then
  echo "verify-install: all checks passed"
else
  echo "verify-install: $failures check(s) failed" >&2
  exit 1
fi
