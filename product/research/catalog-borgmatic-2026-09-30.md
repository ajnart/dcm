# Borgmatic shared-setup boundary — 2026-09-30

Decision: retain a guided catalog entry with the official pinned `ghcr.io/borgmatic-collective/borgmatic:2.1.6` image. Do not add `recipe.json` or `setup.ts` yet. No Compose workload, repository, schedule, or restore was run.

## Primary evidence

- The [official container repository](https://github.com/borgmatic-collective/docker-borgmatic) publishes the Compose workload, with read-only `/mnt/source`, `/mnt/borg-repository`, `/etc/borgmatic.d/`, Borg key/config/cache/state mounts, and `restart: unless-stopped`. Its [package registry](https://github.com/borgmatic-collective/docker-borgmatic/pkgs/container/borgmatic) lists the immutable `2.1.6` tag; this is a tag pin, not a runtime-verified digest.
- The same container documentation requires `borgmatic init --encryption repokey-blake2` before backup, documents `BORG_PASSPHRASE_FILE`, and schedules via `CRON`, a crontab file, or daily 01:00 by default. It recommends a stable archive name because container hostnames may change and a stop grace period for in-progress backups. The optional Docker-socket hooks grant broad host control and are not a safe default.
- [Borgmatic setup](https://torsion.org/borgmatic/how-to/set-up-backups/) requires a source directory and repository in configuration. [Container credentials](https://torsion.org/borgmatic/reference/configuration/credentials/container/) supports a passphrase in a mounted secret file instead of literal configuration. A remote repository additionally needs selected network/SSH identity and credential ownership.
- [Extraction guidance](https://torsion.org/borgmatic/how-to/extract-a-backup/) supports `borgmatic extract --archive latest --destination ...`; it warns that extraction does not restore databases. [Database guidance](https://torsion.org/borgmatic/how-to/backup-your-databases/) treats database capture and restoration separately.

## Why the current contract is insufficient

The v2 recipe can declare a pinned long-running container, selected bind mounts, private files, and static non-secret generated config. It cannot bind selected source/repository paths into generated borgmatic configuration, select an off-host repository and its SSH trust/credentials, or set a reviewed schedule per installation. `configFiles` are literal non-secret blobs approved before selection, so a fixed `/mnt/source` and `/mnt/borg-repository` file would silently assume source and repository ownership. The generic `no-account` onboarding also expects an upstream-documented private endpoint; Borgmatic has no HTTP account or health endpoint. Claiming readiness from container liveness would be false, particularly because its default cron starts without an operator-chosen schedule.

The setup interface can execute a fixed command in the owned container, but that alone does not solve pre-start configuration or represent an idempotent `init` against an exact selected repository. The current acceptance methods (`api`, `browser`, `persisted`) cannot independently prove scheduled job completion, repository integrity, and an isolated application restore. A local repository inside the same Compose project is not off-host protection. Do not fabricate a port, admin password, or UI.

## Required contract before promotion

Provide a reviewed, selected backup source with read-only mount and app-consistent capture ownership; an exact selected off-host repository with key/SSH trust and private passphrase handoff; generated owner-only configuration derived from those choices; an explicit schedule with overlap/retention policy; and a checkpointed repository-init path that distinguishes empty from existing owned repositories and refuses ambiguous state. Keep the Docker socket absent by default. Acceptance must record a completed archive and integrity check, then extract representative files to an isolated destination and read them back; database-backed apps need a separate non-production database restore. Verify persistence after restart and inspect the next scheduled execution. These are independent of Compose liveness.

No Docker, browser, tests, credential handling, or runtime image-digest verification was performed. No secret values were collected.
