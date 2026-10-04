# Skill and control-panel audit

## Reused

The public skill now delegates new goals to the same `app shared` CLI used by
`control-panel/shared-create.ts`: one Compose owner, bundled v2 recipes,
generated owner-only credentials, resumable setup adapters, separately approved
environment transitions, and Homarr publication. Existing app, batch, bundle,
media, and stack continuation workflows remain intact.

Sources: `packages/cli/src/shared-project.ts` (parser and dispatch),
`lib/shared-project-state.ts` (private revision chain),
`control-panel/setup-engine.ts` (coverage, inputs and peer effects), and
`shared-homarr.ts` (saved credentials, exact approval and dashboard readbacks).

## Changed

- Public skill recognizes saved shared owners and stays a conversational wrapper.
- Setup/upkeep prefer shared commands for new/saved shared projects; legacy
  operational branches remain available only for their matching owners.
- Conversation intake recommends basic defaults plus Homarr without a mandatory
  New/Advanced question. External secrets still use declared private boundaries.
- Shared CLI reference gives exact plan/apply/setup/Homarr/status/handoff syntax.
- App help lists existing `homarr-plan|homarr-apply`; README removes stale claims
  that shared Homarr/Immich/Paperless setup or selected lifecycle is unavailable.

## Read-only routing exercise

Prompt: “Replace Google Photos; defaults; plan only; use this project.”

Expected skill route: planning only → catalog photos goal → Immich plus Homarr;
its bundled database/cache are recipe services, not separate app owners. Present
private exposure, storage and recovery gaps. No state init, signup, apply,
credential export, or dashboard mutation is authorized.

Observed source CLI command (Bun 1.4.0):

```bash
bun .agents/skills/self-host/workflows/selfhost/scripts/selfhost.ts \
  plan 'replace Google Photos' --project-root /tmp/auto-stack-env-transition --json
```

Returned `status: pass`, `command: plan`, `mutation: false`, goal `photos`, and
Homarr/Immich with supporting PostgreSQL/Valkey. Its legacy stage graph remains
planning-only; the shared setup branch explicitly maps frontend recipes instead
of executing that graph as separate projects. This is source routing evidence,
not an independent model prompt benchmark or live deployment acceptance.

Source `appCommand(["help"])` under Bun 1.4.0 prints all documented shared
routes including Homarr. `app --help` is not an accepted alias; use `app help`.
Focused `bun build packages/cli/src/app.ts --target=bun --outfile=/dev/null`
passed. `git diff --check` passed. No tests were added, Docker started, browser
opened, or Actions invoked for this documentation/help change.

The initial `catalog recipes --json` check was blocked by concurrent Tracearr
recipe source/image mismatches; it was not evidence of successful full catalog
validation. Final catalog validation belongs to the coordinated catalog gate.

## Current limits

Prepared manual-job recipes stay in the selection and recap, but the TUI excludes
them from HTTP first-run, Homarr browser publication, administrator-credential
menus, and ordinary start/stop. It refreshes the exact saved owner's execution
kinds before setup/publication. A focused synthetic fixture verified mixed
selection filtering preserves the original selection, and jobs-only setup and
Homarr flows invoke only read-only status without an approval prompt. Focused
flow/shared-create Bun builds passed. These are not live execution acceptance.
The separate `job-plan`/approved `job-run` route checks only a declared version
probe; job function, backup and restore remain unverified.

Shared runtime requires a non-root local Linux/Docker operator and an owned
existing root. Unsupported recipes, first-run adapters, owner-secret inputs,
or acceptance checks stay pending; no competing project is created to hide a
gap. Custom ingress, migration, upgrade, legacy conversion, client trust,
actual app function, cross-app relationships, rendered widget content, and
restart persistence are separate gates. Compose completion, adapter readiness
and Homarr resource readbacks are not full acceptance. No new live shared-stack
Docker/API acceptance was performed in this audit.
