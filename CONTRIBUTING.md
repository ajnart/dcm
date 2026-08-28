# Contributing

This repository is a declarative catalog plus composable operational
capabilities. Prefer a small catalog change over a new skill, and prefer a
focused capability over an application-specific automation fork.

## Choose the right change

Add or update a catalog record when the contribution is product facts:
categories, roles, alternatives, dependencies, lifecycle, official sources,
image provenance, Homarr support, safety notes, or stack selection.

Add a stack when a user goal needs a reusable set of roles, choices, gates,
required skills, and acceptance checks.

Add an application-specific skill only when the application has stable,
reusable behavior that cannot be expressed safely through the catalog and
generic host, Compose, ingress, backup, operations, or verification
capabilities. Examples include a special API lifecycle, a first-run state
machine, or protocol-specific evidence. A dashboard link, Compose snippet, or
list of ports is not enough.

## Catalog workflow

1. Update the relevant JSON under
   `.agents/skills/selfhost/references/catalog/`.
2. Keep upstream product facts separate from container image facts.
3. Add a current primary source for every technical, lifecycle, license, and
   image-provenance claim. Label vendor and community packaging separately.
4. Record `checkedAt` with the date actually checked. Use `active`,
   `transitioning`, `verify`, or `retired` accurately, including a migration or
   replacement source where applicable.
5. Keep T0/T1/T2 as curation priority. Set `managed`, `guided`, `discovery`,
   or `retired` from evidence, never popularity.
6. Update a goal stack only when its roles, defaults, gates, required skills,
   or acceptance contract changes.
7. Run the semantic catalog validator and the repository gate.

```bash
node .agents/skills/selfhost/scripts/selfhost.mjs catalog validate --json
node scripts/validate-repo.mjs
```

The JSON schemas document the declarative contract; the catalog script enforces
cross-record semantics, aliases, alternatives, dependencies, lifecycle,
support, affiliate rules, and the Homarr image contract.

## Creating a skill

New skill directories must be initialized with the `init_skill.py` supplied by
the installed `skill-creator` skill. Do not hand-scaffold a partial directory.

```bash
python3 /path/to/skill-creator/scripts/init_skill.py selfhost-example \
  --path .agents/skills \
  --resources scripts,references,assets
```

Select only the resource directories the skill needs. Then:

1. Keep canonical Agent Skills frontmatter in `SKILL.md`; `name` must match the
   directory.
2. Add `agents/openai.yaml` with a concise interface and a default prompt that
   explicitly names `$selfhost-example`.
3. Add the exact ID to
   `.agents/skills/selfhost/references/catalog/skills.json` in sorted order.
   Set `adapter: true` only for an application adapter; registry IDs must
   exactly equal the packaged skill directories. Update
   `schemas/skills.schema.json` only when the registry shape changes.
4. Keep runtime dependencies inside that skill directory so copy-mode installs
   work.
5. Use shallow references and resolve all scripts relative to `SKILL.md`.
6. Return bounded `pass`, `warn`, `blocked`, or `conflict` results.
7. Keep inspection and planning read-only. Put every mutation behind an exact,
   separately approved owner.

## Fixtures and focused validation

Each changed planner or validator needs a small, secret-free fixture that
proves its new branch and its nearest rejection boundary. Reuse an existing
fixture shape when possible. A catalog-only change normally needs catalog and
repository validation, not Docker or browser testing.

For a script change:

- run `node --check` on changed Node files or `bash -n` on changed shell files;
- invoke only the changed script's minimal passing and failing fixture;
- verify deterministic output and nonzero failure status;
- keep inputs bounded, non-symlinked where required, and free of credentials;
  and
- report checks that were not run instead of expanding into a full stack test.

Run Docker, browser, installer, or live-host acceptance only when the change
owns that surface and the operator explicitly requests it. The installer smoke
test uses npx package resolution and is never an implicit validation step.

## Privacy, secrets, and generated state

- Store only opaque secret references in plans, catalog records, fixtures, and
  evidence. Never commit credentials, API keys, cookies, private keys, session
  state, interpolated Compose output, or private host URLs.
- Do not inspect `.sessions/`, `.env*`, credential stores, or existing client
  sessions while contributing.
- Keep `.selfhost/preferences.json` non-secret and untracked.
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

## Support promotion evidence

Promotion is exact and evidence-based:

- **discovery -> guided:** current primary installation and lifecycle sources,
  explicit image provenance or an explicit image-research gate, alternatives,
  platform limits, secret boundaries, exposure gates, backup implications, and
  a dated review.
- **guided -> managed:** a versioned adapter packaged entirely in its skill;
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

- All skill directories are complete, portable, non-symlinked packages.
- Frontmatter and `agents/openai.yaml` pass quick validation.
- Every JSON file parses and catalog semantics pass.
- The sorted skill registry exactly equals packaged skill directories; every
  managed `adapterSkill` is present and marked `adapter: true`.
- Every stack `requiredSkills` entry and managed adapter exists.
- Local Markdown and script references resolve inside their install boundary.
- Essential README and contributing commands, flags, and paths match the
  static repository documentation contract.
- The exact Homarr image is
  `ghcr.io/homarr-labs/homarr-test:v2` in source, catalog, and media bundle.
- Media bundle integrity and canonical-source drift pass.
- Changed Node/Bash files pass syntax and their targeted fixtures.
- No runtime, secret, session, evidence, or client-install material is staged.
- Affiliate disclosures and legal owned-content boundaries remain accurate.
- Default symlink-mode and explicit `--copy` installer smoke both pass when
  installation packaging changed; run them through `scripts/smoke-install.sh`
  on Node.js 22.20.0 or newer.
- The final diff contains only the intended source and generated release
  artifacts.
