# Runtime acceptance evidence

`E2E_TARGETS=all` selects 94 Apps and 7 Recipes (6 legacy Recipes plus
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
The scheduler acquires the entire App and prerequisite-helper count atomically,
with a global ceiling of 20. Recipes, multiservice Apps, known heavy Apps, and
fixed/secondary-port targets run exclusively. Source containers are removed before the isolated
restore environment starts. Capacity and the shared port registry remain owned
until both environments are successfully removed; teardown failure retains
that budget and blocks queued starts. CI defaults remain serial. Do not run
another Docker acceptance harness outside the OS lock during a sweep.

Before installation and later mutation/pull/restore commands, admission measures
available bytes and inodes on both the owned temporary Project filesystem and
the executable/helper staging filesystem. The Project floor is 8 GiB and
100,000 inodes; `E2E_MIN_FREE_GB` accepts a positive integer GiB override. The
independent executable-staging floor is 2 GiB and 100,000 inodes;
`E2E_MIN_EXECUTABLE_FREE_GB` accepts its positive integer GiB override. Evidence
records both measurements, minima and purposes. Low or unavailable capacity
blocks new mutations and queued targets, retains sanitized resource evidence,
and leaves scoped cleanup enabled. Docker image storage needs its own capacity
assessment.

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
`awaiting-external-credentials`, `awaiting-local-prerequisites`, `manual`,
`failed` and `pass`. Each lifecycle stage has its own outcome, sanitized command and per-App result. A manual or
failed stage leaves subsequent stages `not-run`. Docker unavailability is
recorded as blocked and never becomes a runtime pass.

Stages: install; Setup/Check; idempotent Setup; restart; stop/start recovery;
update; backup; isolated restore; restored Setup/Check; filesystem sentinel.
Readiness requires exactly the expected Apps and Compose services, successful
Setup, healthy containers where checks exist, and running containers except
successful inert jobs. Evidence includes the exact built binary SHA-256, Git
head, host platform and immutable image IDs/platforms after update.

The backup sentinel is a harmless file in each App's archived folder. It
proves archive extraction into a fresh Project. PostgreSQL additionally checks
an exact seeded table row after restore; ntfy checks an exact notification ID
and body. App Setup/Check provides the App's existing API/configuration
acceptance. Broader application workloads, other database-content recovery,
version-to-version migration, VPN fail-closed behavior, external SMTP/provider
accounts and browser/UI acceptance require separate App-specific proof.
Restic/borgmatic use an isolated local repository setting but do not perform a
real backup workload through their own tools. Other required configuration and
credentials remain explicit prerequisites. The owned fixtures below supply
local prerequisites without enrolling remote devices or provider accounts.

Ordinary evidence contains fixed errors, recognized redacted CLI failures and
bounded status diagnostics; it excludes raw stdout/stderr/logs. Optional
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

Local inputs supply an inert Warrior nickname, Headscale origin/MagicDNS names,
and Pangolin origin/base domain under `e2e.selfhost.test`. They support existing
configuration and health probes without public DNS, peer enrollment or tunnel
acceptance. Additional owned fixtures exercise these source contracts:

- NetBird: verified loopback HTTPS, real owner setup and protected management
  API; no peer, VPN or browser acceptance.
- Authelia: exact canonical-origin TLS routing for administrator login and
  session identity; no MFA or browser acceptance.
- Passbolt: private verified HTTPS and no-auth STARTTLS to an owned discard
  relay, including the App's test-email delivery counter. No real SMTP account,
  mailbox delivery, browser-extension/OpenPGP enrollment or key recovery claim.
  Successful prerequisites still end at the manual enrollment boundary.
- WUD: a private read-only mTLS facade serves fresh narrow projections of one
  real owned ntfy container and its exact image. An individual fresh-watch call
  must match both IDs; evidence records the observation generation and time.
  No Docker socket is mounted; remote Docker access and registry-update checks
  remain outside acceptance.
- Beszel: with `E2E_BESZEL_ROOTLESS_STATS=1` on a rootless Docker target, an
  owned CPU and memory load container
  joins the same unique Compose project. The probe matches its full Docker
  identity to exactly one Hub record by short ID, name and the exact enrolled
  machine ID, requires
  positive CPU and memory, verifies container list and stats GETs through the
  loopback socket proxy, and requires POST denial. Evidence also records the
  proxy's socket source, the matching active Unix endpoint, Docker's rootless
  security fact and the load image's immutable identity. The load runs with one
  CPU, 96 MiB memory and 32 PID limits, all capabilities dropped, a read-only
  root filesystem and no-new-privileges.

Manual and external prerequisite outcomes leave subsequent lifecycle stages
`not-run`; the presence of a fixture never promotes those outcomes to a pass.
