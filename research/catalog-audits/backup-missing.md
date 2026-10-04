# Missing backup and job recipes

Checked 2026-10-03. Scope: Borgmatic, restic, Renovate, and MinIO catalog records;
official documentation and the existing shared recipe/setup contracts only.
No Docker, repository writes, scheduled jobs, token acquisition, or restore ran.
Public publisher image manifests/config metadata were fetched without image pulls.
Documentation lookup used Context7 for restic, followed by primary source pages.

## Findings

| App | Sourced execution and credential contract | Recipe disposition |
| --- | --- | --- |
| Borgmatic | The publisher documents a scheduled container, `CRON=false`, one-shot commands, and `BORG_PASSPHRASE_FILE`. Backup sources are mounted read-only. | Inert manual recipe at `2.1.8`; empty project-owned source/repository staging, generated passphrase and literal config. Version probe bypasses image init. Real backup sources, independent repository, initialization, and restore remain pending. |
| restic | Official CLI containers exist at `restic/restic` and `ghcr.io/restic/restic`; use a stable hostname. `RESTIC_PASSWORD_FILE` reads the repository password; `RESTIC_REPOSITORY_FILE` can hold a credential-bearing location. | Inert manual recipe at `0.19.1`; fixed hostname, generated repository password, empty project-owned staging folders. No administrator or API key. A version probe is not backup acceptance. |
| Renovate | OSS processes configured repositories and exits; official images are `renovate/renovate` and `ghcr.io/renovatebot/renovate`. Forgejo requires an operator-created PAT for a dedicated account. | Inert manual recipe at `44.132.2`; privately imported owner token and version probe only. Endpoint/repository allowlist and any remote update require separate review. No closed-source CE/EE substitution or Docker socket. |
| MinIO | Community repository archived April 25, 2026 and no longer maintained. AIStor's container example uses `latest`, separate S3/console ports, and an operator-obtained license file, including Free tier. | Keep discovery-only. AIStor is a separate licensed choice, not an automatic community upgrade. Need a maintained immutable image, reviewed license import plus root credentials, and authenticated object round-trip. |

Primary sources:

- [Borgmatic container publisher](https://github.com/borgmatic-collective/docker-borgmatic),
  [non-FUSE extraction](https://torsion.org/borgmatic/how-to/extract-a-backup/).
- [restic installation](https://restic.readthedocs.io/en/stable/020_installation.html),
  [repository/password inputs](https://restic.readthedocs.io/en/stable/030_preparing_a_new_repo.html),
  [isolated restore target](https://restic.readthedocs.io/en/stable/050_restore.html).
- [Renovate distributions and execution](https://docs.renovatebot.com/getting-started/running/),
  [Forgejo authentication](https://docs.renovatebot.com/modules/platform/forgejo/),
  [token configuration](https://docs.renovatebot.com/self-hosted-configuration/).
- [MinIO lifecycle](https://github.com/minio/minio),
  [AIStor container/license procedure](https://docs.min.io/aistor/installation/container/install/).

## Implemented manual-job contract and remaining scope

V2 recipes opt in through `execution.kind: "manual-job"` and source-backed
`execution.probe`; their single app service has `restart: "no"`, no published
port, no dependencies or HTTP healthcheck, and `job-credentials` onboarding.
The compiler emits `profiles: ["self-host-manual"]` and `manualProbe`.
Ordinary up/add/recreate must not activate them, including through ambient
Compose profiles. A prepared absent job is not a missing running app, has no
frontend URL, and must not enter login/API onboarding.

`catalog/types/manual-job.ts` permits only three pinned publisher images and
their fixed version argv/source URLs. Probe execution overrides the image
entrypoint, preventing Borgmatic's `/init` cron path from running. Its exact
selection approval is distinct from ordinary apply; output is suppressed and
exit status is narrow evidence. No arbitrary argv, initialization, archive,
snapshot, restore, pruning, or remote-update command is provided by this slice.

Renovate uses sourced `RENOVATE_TOKEN`, not a fabricated `RENOVATE_TOKEN_FILE`.
The job-only `owner-token` binding imports an owner-only file, validates bounded
single-line alphanumeric token bytes, and prepares a mode-0600 private env file.
Resume compares supplied bytes or reuses the saved file; it never rotates a token.
Docker inspection can expose environment secrets to Docker operators. The token
is not generated, and its remote permissions are not verified by a version probe.

Backup source/repository folders here are empty owned staging, not inferred
production paths or independent storage. Real source selection, app-consistent
capture, repository initialization, off-host credentials, scheduling, pruning,
and isolated restore need an additional exact reviewed configuration/run boundary.
AIStor also still needs reviewed opaque license import plus root credentials.

Publisher tag manifests read on 2026-10-03 (no pull/runtime acceptance):

| GHCR image tag | Manifest digest |
| --- | --- |
| `ghcr.io/restic/restic:0.19.1` | `sha256:2f0373803493361f9304a57150d464677f69a9dad487afec202105aafb2592f2` |
| `ghcr.io/borgmatic-collective/borgmatic:2.1.8` | `sha256:5bd8439a648c26dd9f11fb4e3a54c6bd964babf4eabf5060bde8d58b51cdc0ee` |
| `ghcr.io/renovatebot/renovate:44.132.2` | `sha256:0191afbc3937e5316263426fc0ce1450f5c143d42e3f91da8c6f771e317fae51` |

These are timestamped registry observations; apply still binds its exact reviewed
immutable digest. Official releases: [restic 0.19.1](https://github.com/restic/restic/releases/tag/v0.19.1),
[Borgmatic image tags](https://github.com/borgmatic-collective/docker-borgmatic/pkgs/container/borgmatic),
[Renovate 44.132.2](https://github.com/renovatebot/renovate/releases/tag/44.132.2).

## Isolated acceptance plan (not applied)

For Borgmatic/restic, first obtain exact owner-selected source and independent
repository paths, an image digest, credential references, database-native
capture plan, retention, RPO/RTO, and failure owner. Propose a disposable fixture
project containing synthetic files only, read-only source mounts, and a
repository outside every protected source. No production credentials or data.

After separate exact approval: initialize the new fixture repository once,
write one snapshot/archive, record its exact ID, and restore into a fresh
isolated target using CLI extraction rather than privileged FUSE mounts.
Compare content hashes and metadata, perform application-native acceptance
when databases are in scope, measure restore duration, then inspect replay
against the same saved owner. Schedule, pruning, and production capture remain
separate approvals. A listing, exit zero, or repository check is not recovery.

For Renovate, first choose the forge endpoint and exact repository allowlist;
require an owner-issued minimum-scope PAT. Propose an isolated test repository
and reviewed no-write run before separately approving a PR-producing run.
Nothing authorizes automatic discovery, external scheduling, or production PRs.

For AIStor, first obtain an explicit product/license choice and maintained
immutable image. Review a private S3/console plan, opaque license input, and
generated root credential files. Only after approval test authenticated
put/get in an isolated bucket and credential/data persistence. Object storage
acceptance is not backup or isolated-restore acceptance.

## Validation boundary

`packages/cli/tests/manual-job-recipes.test.ts` validates all three real recipes,
portless compiler output, read-only Compose plans, fixed version probes, private
credential preparation/reuse, changed-token rejection, and invalid port/admin/
write-probe rejection. Fixture files contain synthetic data only. Focused builds
check changed TypeScript. No image pull, live token check, Docker job, scheduler,
backup, or restore ran; live acceptance remains unverified.
