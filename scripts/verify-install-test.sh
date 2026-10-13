#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd -P)"
fixture="$(mktemp -d "${TMPDIR:-/tmp}/verify-install-test.XXXXXX")"
trap 'rm -rf "$fixture"' EXIT
mkdir -p "$fixture/bin" "$fixture/tmp" "$fixture/home"

real_path="$PATH"
run_verifier() {
  env -i HOME="$fixture/home" TMPDIR="$fixture/tmp" PATH="$fixture/bin:$real_path" \
    VERIFY_INSTALL_TIMEOUT=2 "$root/scripts/verify-install.sh" 2>&1
}

cat >"$fixture/bin/curl" <<'SH'
#!/usr/bin/env bash
case "$*" in
  *api.github.com*/releases*)
    while [ "$#" -gt 0 ]; do
      if [ "$1" = -o ]; then shift; : >"$1"; fi
      shift
    done
    printf '403'
    ;;
  *) exit 1 ;;
esac
SH
chmod 0755 "$fixture/bin/curl"

if output="$(run_verifier)"; then
  printf 'expected failed release discovery\n' >&2
  exit 1
fi
case "$output" in
  *"release discovery"*"403"*"rate limit"*) ;;
  *) printf 'missing classified discovery error:\n%s\n' "$output" >&2; exit 1 ;;
esac
case "$output" in
  *Traceback* | *JSONDecodeError*) printf 'leaked parser traceback:\n%s\n' "$output" >&2; exit 1 ;;
esac

sed -i 's/printf '\''403'\''/printf '\''404'\''/' "$fixture/bin/curl"
if output="$(run_verifier)"; then
  printf 'expected missing release metadata failure\n' >&2
  exit 1
fi
case "$output" in
  *"release discovery got HTTP 404"*"private or missing"*) ;;
  *) printf 'missing private or missing classification:\n%s\n' "$output" >&2; exit 1 ;;
esac

cat >"$fixture/bin/curl" <<'SH'
#!/usr/bin/env bash
case "$*" in
  *api.github.com*/releases*)
    output=""
    while [ "$#" -gt 0 ]; do
      if [ "$1" = -o ]; then shift; output="$1"; fi
      shift
    done
    printf '%s\n' '{not-json' >"$output"
    printf '200'
    ;;
  *) exit 1 ;;
esac
SH
chmod 0755 "$fixture/bin/curl"
if output="$(run_verifier)"; then
  printf 'expected invalid release metadata failure\n' >&2
  exit 1
fi
case "$output" in
  *"release discovery returned invalid JSON"*) ;;
  *) printf 'missing invalid metadata classification:\n%s\n' "$output" >&2; exit 1 ;;
esac
case "$output" in
  *Traceback* | *JSONDecodeError*) printf 'leaked parser traceback:\n%s\n' "$output" >&2; exit 1 ;;
esac

cat >"$fixture/bin/curl" <<'SH'
#!/usr/bin/env bash
case "$*" in
  *api.github.com*/releases*)
    output=""
    while [ "$#" -gt 0 ]; do
      if [ "$1" = -o ]; then shift; output="$1"; fi
      shift
    done
    printf '%s\n' '[{"tag_name":"v0.2.0","assets":[{"name":"checksums.txt"},{"name":"self-host_0.2.0_linux_amd64.tar.gz"}]},{"tag_name":"v0.10.0","assets":[{"name":"checksums.txt"},{"name":"self-host_0.10.0_linux_amd64.tar.gz"}]},{"tag_name":"v9.0.0","prerelease":true,"assets":[{"name":"checksums.txt"},{"name":"self-host_9.0.0_linux_amd64.tar.gz"}]}]' >"$output"
    printf '200'
    ;;
  *self-host.fyi/install*) printf '%s\n' 'exit 1' ;;
  *) exit 1 ;;
esac
SH
chmod 0755 "$fixture/bin/curl"

if output="$(run_verifier)"; then
  printf 'fixture installer unexpectedly passed\n' >&2
  exit 1
fi
case "$output" in
  *"Latest CLI release: 0.10.0"*"FAIL  curl | bash failed"*"FAIL  pinned install"*) ;;
  *) printf 'valid metadata did not select latest and continue checks:\n%s\n' "$output" >&2; exit 1 ;;
esac

if find "$fixture/tmp" -maxdepth 1 -name 'self-host-verify.*' -print -quit | grep -q .; then
  printf 'verifier left disposable state behind\n' >&2
  exit 1
fi

printf 'verify-install fixtures: pass\n'
