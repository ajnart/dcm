# MinIO shared-Compose decision

- Checked: 2026-09-30
- Decision: discovery only; no shared Compose recipe or first-run adapter
- Scope: official upstream sources; no container, credential, or live API test

The [community repository](https://github.com/minio/minio) was archived on 2026-04-25 and explicitly says it is no longer maintained. It distributes source only; historical prebuilt releases remain available but receive no updates. Its AGPL-3.0 license also requires an operator to assess obligations for the intended use. A historical `minio/minio` tag would not be a defensible current image pin.

The historical [Docker quickstart](https://github.com/minio/minio/blob/master/docs/docker/README.md) documents root user/password environment variables and `_FILE` forms, but its unpinned image example does not establish a maintained image. That credential contract alone is insufficient to promote this entry.

The replacement [AIStor container guide](https://docs.min.io/aistor/installation/container/install/) documents `quay.io/minio/aistor/minio:latest`, a mounted, externally obtained license file, and `--license /minio.license`. This is not a fixed version pin, and the catalog's generated-file mechanism is for non-secret literal configuration, not an operator-provided license. AIStor is a distinct licensed product; silently substituting it would change the selection boundary. The [license documentation](https://docs.min.io/aistor/operations/licenses/) confirms that AIStor Free requires a license, is single-node, omits encryption at rest and high availability, and that missing or expired licenses can block S3 writes or all S3 operations. A green HTTP health response therefore cannot establish usable object storage.

For AIStor Server `RELEASE.2025-12-20T04-58-37Z` and later, the license documentation specifically permits an unlicensed server to start in *offline* mode: the Admin API, Console, and health endpoints remain accessible, but all S3 operations are denied. An adapter would need authenticated object write/read proof and license-state verification, not just `/minio/health/*` or Console login. The official container example leaves API port 9000 and Console port 9001 published; a shared recipe would bind both privately and require separate approval for any wider access.

The official install guide shows publicly known initial `minioadmin` credentials. That example is not a safe administrator handoff or proof that an existing volume belongs to this setup. No version-pinned, replay-safe path has been established here to replace and verify the root credential, create a scoped access key, read it back privately, and re-verify it after restart. In particular, do not report a generated password file as the live root password or a service-access key without authenticated readback.

To promote this entry, first establish an official fixed AIStor image tag and digest, a reviewed operator-license handoff and private mount supported by the shared Compose contract, then a pinned first-run credential/access-key flow with interrupted-run recovery and direct S3 write/read/restart checks. Until then, keep `image.reference` null and do not create `recipe.json` or `setup.ts`.
