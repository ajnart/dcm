# HAProxy 3.2.25 explicit same-owner compiler

The app now has an executable pure configuration/recipe compiler and a bounded
setup adapter, not a static readiness-only recipe. No deployment, image pull,
Docker command, live authentication, routed request or restart was performed.
No API key is declared or invented. Support remains discovery.

The compiler is a source-checkout helper: its shared-owner import is resolved
from this repository layout. It is not a command for a standalone installed
skill copy. The CLI build bundles setup dependencies, but publishing the
generated-selection interface remains the prerequisite below.

## Implemented behavior

`apps/haproxy/configuration.ts` takes the exact loaded completed shared state
and an explicitly selected frontend app ID through `resolveSharedServiceTarget`.
It rejects absent/helper/arbitrary targets and self-proxying, and emits a real
HTTP backend using that service's actual Docker DNS name and container port.
The exact same-owner `front` bridge must be joined by the generated HAProxy unit;
the compiler does not authorize a new/external bridge or public listener.

The returned recipe keeps host publication loopback-only, the publisher's
UID/GID 99, and a read-only configuration mount. Only this non-secret config
uses publisher-evidenced `readability: container` (0644 under the unchanged 0700
owner parent). The generated administrator password and bcrypt hash env file
reuse existing 0600 owner facilities. Config contains only the declared
weak-quoted `$HAPROXY_ADMIN_AUTH_HASH` reference, never its value or plaintext.
The hash remains visible to Docker operators through container environment.
Authentication protects read-only statistics; no statistics admin action or
runtime control socket is enabled. The application route retains its own auth.

Binding includes owner/target fingerprints, config bytes SHA-256, recipe/config
fingerprint and target-specific statistics backend name. Rechecking against
changed owner/target/config requires a newly reviewed selection, not a repair.

`setup.ts` runs only fixed `haproxy -c -f /usr/local/etc/haproxy/haproxy.cfg`,
then requires anonymous statistics 401 and saved-password authenticated CSV
containing exactly one selected backend/server row with status UP. These prove
syntax, configured statistics auth and a TCP check only. Returned evidence keeps
forwarded traffic, restart persistence and API-key creation explicitly false.

## Exact remaining root interface

There is deliberately no `recipe.json` with a guessed/default/inert backend.
The static catalog contract has no required pre-plan same-owner target input.
The central generated-recipe owner must:

1. Require one explicit target app before plan; call
   `compileHaproxyConfiguration(state, targetAppId)` with its loaded state.
2. Bind both returned exact recipe and `binding` into selected-add approval,
   connect the unit to the returned same-owner front bridge, resolve the
   HAProxy 3.2.25 image digest, and persist immutable recipe/binding bytes.
3. Call `assertHaproxyTargetUnchanged` before approved apply; restore the exact
   saved generated selection on replay rather than fresh compilation/defaults.
4. Supply saved `binding` as non-secret `status.haproxyConfiguration` to setup.
   Missing metadata fails closed before container or HTTP calls. A typed
   central generated-binding status field can replace that app-owned field.

Stats UP is not full acceptance. A later selected peer's source-backed content
contract must validate actual proxied application traffic and restart behavior.

## Pinned primary evidence

- [HAProxy 3.2.25 manual](https://docs.haproxy.org/3.2/configuration.html):
  quoting section 2.2 supports weak-quoted environment expansion; userlists
  section 12.2 uses `password` with system crypt(3). `http_auth`,
  `stats http-request auth`, Docker DNS resolver and `init-addr none` are the
  selected directives. Manual title was verified as 3.2.25 on 2026-10-03.
- [Pinned publisher Dockerfile](https://raw.githubusercontent.com/docker-library/haproxy/60e87b92f7a36f502cd71911c9a6c39220ba1424/3.2/Dockerfile):
  HAProxy 3.2.25 on Debian Trixie/glibc, UID/GID 99, config directory and entry
  command. BCrypt/system-crypt runtime compatibility remains a live auth check;
  the focused synthetic fixture does not claim it.
- [Exact 3.2.25 source archive](https://www.haproxy.org/download/3.2/src/haproxy-3.2.25.tar.gz):
  `src/stats-html.c:368` emits CSV links as `<stats-uri>;csv`, not an encoded
  query parameter. Setup uses this fixed path; frontend routes exactly base
  stats and CSV paths to the authenticated statistics backend.
- Context7 `library HAProxy` then `docs /haproxy/haproxy` independently
  supplied userlist, weak-quoted environment and resolver syntax. Version-matched
  manual/archive and pinned publisher source take precedence over master snippets.

## Focused validation

`packages/cli/tests/haproxy-configuration.test.ts` covers deterministic
non-mutating compilation, real selected DNS/port, no default Homarr, owner/target
drift, malformed binding, exact fixed syntax argv and CSV URL, anonymous denial,
failed auth/syntax and unique UP row checks. These are synthetic fixtures only.
No Docker, CI, broad test suite, credentials/session reads or deployment runs.
