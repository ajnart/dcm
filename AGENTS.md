# Repository agent guide

## Map

- `.agents/skills/selfhost/` owns intent routing, catalog, stack selection,
  non-secret preferences, and the exact packaged-skill registry at
  `references/catalog/skills.json`.
- `.agents/skills/selfhost-*` capabilities own one operational boundary each.
- `.agents/CONTEXT.md`, `invocation.md`, and `install.md` define shared product
  vocabulary, composition, and packaging.
- `packaging/agent-plugin.json` owns the portable Agent Plugins 1.0 manifest;
  `packaging/claude-plugin.json` is the Claude Code compatibility manifest.
- `.agents/adr/` records stable architecture and support decisions.
- Root `PROMPT.md`, `docker-compose.yml`, `prompts/`, `docs/`, and their
  `scripts/` are the canonical media harness.
- `.agents/skills/selfhost-media/assets/harness/` is its generated portable
  bundle. `generations/` and `research/` are evidence, not runtime input.

Read the owning `SKILL.md` and its directly linked references before changing a
capability.

## Protected invariants

- Inspect -> plan -> approval -> apply -> verify.
- Private or loopback exposure is the default. Public exposure is a separate
  approval with one DNS/TLS/80/443/auth owner.
- Facts, choices, derived values, secret references, and evidence keep distinct
  provenance.
- Preferences contain no secrets. Secret payloads stay at the narrow apply
  boundary and out of commands, screenshots, fixtures, and client configuration.
  The sole output exception is the generated media admin password: an explicitly
  invoked setup displays it directly to the user once in the final handoff and
  never persists it or repeats it unless the user explicitly requests a fresh
  access handoff.
- One Compose project is the mutation boundary. No broad Docker teardown,
  prune, volume deletion, unowned network/proxy edit, or casual socket mount.
- Container liveness and HTTP 200 are narrow observations, not acceptance.
- VPN safety requires a recorded tunnel-break fail-closed test. Backup
  verification requires an isolated restore.
- Support level and T0/T1/T2 priority remain independent.
- Packaged `.agents/skills/*` directories and the sorted skill registry have
  exact ID equality. Specialized adapters use `adapter: true` with scope
  `application` or `stack`; only application-scoped adapters may appear in an
  app's `adapterSkill`, while stack-scoped adapters are invoked directly.
- App tiles, Homarr integrations, and widgets are separate claims.
- The media adapter uses exactly
  `ghcr.io/homarr-labs/homarr-test:v2` and only authorized content.

## Ownership

- Catalog facts and goal routing: `selfhost`.
- Host discovery and path advice: `selfhost-host`.
- Compose render/apply lifecycle: `selfhost-compose`.
- Edge access: `selfhost-ingress`.
- Downloader egress: `selfhost-vpn`.
- Recovery policy: `selfhost-backup`.
- Monitoring plans: `selfhost-observe`.
- Upgrades/migrations/recovery: `selfhost-operations`.
- Current external evidence: `selfhost-research`.
- Acceptance aggregation: `selfhost-verify`.
- Seven-service harness: `selfhost-media`.
- Homarr API/UI/MCP behavior: `selfhost-homarr`.

Do not duplicate another owner's implementation. Add an app-specific skill only
for reusable special behavior beyond declarative catalog data. Add, remove, or
rename a skill together with its exact registry entry.

## Safety while working

Treat `.sessions/`, `.env*`, credential stores, browser profiles, cookies,
client sessions, and secret files as out of scope. Do not read or print them.
Use bounded source paths and redacted fixtures.

Preserve concurrent work. Inspect status before and after edits, stage only
owned files when staging is requested, and never repair unrelated changes.

Exploration subagents are read-only GPT-5.6 Luna. Implementation subagents use
GPT-5.6 Sol. Keep exploration reports concise and source-backed.

## Generated media bundle

The root media harness is canonical; the packaged media asset and manifest are
generated. Never fix drift by editing only the bundle or by changing hashes.
Regenerate through the owning workflow after a canonical harness change. If no
approved generator is available, stop and report the bundle refresh as blocked.
Repository tooling added under root `scripts/` is not media runtime input.
Refresh the generated bundle only with
`bun scripts/refresh-media-bundle.ts`; the command accepts no paths and
verifies the complete source/bundle relationship after writing.

## Focused commands

```bash
bun scripts/validate-repo.ts
bun scripts/validate-repo.ts --json
bun .agents/skills/selfhost/scripts/selfhost.ts catalog validate --json
bun .agents/skills/selfhost-media/scripts/verify-bundle.ts
```

Use `bun build path/to/changed.ts --target=bun --outfile=/dev/null` and `bash -n
path/to/changed.sh` for changed scripts. Run only the minimal new or affected
fixture. Do not run Docker, browser, installer, full-stack, or broad test suites
for a focused source change.

`scripts/smoke-install.sh` is an explicit Bun 1.4.0+ release check. It resolves
the `skills` package through `bunx` and verifies both default symlink and
explicit copy layouts in disposable projects. Keep it out of ordinary local
and CI validation.

When commits are requested, make small continuous commits that each leave the
targeted gate coherent. Do not commit generated runtime, evidence, secret, or
client-install state.
