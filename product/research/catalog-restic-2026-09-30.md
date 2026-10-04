# Restic shared recipe boundary

- Checked: 2026-09-30
- Outcome: no safe shared recipe or headless setup adapter under the current contract.

Official [installation documentation](https://restic.readthedocs.io/en/stable/020_installation.html) names `ghcr.io/restic/restic` as an upstream CLI image and requires a static container hostname. The [upstream releases](https://github.com/restic/restic/releases) list v0.19.1, so `ghcr.io/restic/restic:0.19.1` is a candidate pinned version tag; its exact registry tag and digest were not verified. Neither an image tag nor a successful container start would establish backup coverage.

The v2 Compose schema permits a null published port but only `restart: unless-stopped` or `always`. A restic `backup` invocation must exit, so either restart policy could repeat a write without a controlled schedule. The shared setup contract is HTTP onboarding and endpoint verification, which cannot observe a restic snapshot or an isolated restore. The existing backup workflow explicitly plans and assesses evidence; it does not run backups, prune, or restore.

Safe support needs a bounded no-port job with `restart: "no"`, selected read-only application-consistent source, selected off-host repository, generated password file and separately retained recovery copy, backend credential references, fixed hostname, explicit schedule and overlap owner, and recorded command exit/snapshot. Repository initialization needs a separate approval and existing-repository inspection. Acceptance needs repository integrity checking plus representative data restored into an isolated target with read-back. These operations cannot be represented by `manifest.json`, `recipe.json`, and `setup.ts` alone, so no recipe or adapter was added. The existing guided catalog entry remains unchanged.

No Docker operation, secret handling, or tests were performed.
