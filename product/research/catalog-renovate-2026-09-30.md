# Renovate catalog decision — 2026-09-30

Decision: keep Renovate at discovery support; do not add a shared Compose recipe or setup adapter yet.

Renovate publishes `renovate/renovate` with SemVer tags, but its documented Docker invocation is a one-shot `docker run --rm` CLI. The official scheduled deployment example uses a Kubernetes CronJob with `restartPolicy: Never`, and its usage guide describes a dedicated bot account, a personal access token, an explicit repository list, and usually cron scheduling. The repository list can be replaced by autodiscovery, but that would expand the bot to every repository its token can access and is not an acceptable default.

The current shared-recipe contract describes a persistent Compose service (`restart: unless-stopped` or `always`) and has no bounded run-once/schedule lifecycle. It also lacks a reviewed, operator-selected repository target and provider-token reference for this app. A fixed catalog repository would be wrong for other users; an empty repository selection cannot verify useful operation; autodiscovery would silently widen scope. A generated random `privateFiles` value cannot stand in for an existing provider token. Putting a token in a static config file, command, or ordinary report would violate the secret boundary.

Before a safe recipe is possible, add a bounded scheduled-job capability with an exact selected provider endpoint and repository allowlist, a private operator-supplied token handoff, approval binding those non-secret choices, and a dry-run-first verification path. Verify provider authentication and that only selected repositories were processed; a successful container exit or logs alone are not update-proposal acceptance. Real PR creation needs a separate explicit approval after dry-run review. Pin a current release tag at implementation time rather than copying the official docs' deliberately stale example tag.

Primary sources:

- https://docs.renovatebot.com/examples/self-hosting/ — Docker tags and invocation, CronJob, token/repository/scheduling guidance, and trust warning.
- https://docs.renovatebot.com/self-hosted-configuration/ — `token`, `autodiscover`, repository targeting, and `dryRun` behavior.
- https://docs.renovatebot.com/getting-started/running/ — self-hosted CLI environment/configuration guidance.

Local contract: `.agents/skills/self-host/workflows/selfhost/references/catalog.md` and `references/catalog/schemas/compose-recipe.schema.json`.
