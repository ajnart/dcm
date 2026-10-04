# MinIO catalog decision — 2026-09-29

Decision: keep MinIO at discovery support. Do not add a shared Compose recipe or headless setup adapter yet.

The [official MinIO repository](https://github.com/minio/minio) is archived and explicitly says the community edition is source-only. Historical binary and image releases are not maintained; the documented Docker path builds an image locally from a compiled binary. Pinning an old `minio/minio` tag would therefore imply a maintained upstream container contract that no longer exists.

The [official AIStor container guide](https://docs.min.io/aistor/installation/container/install/) documents `quay.io/minio/aistor/minio:latest`, data and license-file mounts, and ports 9000/9001. It says AIStor requires a license to run, including the Free tier, which the operator must request and download separately. Its example also uses publicly known default root credentials. A free-of-charge license is not a credential-free deployment path. The current shared recipe/private-file contract generates secrets but does not acquire or securely import an operator-provided AIStor license; using the example without both a license handoff and generated root credential handling would be unsafe.

Before promotion, choose whether the catalog will support AIStor as a distinct licensed product or a source-built, unsupported community image. For AIStor, define an explicit private license-file input and exact versioned image provenance, then confirm its root credential inputs and authenticated S3/console acceptance against that version. For the community build, define a reproducible source-build provenance and maintenance policy. Neither path is established today.

No Docker deployment or live acceptance was attempted.
