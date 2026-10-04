# Storage and mail Compose boundary — 2026-10-03

Scope: MinIO and Stalwart discovery manifests. Read-only official documentation,
release and registry checks; no image pull, Docker invocation, account creation,
license acquisition, secret access, mail traffic or DNS/TLS changes. Documentation
was queried first through Context7 (`/websites/min_io_aistor` and
`/websites/stalw_art`), then checked against live primary sources. Neither app can
honestly become a completed recipe with the current generic setup contract.

## MinIO / AIStor

The [community repository](https://github.com/minio/minio) is archived and says it
is no longer maintained. Historical community containers are not a maintained
default. [AIStor container installation](https://docs.min.io/aistor/installation/container/install/)
is a different, proprietary product: an owner must obtain a license, including
the Free tier, and supply it to the process. Free is single-compute storage,
not distributed HA. Adoption and license terms require an explicit owner choice;
the catalog does not silently switch the community product to AIStor.

The claim that no versioned maintained image exists was corrected. Public
[Quay tags](https://quay.io/repository/minio/aistor/minio?tab=tags) were enumerated
across all five registry pages (414 tags). The versioned non-FIPS, non-RDMA image
`quay.io/minio/aistor/minio:RELEASE.2026-09-19T17-05-25Z.hotfix.4ef74f03d6f2`
returned HTTP 200 with index digest
`sha256:e3a4c89118a0d02cbef43978172bd2bf4f43b6ba91d3d96618346cdb68bd73e8`.
This is availability evidence, not a pull or runtime acceptance test.

[Root settings](https://docs.min.io/aistor/reference/aistor-server/settings/root-credentials/)
require replacing the insecure defaults with unique random root credentials;
file-backed root values must contain no extra whitespace/newline. The
[license](https://docs.min.io/aistor/operations/licenses/) is owner-issued, not
something our random-secret generator can create. Container installation accepts
`--license` with a mounted path; server settings also document `MINIO_LICENSE`.
The S3 API and administrative console use separate listeners (9000 and 9001).
Neither an unauthenticated health response nor license acceptance proves root
login, bucket authorization, durable storage or recoverability.

Missing primitive: a reviewed owner-license file/path binding combined with
generated root credentials and an authenticated setup outcome. Current
`external-secret` onboarding requires the owner file in `fileEnvironment`;
inventing `MINIO_LICENSE_FILE` to satisfy that validator is not supported by the
reviewed upstream contract. A private-config environment can assemble generated
values but does not supply this composed license/admin lifecycle. Keep discovery
support and no recipe rather than classify it as no-account or generated-token.

## Stalwart

[Latest release](https://github.com/stalwartlabs/stalwart/releases/tag/v0.16.24)
is v0.16.24. The official
`ghcr.io/stalwartlabs/stalwart:v0.16.24` manifest returned HTTP 200 with index
digest `sha256:ec011be228596e37e65f41aab17deed573859614430472f7eeb42178c50d87b7`.
The [release README](https://github.com/stalwartlabs/stalwart/blob/v0.16.24/README.md)
documents AGPL-3.0 community code and a separate enterprise license, not mandatory
external enrollment for ordinary community administration.

[Docker installation](https://stalw.art/docs/install/platform/docker/)
documents UID 2000, `/etc/stalwart` configuration and `/var/lib/stalwart` data.
Bind paths must be writable by that identity; low-port capability handling must
not be guessed. Publishing every port from the upstream example is not approved.

[Bootstrap](https://stalw.art/docs/configuration/bootstrap-mode/) starts only
HTTP management on 8080, not mail services. A temporary administrator is renewed
on each bootstrap start; `STALWART_RECOVERY_ADMIN` pins a recovery credential but
does not finish initialization. The Bootstrap object/wizard needs hostname,
domain, storage and directory choices. It writes configuration, provisions a
permanent administrator, and transitions to hostname-bound HTTPS. The
[declarative alternative](https://stalw.art/docs/configuration/declarative-deployments/)
requires a datastore `config.json`, recovery mode and reviewed JMAP/CLI object
provisioning; it is not just a replacement environment variable.

Missing primitive: staged configuration/JMAP provisioning with owner-approved
domain/TLS identity, private capture of the permanent administrator, removal of
recovery credentials/mode, restart and authenticated final-origin verification.
The current one-variable non-secret transition does not represent these phases.
[Management API keys](https://stalw.art/docs/auth/authentication/api-key/) are
server-generated, returned once and hashed; they are distinct from bootstrap
passwords, enterprise licenses and SMTP/IMAP credentials. Do not invent a key or
creation payload. [DNS](https://stalw.art/docs/install/dns/), selected mail ports,
anti-abuse policy and external delivery tests remain separately approved gates.

## Local validation

Only the two discovery manifests changed, plus this research note. Focused JSON
assertions confirm v0.16.24, source provenance, discovery support and the absence
of recipe/setup claims. No runtime health, administrator login, mail delivery or
backup/isolated-restore claim is made.
