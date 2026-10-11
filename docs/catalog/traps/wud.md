# What's Up Docker traps

## Pitfalls

- An available tag is not proof that an upgrade is compatible, backed up, or reversible.
- Pinned 9.1.0 registerWatchers creates a default local Docker watcher when none is configured. Available watcher providers are Docker, Kubernetes, Nomad, and Swarm; registry providers look up image updates for watcher-supplied inventory and do not offer a standalone registry-only mode. A web-only Compose container without an approved watcher would not perform useful monitoring.
- Do not expose raw Docker TCP port 2375 publicly or treat Docker socket :ro as an API permission boundary.
- Before Install, prepare `<Project>/apps/wud/tls/ca.pem` containing the approved endpoint's PEM trust certificate. `<Project>` is normally `~/.self-host`, or the selected `SELF_HOST_HOME`. App, `apps`, `tls` directories and TLS files must be real, without symlink bind ancestors. Preflight validates these files before rendering or Compose apply, including start/restart/update and staged restore.
- Supply the approved endpoint's DNS name with `--set wud.WUD_DOCKER_HOST=…` and TLS port with `--set wud.WUD_DOCKER_PORT=…` (default `2376`), using `self-host install wud --yes`. Its certificate must match the name and it must be reachable from WUD. Trust comes explicitly from `tls/ca.pem`; certificate verification remains enabled.
- `wud.WUD_DOCKER_TLS_CLIENT_AUTH` defaults to `false`. With `--set wud.WUD_DOCKER_TLS_CLIENT_AUTH=true`, also prepare `<Project>/apps/wud/tls/client-cert.pem` and its matching private mode-0600 `tls/client-key.pem` before Install. These fixed App-owned files mount read-only at `/tls/ca.pem`, `/tls/client-cert.pem` and `/tls/client-key.pem`, through watcher `CAFILE`, `CERTFILE` and `KEYFILE`; the client pair mounts only when enabled.
- Check verifies the administrator, anonymous inventory denial and a fresh scan of one `approved` watcher container through authenticated `POST /api/containers/<id>/watch`, bounded to 30 seconds. Returned ID/watcher must match, without a watcher error. Label an owned container `wud.watch=true`; empty or cached inventory alone cannot pass. Verify Docker write denial separately.

## Security

- Do not mount the Docker socket directly; a read-only bind mount does not make Docker API operations read-only. Upstream recommends a Docker socket proxy with CONTAINERS, IMAGES, INFO, VERSION, EVENTS, and PING reads enabled and mutating operations denied. The proxy requires separate exact socket approval and a WUD-only network; never publish its Docker API port by default.
- This App connects to a separately approved TLS endpoint and mounts no Docker socket. Supply an endpoint whose API reads are limited to the approved inventory and whose mutating operations are denied; private routing, endpoint approval and its trust files are installation prerequisites.
- Keep the web UI private, seed WUD_AUTH_ADMIN_USER and WUD_AUTH_ADMIN_PASSWORD at the narrow apply boundary, and persist WUD state. Do not put the bootstrap password in catalog data or an ordinary report.
- Pinned authenticated POST /api/profile/tokens accepts name and read scopes and returns rawSecret only once; inventory cannot recover it. Any future adapter must checkpoint before creation, save privately, and refuse duplicate creation after an uncertain response. Bearer verification also updates token lastUsedAt and needs an explicit mutation approval.
- WUD_AUTH_ADMIN_USER with PASSWORD or HASH updates the matching user's credentials and administrator role on startup. Plan this as ongoing declarative credential ownership, not an empty-database-only seed. Homarr's pinned native WUD client uses saved Basic username/password on /api/containers; a personal token is not required for that client.

## Homarr

- The Homarr v2.4.1 descriptor uses the existing Project Admin login, internal `http://wud:3000`, one native `wud` widget and shared Stats entries `totalContainers` and `updatesAvailable`. It creates no token or account, rotates no password, and never falls back to anonymous access.
- Setup verifies the private container-update API separately from watcher discovery. An authenticated `[]` is a valid empty API dataset, not successful monitoring; the Link stops before mutation with a retryable Manual step when inventory is empty. Missing `updateAvailable`, malformed metadata, unapproved watcher rows and reported watcher/registry errors are failures, not zero updates.
- Link preflight reads WUD only. It does not call the App's mutating watcher Check. Homarr Stats refresh performs only upstream reads; returned freshness flags/timestamps and widget update details must match WUD's current API snapshot. Those timestamps prove Homarr fetched data, not the age of WUD's stored registry results.
- WUD 9.1.0 lists Docker containers before applying `wud.watch` filtering. `WATCHBYDEFAULT=false`, a watcher named `approved`, TLS, and denied Docker writes do not themselves restrict discovery to this Project. The approved endpoint must enforce Project-only container/image reads; approval to operate Compose does not approve reading other containers.
- See [source validation and runtime blockers](../../homarr-wud-proof.md). Registry assembly belongs to the reference owner; this descriptor alone does not register a new Link.
