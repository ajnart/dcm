# Runtime acceptance evidence

`E2E_TARGETS=all` selects 93 Apps and 20 Recipes (19 legacy Recipes plus
`media`). `testdata/inventory.json` is the explicit inventory checked against
the compiled Catalog. App/Recipe names in evidence are distinct, for example
`app-ntfy.json` and `recipe-media.json`.

Use a bounded batch after the Project lock, redaction, backup and restore fixes
are integrated:

```sh
GOCACHE=/tmp/selfhost-go-cache GOMODCACHE=/tmp/selfhost-go-modcache \
  E2E_TARGETS='app-ntfy app-vaultwarden' E2E_LOG_DIR=/tmp/selfhost-runtime-evidence \
  go test -tags e2e -run '^TestE2E$' -v -timeout 90m ./e2e/
```

The harness owns a mode-0600 OS lock in the system temporary directory through
all child cleanup. It defaults to serial execution; opt in with `E2E_PARALLEL=4`
and an explicit `E2E_LOG_DIR` to run up to four light single-App targets together.
The scheduler acquires the entire App count atomically, with a global ceiling
of 20. Recipes, multiservice Apps, known heavy Apps, and fixed/secondary-port
targets run exclusively. Source containers are removed before the isolated
restore environment starts. Capacity and the shared port registry remain owned
until both environments are successfully removed; teardown failure retains
that budget and blocks queued starts. CI defaults remain serial. Do not run
another Docker acceptance harness outside the OS lock during a sweep.

Each target has a distinct temporary directory and Compose project. Primary
ports are selected with live loopback socket reservations; published secondary
TCP/UDP ports are checked too. Leases are released immediately before Docker
binds them, while the shared registry reserves those ports through teardown. The global OS
lock excludes other harness processes, not unrelated external processes: an external port race is a
failed install, never a verified pass. Fixed-port targets remain serial and
record blocked when their required ports are unavailable. Only loopback source
port templates are accepted after resolving `${BIND_IP}`. Ambient Compose,
Host setting and catalog credential environment variables are excluded.

Every inventory target gets a JSON file before runtime begins. Existing
unselected evidence is retained across bounded batches; inspect its own `head`
and `binary_sha256` before combining results. Selected evidence is replaced by
its new run. Outcomes include `not-run`, `blocked`, `missing-configuration`,
`awaiting-external-credentials`, `manual`, `failed` and `pass`. Each lifecycle
stage has its own outcome, sanitized command and per-App result. A manual or
failed stage leaves subsequent stages `not-run`. Docker unavailability is
recorded as blocked and never becomes a runtime pass.

Stages: install; Setup/Check; idempotent Setup; restart; stop/start recovery;
update; backup; isolated restore; restored Setup/Check; filesystem sentinel.
Readiness requires exactly the expected Apps and Compose services, successful
Setup, healthy containers where checks exist, and running containers except
successful inert jobs. Evidence includes the exact built binary SHA-256, Git
head, host platform and immutable image IDs/platforms after update.

The backup sentinel is a harmless file in each App's archived folder. It
proves archive extraction into a fresh Project. App Setup/Check provides the
App's existing API/configuration acceptance. These probes **do not prove
application workload, database-content recovery, a version-to-version migration,
VPN fail-closed behavior, external SMTP/provider accounts, or browser/UI
acceptance**. Those require App-specific proof before broader release claims.
Restic/borgmatic use an isolated local repository setting but do not perform a
real backup workload through their own tools. Other required configuration and
credentials remain explicit prerequisites; this harness does not synthesize
them or enroll remote devices.

Ordinary evidence contains fixed errors, not raw stdout/stderr/logs. Optional
`E2E_PRIVATE_DIAGNOSTICS=1` saves private mode-0600 container logs under
`private/`; these may contain credentials and are excluded from CI artifacts.
CI uploads ordinary JSON for every outcome. No global Docker prune runs.

A failed scoped Compose teardown retains the Project directory, marks evidence
failed with its recovery path/Compose name, and stops the remaining sweep. A
private `selfhost-e2e-global.lock.blocked` marker blocks later harness processes
as well. Recover only that named Project using the retained Compose files;
remove the blocker only after its owned containers/networks are confirmed gone.
The harness does not automatically retry or delete the retained Project.
Image identity evidence must cover every expected Compose service, including
sidecars; incomplete inspection cannot yield a lifecycle pass. Pre-install
source validation rejects fixed global resource/container names, external
networks, host/container namespaces, Docker socket mounts and Compose ownership
labels.

The local fixture inputs additionally supply an inert Warrior nickname,
Headscale origin/MagicDNS names, Authelia cookie origin, and Pangolin origin/base
domain under `e2e.selfhost.test`. These permit the existing local configuration,
identity and health probes; they do not create DNS records, TLS routes, public
listeners, peer enrollment or resource/tunnel acceptance. NetBird, external
providers, SMTP and Docker watcher endpoints are not synthesized.
