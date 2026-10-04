# WUD pre-start authority contract — 2026-10-03

Staged app-owned contract only. WUD remains unregistered. No live Docker,
endpoint requests, TLS file reads, transport verification, or endpoint ACL tests.

## Review and claim

`apps/wud/authority.ts` exports pure `planWudAuthority(binding)`,
`approveWudAuthority(binding, separateToken)`, `assertWudAuthorityClaim(binding, claim)`,
and `assertWudAuthorityStatus(status, claim)`.

The separate `WUD-REMOTE-DOCKER:<project>:<sha256>` token binds the exact shared
owner/context/directory/source revision, immutable source record, derived binding,
adapter source hash, recipe hash, selected-service fingerprint, canonical remoteTLS
DNS host and decimal port, full selected container ID, and three fixed owner-issued
CA/certificate/key file references. File identity means the opaque local reference
and exact private path, not a digest of secret contents. Existing shared compiler
reference conventions are retained (`shared-compose-project.ts`, `scopedService`).
Any selected recipe, endpoint, owner, source, port or credential-reference drift
requires another review. Ordinary `APPLY` and selected lifecycle tokens do not
authorize remote Docker credentials.

The claim records credential-authority consent, not `approved:true`. Neither claim
hash nor token is a signature: only shared-owner private persistence and verified
loading establish that a reviewed claim was actually retained. Caller-provided
claims or computed tokens must not be accepted as stored approval. It contains no
credentials, certificate contents or credential-input options.

## Source-backed effects

The existing [pinned watcher audit](wud-20261003.md) traces WUD 9.1.0
[Docker watcher source](https://raw.githubusercontent.com/getwud/wud/9.1.0/app/watchers/providers/docker/Docker.ts):
host/port and three private TLS paths select remote access; watch-by-default false
filters by `wud.watch=true` after container listing. That filter and the expected
container ID are inventory selection, not endpoint API ACLs. No socket, proxy,
update trigger or endpoint restriction is provisioned here.

The plan makes the powerful `remote-docker-api-access` effect visible, keeps
`watchSelectionIsAcl`, `endpointAclVerified` and `transportVerified` false, and
requires mutating operations to be denied by the endpoint owner before any
least-privilege claim. User consent alone cannot prove this denial. `setup.ts`
rejects absent, stale or Boolean approval before local HTTP or admin-password
access, then retains its existing bounded administrator/inventory observation.
It still reports Docker authorization, current scans and restart persistence false.

## Required shared-engine seam before registration

1. Add an optional bundled adapter-owned pre-start authority hook, not another
   app-name command router. Pass the already replayed immutable derived binding
   to plan/approve/assert; expose the separate token and effects beside ordinary
   Compose review. Include the authority source in shipped adapter hashes.
2. Under the exact shared-owner lock, compare the explicit separate token and
   save its returned claim in an exclusive mode-0600 immutable owner record,
   using the existing private derived-binding checks: canonical mode-0700 owner
   directory, no symlinks, one regular file/link, current UID, bounded bytes,
   durable sync, no overwrite, exact replay on retry. Never synthesize a claim
   from an input Boolean or from successful HTTP/TLS observations.
3. Before initial selected add or any later start/recreate/resumed apply that can
   start WUD, load the binding and stored claim safely, replay installed source
   and selected service against the exact owner, and call the assertion. Match
   declared TLS references to the retained manifest; keep existing owner-file
   metadata validation at the narrow apply boundary. Missing approval fails
   before private file preparation and Docker startup. Stop needs no new grant.
4. `shared-unit-setup.ts` already emits project/context/private-file identity and
   retained derived metadata. Its producer must load/replay the same claim and
   emit `remoteDockerAuthority`; today it emits no authority record. The setup
   adapter must never load arbitrary approval paths or accept argv attestations.

Do not register WUD until all start-capable owner paths use this seam. Separate
endpoint-owner ACL observation remains a distinct acceptance boundary.

## Focused validation

Bun 1.4.0: `packages/cli/tests/wud-authority.test.ts` covers deterministic review,
separate-token rejection, recipe/source/owner/endpoint/container/reference drift,
forged Boolean claims, unverified effect flags, and rejection before HTTP/password
access. Synthetic fixture success is not live TLS/ACL evidence. Changed WUD
entrypoints are build-checked only; no broad suites, Docker, browser or CI.
