# MinIO AIStor implementation audit — 2026-10-03

Scope: explicit licensed derived recipe and read-only root S3 authentication.
No Docker/image run, license/enrollment mutation, provider change, secret/session
read, CI or deployment. Discovery/T2 support is unchanged.

## Current official product and availability

The [community repository](https://github.com/minio/minio) is archived; it is
not a maintained fallback. Current [AIStor container installation](https://docs.min.io/aistor/installation/container/install/)
requires an owner-obtained license, including Free. The implementation therefore
requires `edition=aistor-licensed`, a reviewed non-default root identifier and
private owner license import; it never silently selects community software.

Anonymous official [Quay registry](https://quay.io/repository/minio/aistor/minio?tab=tags)
metadata resolves `RELEASE.2026-09-19T17-05-25Z.hotfix.4ef74f03d6f2` to index
`sha256:e3a4c89118a0d02cbef43978172bd2bf4f43b6ba91d3d96618346cdb68bd73e8`.
The linux/amd64 config digest is
`sha256:fdc406eb4dba1a72e7bd45427ddbcca82f5d0b6b7a3b52084eeeaf845c6b1c14`,
created 2026-09-30, no User override, entrypoint `/usr/bin/docker-entrypoint.sh`,
Cmd `minio`. Only registry manifest/config bytes were fetched, not image layers.
The shared resolver still binds actual selected image digests to reviewed apply.

## Documented consumers and authenticated request

[Core](https://docs.min.io/aistor/reference/aistor-server/settings/core/) documents
`MINIO_LICENSE` as a file path and the console-address setting.
[Root settings](https://docs.min.io/aistor/reference/aistor-server/settings/root-credentials/)
document `MINIO_ROOT_USER`, `MINIO_ROOT_PASSWORD_FILE` and default-credential risks.
The recipe uses sourced license file-path binding and ordinary generated-password
file onboarding; the license is not an app-generated credential. Existing
owner-only import, bounded bytes, resume comparison and read-only mounts are reused.
[Site settings](https://docs.min.io/aistor/reference/aistor-server/settings/site/)
source the explicit `us-east-1` region choice.

Context7 `/websites/min_io_aistor` confirmed license/root-file consumers, followed
by current primary docs. [S3 compatibility](https://docs.min.io/aistor/developers/s3-api-compatibility/)
supports [ListBuckets GET /](https://docs.aws.amazon.com/AmazonS3/latest/API/API_ListBuckets.html).
The fixed signer follows [AWS header SigV4](https://docs.aws.amazon.com/AmazonS3/latest/developerguide/sig-v4-header-based-auth.html):
empty payload, exact saved loopback auto-Host, timestamp and region/service scope.
Anonymous403 + wrong signature403 + saved signature/XML200 are required.
Root credentials are privately handed off; no console JSON bodies, scoped-key
provisioning or secret-bearing argv are invented.

## Evidence and remaining acceptance

Affected configuration fixture passes direct catalog recipe validation. New
MinIO setup fixture passes independent disposable-loopback wire-signature checks,
replay/no writes, malformed XML, wrong signatures, binding drift and unchanged
transport errors. The sandbox denied loopback listen; only this requested fixture
was rerun outside it. Affected setup/derived builds and owned diff checks pass.

These are synthetic contracts, not live AIStor acceptance. Startup/license validity,
data writability/object roundtrip, scoped key pair capture, restart persistence and
isolated backup restore remain unverified; setup records those limits explicitly.
