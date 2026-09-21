# Contributing

This repository is a declarative catalog plus composable operational
capabilities. Prefer a small catalog change over a new workflow, and prefer a
focused capability over an application-specific automation fork.

## Choose the right change

Add or update a catalog record when the contribution is product facts:
categories, roles, alternatives, dependencies, lifecycle, official sources,
image provenance, Homarr support, safety notes, or stack selection.

Add a stack when a user goal needs a reusable set of roles, choices, gates,
required workflows, and acceptance checks.

Add an application-specific workflow only when the application has stable,
reusable behavior that cannot be expressed safely through the catalog and
generic host, Compose, ingress, backup, operations, or verification
capabilities. Examples include a special API lifecycle, a first-run state
machine, or protocol-specific evidence. A dashboard link, Compose snippet, or
list of ports is not enough.

## Catalog workflow

1. Update the relevant JSON under
   `.agents/skills/self-host/workflows/selfhost/references/catalog/`.
2. Keep upstream product facts separate from container image facts.
3. Add a current primary source for every technical, lifecycle, license, and
   image-provenance claim. Label vendor and community packaging separately.
4. Record `checkedAt` with the date actually checked. Use `active`,
   `transitioning`, `verify`, or `retired` accurately, including a migration or
   replacement source where applicable.
5. Keep T0/T1/T2 as curation priority. Set `managed`, `guided`, `discovery`,
   or `retired` from evidence, never popularity.
6. Update a goal stack only when its roles, defaults, gates, required workflows,
   or acceptance contract changes.
7. Run the semantic catalog validator and the focused skill-pack gate.

```bash
bun .agents/skills/self-host/workflows/selfhost/scripts/selfhost.ts catalog validate --json
bun scripts/skillpack.ts validate --scope content
```

The JSON schemas document the declarative contract; the catalog script enforces
cross-record semantics, aliases, alternatives, dependencies, lifecycle,
support, affiliate rules, and the Homarr image contract.

## Adding a workflow

Keep `.agents/skills/self-host/SKILL.md` as the lean public entry. Put conditional
procedures under `workflows/<id>/GUIDE.md` with shallow references and executable
helpers. A separate public skill needs a useful independent invocation, not
merely another setup step. Internal modules have no `SKILL.md` files.

Update the sorted registry at
`.agents/skills/self-host/workflows/selfhost/references/catalog/skills.json`
when adding or renaming a module. Stable IDs describe ownership, risk, delegation,
and profile dependencies; they remain compatible with saved stack metadata.
Application adapters use `kind: adapter` and `scope: application`; stack adapters
use `scope: stack`. Only application adapters may be an app's `adapterSkill`.
Keep install-profile dependency closure and service/evidence obligations coherent.

All helpers and required resources must be inside the public skill's install
boundary. Run scripts by absolute path and return bounded results. Keep shared
constraints in the selected workflow and conditional details behind precise
reference links. Never concatenate all guides into a request's context.

## Deterministic scenarios and focused validation

Each changed planner or validator needs a small, secret-free fixture that
proves its new branch and its nearest rejection boundary. Reuse an existing
fixture shape when possible. A catalog-only change normally needs catalog and
repository validation, not Docker or browser testing.

For a script change:

- run the focused Bun TypeScript syntax gate or `bash -n` on changed shell files;
- invoke only the changed script's minimal passing and failing fixture;
- verify deterministic output and nonzero failure status;
- keep inputs bounded, non-symlinked where required, and free of credentials;
  and
- report checks that were not run instead of expanding into a full stack test.

Use the registry graph to run only affected deterministic checks:

```bash
bun scripts/skillpack.ts test --changed-from origin/main
```

Run Docker, browser, installer, or live-host acceptance only when the change
owns that surface and the operator explicitly requests it. The installer smoke
test uses `bunx --bun` package resolution and is never an implicit validation
step.

## Privacy, secrets, and generated state

- Store only opaque secret references in plans, catalog records, fixtures, and
  evidence. Never commit credentials, API keys, cookies, private keys, session
  state, interpolated Compose output, or private host URLs.
- Do not inspect `.sessions/`, `.env*`, credential stores, or existing client
  sessions while contributing.
