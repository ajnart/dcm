# Restic catalog boundary

- Checked: 2026-09-29
- Status: blocked for a v2 recipe and headless setup adapter
- Question: Can the current shared Compose contract safely operate restic as a bounded backup job?
- Domain allowlist: `restic.readthedocs.io`, `github.com`
- Browser session: not used; no browser state or raw payload retained

## Primary evidence

| Role | Source | Finding |
| --- | --- | --- |
| official | [Installation](https://restic.readthedocs.io/en/stable/020_installation.html) | Upstream publishes `restic/restic` and `ghcr.io/restic/restic` CLI containers and advises a static container hostname. |
| official | [Preparing a repository](https://restic.readthedocs.io/en/stable/030_preparing_a_new_repo.html) | A repository may be local or remote; `RESTIC_PASSWORD_FILE` is supported. Loss of the repository password makes data inaccessible. |
| official | [Backing up](https://restic.readthedocs.io/en/stable/040_backup.html) | `backup` creates a snapshot. Restic is not a daemon and has no built-in scheduler; recurring runs need an external scheduler and protection from overlapping instances. |
| official | [Working with repositories](https://restic.readthedocs.io/en/stable/045_working_with_repos.html) | `check` checks repository structure; `check --read-data` additionally reads backed-up data, but neither proves application recovery. |
| official | [Restoring from backup](https://restic.readthedocs.io/en/stable/050_restore.html) | `restore SNAPSHOT --target DIRECTORY` supports recovery into a separate location. |

The requested pages were reachable through public search on the check date. No authenticated or browser UI proof was attempted. Findings are limited to upstream documentation; no image digest or live behavior was verified.

## Contract gap

The current v2 recipe requires every service to declare a published target port and `restart: unless-stopped` or `always`. Restic has no service port or long-lived server process. Encoding `backup /source` as a service would turn a completed one-shot backup into a restarting container, potentially repeating the mutation without a schedule or overlap guard. A dummy port or keepalive shell would misrepresent the product. Therefore no `recipe.json` is added.

The shared setup adapter contract is for first-run application onboarding and endpoint verification. Restic has no administrator account, HTTP setup endpoint, or API key. A `setup.ts` that reports readiness from process liveness would invent acceptance. Therefore no `setup.ts` is added.

To support restic, add a distinct bounded job contract: no port, `restart: "no"`, exact approved invocation, fixed hostname, selected read-only capture source, selected repository destination/backend, private password and backend credential references, explicit scheduler/overlap ownership, and recorded exit status. Repository initialization must be separately approved and idempotently inspected. The repository target must be off-host to satisfy the catalog dependency; a local-only path is not off-host protection. The capture owner must first provide an application-consistent source. Acceptance requires a recorded snapshot, repository integrity check, and an isolated restore of representative application data with read-back; a snapshot or `check` alone is insufficient.

No Compose execution, Docker access, browser, tests, CI, or credential handling was performed. No runtime image digest was selected. Redaction count: 0; no sensitive values were collected.
