# Remaining storage, mail and worker routes

Checked 2026-10-03. Scope: `minio`, `stalwart-mail`, and
`archive-team-warrior`; no Docker, pulls, apply, private runtime/credential reads,
mail/DNS changes, remote jobs, git mutations or CI. Reused
[storage/mail evidence](../compose-catalog-storage-mail-20261003.md) and
[manual-job boundaries](backup-missing.md). Stalwart documentation was refreshed
through Context7, then checked against pinned source. No recipe or setup route
was promoted; the catalog now identifies the precise remaining interfaces.

## MinIO / licensed AIStor

The existing audit established a maintained AIStor image. Image availability is
not the missing interface, and archived community MinIO must not silently become
licensed AIStor. An explicit product/license choice still precedes deployment.
The [container contract](https://docs.min.io/aistor/installation/container/install/)
mounts an owner-issued license and passes its path through `--license`.
[Root settings](https://docs.min.io/aistor/reference/aistor-server/settings/root-credentials/)
support root credential files containing no additional whitespace/newline.

Current `prepareMultiServiceFiles` already imports owner files alongside generated
files and verifies saved bytes on resume. Ownership and onboarding are distinct;
do not add another ownership kind. The missing consumer is a typed secret-file
**command path**, not an invented `MINIO_LICENSE_FILE` or a license-as-login.
Minimal proposed declaration, not implemented:

```json
{"privateFileArguments":[{"fileId":"aistor-license","argument":"--license","officialUrl":"https://docs.min.io/aistor/installation/container/install/"}]}
```

Compile the literal flag plus derived `/run/secrets/aistor-license`, emitting
the exact read-only secret mount. Require a declared file, one consuming service,
listed HTTPS evidence, safe literal flag, no shell/interpolation, no duplicate
environment/path consumer, unchanged owner bytes and mode-0600 storage. Keep
legacy `external-secret` constraints; administrator onboarding and license
consumption must coexist without representing the license as a credential.

Existing additional-port descriptors can express S3 9000 and console 9001;
multiport Compose is not missing. Setup HTTP currently has one saved loopback
origin. A reusable signed-S3 request boundary must derive Host/canonical URI,
timestamp and credentials privately from that exact origin and keep the same
signature intent while approval is pending. Authenticate with wrong-key rejection
and signed readback, then separately approve an isolated object round-trip.
Root access is not a newly created scoped durable key; console HTTP 200 is not
S3 authentication, persistence or recovery proof.

## Stalwart v0.16.24

The pinned [Bootstrap handler](https://github.com/stalwartlabs/stalwart/blob/v0.16.24/crates/jmap/src/registry/mapping/bootstrap.rs)
generates a permanent administrator password for the internal directory,
hashes it, and returns `Username`/`Secret` in the JMAP result. The generated
password must be saved before a subsequent request. Shared `captureAdminPassword`
only accepts container stdout; HTTP has no equivalent saved-password capture.
Lost returned credentials must not trigger repeated provisioning.

[Bootstrap documentation](https://stalw.art/docs/configuration/bootstrap-mode/)
also confirms temporary passwords appear in process output. A pinned recovery
credential avoids generating that temporary password but is not permanent
administration. The proposed route must bind explicit hostname, domain, storage
and directory choices; create/reconcile datastore configuration and JMAP objects;
capture/verify the permanent identity; remove recovery secrets and mode; restart;
then verify the configured hostname-bound HTTPS identity. The
[declarative alternative](https://stalw.art/docs/configuration/declarative-deployments/)
likewise needs recovery-mode provisioning followed by removal of both variables.
The common localhost Caddy seam does not implement that lifecycle. No guessed
domain, public mail port, DNS/TLS change or synthetic mail workload is authorized.

## ArchiveTeam Warrior

Pinned [start.py](https://github.com/ArchiveTeam/warrior-dockerfile/blob/7682e0a0f35266fd1d31d4efe172f495c4ce10f3/start.py)
seeds configuration when absent/invalid and unconditionally launches
`run-warrior3` with Warrior HQ. Pinned
[runner behavior](https://github.com/ArchiveTeam/seesaw-kit/blob/699b0d215768c2208b5b48844c9f0f75bd6a1cbc/seesaw/warrior.py)
POSTs registration/update data and starts periodic HQ updates independently of
selected archival project. `SELECTED_PROJECT=none` does not prevent those writes.

Needs verified immutable official image plus source-to-runner provenance, a
deferred worker-start gate binding HQ participation and selected project/resource
limits, and documented authenticated project/job readback. The current fixed
manual probes cover only restic/Borgmatic/Renovate; no canonical Warrior probe
was established. An arbitrary entrypoint no-op is not useful archival setup.
UI Basic authentication is not an administrator account or durable API key.

## Validation

Only app manifests and this note changed. Parse and source-backed manifest
assertions were run; no negative-absence test file or unused helper was added.
There is no changed TypeScript to build. Live first-run, credential replay,
restart persistence, object round-trip, mail delivery and worker acceptance remain
unverified.
