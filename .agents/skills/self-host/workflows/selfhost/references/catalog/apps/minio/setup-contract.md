# MinIO AIStor deployment and setup boundary

Checked 2026-10-03. This derived recipe selects proprietary AIStor explicitly;
it does not revive the archived community product. Support remains discovery/T2
until live acceptance. No static default `recipe.json`, license acquisition,
enrollment, provider change or runtime deployment is performed here.

## Reviewed inputs

`derived-recipe.ts` requires `edition=aistor-licensed` and a reviewed
`root-username` of 20–32 safe characters, rejecting the default minioadmin.
This local restriction is conservative policy, not an upstream length claim.
The shared derived owner binds these choices, recipe/source fingerprints and
configuration to plan/apply/resume. No peers or externally mounted data paths
are required. Data is an owned named volume; both S3 9000 and console 9001
are private loopback listeners by default.

[Installation](https://docs.min.io/aistor/installation/container/install/)
requires an owner-obtained AIStor license, including Free. Import the bounded
`aistor-license` owner file through the existing private-file approval boundary.
The app never reads license bytes. [Core settings](https://docs.min.io/aistor/reference/aistor-server/settings/core/)
document `MINIO_LICENSE` as the plain license-file path; the shared compiler
mounts it read-only and derives that path, not an invented `_FILE` or `file:` URI.

[Root settings](https://docs.min.io/aistor/reference/aistor-server/settings/root-credentials/)
document `MINIO_ROOT_PASSWORD_FILE`. Generate `admin-password` once (48
alphanumeric bytes), privately save/reuse it, and inject only its file path.
`MINIO_ROOT_USER` contains the reviewed root access identifier. The ordinary
administrator handoff saves that identifier and password file: together these
are **root S3 credentials**, not a new scoped application access-key pair.
The owner-issued license is neither a password nor an app-generated API key.

The official pinned tag is
`quay.io/minio/aistor/minio:RELEASE.2026-09-19T17-05-25Z.hotfix.4ef74f03d6f2`.
Public registry inspection returned index digest
`sha256:e3a4c89118a0d02cbef43978172bd2bf4f43b6ba91d3d96618346cdb68bd73e8`.
The ordinary image resolver binds the actual resolved image to apply review;
the configuration retains the observed publisher index digest as provenance.
Availability/config metadata is not startup or file-consumer runtime proof.

## Read-only authentication

[AIStor S3 compatibility](https://docs.min.io/aistor/developers/s3-api-compatibility/)
lists [ListBuckets](https://docs.aws.amazon.com/AmazonS3/latest/API/API_ListBuckets.html).
`s3-auth.ts` implements only fixed `GET /`, empty payload/query,
[AWS SigV4](https://docs.aws.amazon.com/AmazonS3/latest/developerguide/sig-v4-header-based-auth.html).
The configured [site region](https://docs.min.io/aistor/reference/aistor-server/settings/site/)
is explicitly `us-east-1`, also bound into the signature. Host is the transport's
automatic exact saved `127.0.0.1:port`, never caller-controlled.

`setup.ts` requires the running exact owner and verified derived binding, then
requires anonymous S3 AccessDenied 403, wrong-root-signature SignatureDoesNotMatch
403 and saved-root-signature ListAllMyBucketsResult XML 200 with Owner/ID and
Buckets. No console login, guessed JSON route or write is used. Transport/deferred
errors propagate untouched. Repeating setup/inspection repeats only these reads.
The saved result contains username/credential path, not secret values or buckets.

`root-s3-auth-verified` is deliberately narrow: `apiKey:not-created`,
`licenseVerified:false`, `storageWriteVerified:false`,
`scopedAccessKeyCreated:false`, `backupVerified:false`; no health source is claimed.
License usability, an approved isolated object roundtrip, scoped-key creation with
private pair capture/replay and restart persistence remain separate acceptance.
Backup verification additionally requires an isolated restore.

## Validation

The app-local configuration check validates exact inputs, recipe schema and drift.
`packages/cli/tests/minio-setup.test.ts` uses a disposable synthetic loopback
server with independent wire-host SigV4 verification and negative cases. It does
not start AIStor, import a license, write objects or prove live compatibility.