- Keep `.selfhost/preferences.json`, `.selfhost/project.json`, and
  `.selfhost/stack.json` non-secret and untracked. Adapter-owned
  `connections.env` may retain private API keys, URLs, and usernames but never
  the generated initial admin password.
- Keep reports and screenshots redacted. A rejected payload is not safe to
  paste into an error explanation.
- Never add a broad Docker teardown, volume deletion, host-wide prune, or
  casual Docker socket mount.

The affiliate registry starts empty. Any future entry needs a real disclosure,
HTTPS link, checked date, region scope, and human-facing placement beside the
link. Affiliate status must not affect defaults, rank, support, or alternatives.

## Media bundle policy

The root media harness is the canonical source for its packaged
`selfhost-media/assets/harness` bundle. The bundle and manifest are generated
release artifacts, not a second implementation.

A root `PROMPT.md`, `docker-compose.yml`, `docs/`, `prompts/`, or media harness
`scripts/` change is incomplete until the owning generation workflow refreshes
the portable bundle and its manifest. Never hand-edit only the generated copy
or update hashes to conceal drift. If no approved regeneration path is
available, stop and leave the change blocked.

Run the fixed repository-owned workflow after an approved canonical change:

```bash
bun scripts/refresh-media-bundle.ts
```

It accepts no path arguments, regenerates the allowlisted bundle from the
canonical root, writes the manifest last, and verifies bundle integrity plus
source drift before reporting success.

## Support promotion evidence

Promotion is exact and evidence-based:

- **discovery -> guided:** current primary installation and lifecycle sources,
  explicit image provenance or an explicit image-research gate, alternatives,
  platform limits, secret boundaries, exposure gates, backup implications, and
  a dated review.
- **guided -> managed:** a versioned adapter packaged entirely in the self-host skill;
  deterministic render; focused preflight; one explicitly owned, idempotent
  apply boundary; restart/reload acceptance; secret-free evidence; rollback;
  and copy-mode install proof.
- **stateful managed support:** additionally requires application-consistent
  backup evidence and an isolated restore that proves the declared data and
  acceptance scope.
- **VPN managed claims:** additionally require timestamped healthy egress,
  tunnel-break IP and DNS fail-closed evidence while the downloader stays
  running, restored egress, and route/firewall evidence.
- **public ingress managed claims:** additionally require DNS, TLS identity and
  expiry, authentication enforcement, route delivery, and direct-port privacy.
- **retired:** requires an upstream retirement or migration source and a named
  replacement or explicit unresolved replacement. It is never a new-install
  default.

One successful local run, HTTP 200, a running container, GitHub popularity, or
a Homarr app tile cannot promote support.

## Release checklist

- The single public skill is complete, portable, and self-contained.
- Frontmatter and `agents/openai.yaml` pass quick validation.
- Every JSON file parses and catalog semantics pass.
- The sorted registry exactly matches the public entry plus bundled workflow IDs; every
  managed `adapterSkill` is present, marked `kind: adapter`, and scoped to
  `application`; every direct bundle adapter is scoped to `stack`.
- Every stack `requiredSkills` entry and managed adapter exists.
- Every selectable Base, Pack, and Extension profile contains the full checked
  workflow dependency closure; mutation still requires user intent and exact approval.
- Local Markdown and script references resolve inside their install boundary.
- Essential README and contributing commands, flags, and paths match the
  static repository documentation contract.
- The exact Homarr image is
  `ghcr.io/homarr-labs/homarr-test:v2` in source, catalog, and media bundle.
- Media bundle integrity and canonical-source drift pass.
- Changed Bun TypeScript/Bash files pass syntax and their targeted fixtures.
- No runtime, secret, session, evidence, or client-install material is staged.
- Affiliate disclosures and legal owned-content boundaries remain accurate.
- Default symlink-mode and explicit `--copy` installer smoke both pass when
  installation packaging changed; run them through `scripts/smoke-install.sh`
  on Bun 1.4.0 or newer.
- The final diff contains only the intended source and generated release
  artifacts.
- Plugin templates, package, registry, indexes, tag, and archive versions all
  match.
- Two in-memory package builds produce the same SHA-256 digest.
