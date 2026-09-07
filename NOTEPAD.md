# Capability improvement notepad

This is the working acceptance ledger for turning the repository from a
planning-oriented collection into an intentional, resumable stack lifecycle.
An item moves to `proved` only when its named evidence passes.

## Research synthesis

The source-backed comparison in
[research/skills-repo-patterns.md](research/skills-repo-patterns.md) covers the
Agent Skills specification plus the active Anthropic, OpenAI Plugins,
Superpowers, Vercel agent-skills, and Vercel Skills CLI repositories. Their
shared patterns and the corresponding repository decisions are:

| Shared pattern | Decision here |
| --- | --- |
| Small discovery metadata and progressive disclosure | Keep each `SKILL.md` short; route detail into one-level `references/`, deterministic `scripts/`, and packaged `assets/`. |
| Concrete triggers, ordered workflows, stop rules, and evidence gates | Keep planning implicit, make setup/upkeep explicit, and require typed lifecycle evidence before state advances. |
| Complete skill-directory installation | Test both link and copy installs after removing the source checkout. |
| Deterministic tooling for fragile operations | Use Bun TypeScript with JSON output, strict schemas, atomic private writes, hashes, and focused fixtures. |
| Repository-native composition because the portable format has no dependency model | Keep one checked registry plus additive profiles with exact, cycle-free dependency closure. |
| Installer state, desired workflow state, and observed reality are different | Leave `skills-lock.json` to the installer, use `.selfhost/stack.json` for secret-free continuation, and re-inspect the host before action. |
| Safety and authorization are procedural | Preserve inspect -> plan -> approval -> apply -> verify and one-project ownership in both prose and code. |
| Behavioral pressure tests catch instruction failures | Exercise positive routing, explicit-only activation, missing prerequisites, stale/tampered state, no-op updates, and secret-like evidence rejection. |

## Baseline gaps

| Priority | Gap | Required outcome | Evidence | State |
| --- | --- | --- | --- | --- |
| P0 | Flat installation | `skills add` clearly offers base, pack, and extension choices; every profile has a checked dependency closure. | Current CLI list, exact 14-skill discovery, and 9-skill media install | proved |
| P0 | Plan-only entry point | A user-invoked setup skill owns prerequisite, plan, approval, apply, verification, and handoff sequencing. | Explicit-only metadata plus setup behavior scenarios | proved |
| P0 | Browser assumed present | Setup detects and installs the official `agent-browser` skill, CLI, and browser runtime when absent, then loads its live core workflow. | Non-mutating missing check, gated doctor fixture, and live official-repository lookup | proved |
| P0 | Weak continuation record | Every setup writes private `.selfhost/stack.json` metadata that upkeep and extensions can resume deterministically. | Init/show/resume/extend/checkpoint and lock-integrity fixtures | proved |
| P0 | Password persisted | Setup tells the user the generated `admin` password while never writing that password to disk. | Five-part password, handoff, child-process, and filesystem verifier | proved |
| P0 | API reuse is awkward | Private `connections.env` stores service URLs, usernames, and API keys for dependent extensions without storing the initial password. | Exact schema, mode, missing, symlink, and tamper checks | proved |
| P0 | Experiment framing | The media pack is a purposeful setup workflow, not a candidate competition, and ends only after the full seven-service acceptance matrix passes. | Runbook contract and exact typed verification obligations | proved |
| P1 | No upkeep entry point | A user-invoked upkeep skill resumes, extends, updates, repairs, and re-verifies the exact recorded stack. | Eight upkeep scenarios with pre-apply continuation, media extension, and adapter-owned accepted-state validation | proved |
| P1 | Extension ambiguity | Extensions declare required skills, consuming service records, approval gates, and verification obligations before mutation. | Install-profile closure and lifecycle validation | proved |
| P1 | Runtime drift | The portable media bundle, generated indexes, release package, and installer layouts remain exact after every lifecycle change. | 37-file source-drift, package, index, and detached-install gates | proved |

## Iterations

| Iteration | State | Findings |
| --- | --- | --- |
| 0 - audit | complete | Twelve flat skills were installable, but the router stopped at planning, browser installation was forbidden, project state was secret-free but insufficient for extension wiring, and `credentials.env` persisted the derived password. |
| 1 - lifecycle design | complete | Added explicit setup/upkeep skills, checked install profiles, private stack metadata, browser prerequisite repair, and password-free connection storage. |
| 2 - media conversion | complete | Replaced candidate language and made the browser-backed seven-service setup the primary pack workflow; deterministic APIs configure supported services while browser evidence covers UI-only boundaries. |
| 3 - adversarial verification | complete | Proved missing prerequisites, non-mutating browser inspection, exact install selections, concurrent-state defenses, adapter-owned resume checks, credential handoff, reproducible packaging, and independent use after source removal. |

## Delivery plan and gates

1. Freeze the existing safety and ownership invariants and map every change to
   one owning skill, canonical runtime source, schema, or release surface.
2. Model installation as an additive graph: eight-skill Homarr-enabled `basic`, optional
   `media` pack, independent extensions, exact transitive closure, and cycle
   rejection. Keep this product contract separate from portable frontmatter.
3. Expose the graph through portable Base, Media pack, and Optional description
   labels, add numbered display names for clients that support them, and emit
   repeated `--skill` commands from the setup prerequisite check.
4. Add explicit-only setup and upkeep entry points. Setup owns prerequisite
   repair and orchestration; upkeep owns deterministic continuation and branch
   selection. Neither bypasses the existing apply owners.
5. Provision browser automation in three independent layers: skill directory,
   Bun-installed CLI, and browser runtime. Keep the first check non-mutating,
   gate the official doctor behind approval, then load the live browser workflow
   before UI configuration.
6. Add the private lifecycle record with strict profile closure, service
   ownership, runtime pointers, monotonic checkpoints, atomic mode-`0600`
   writes, and tamper/no-op rejection.
7. Replace the password-bearing credential view with a private connection
   file containing only reusable URLs, usernames, and available API keys.
   Derive and display the generated password only in the final handoff.
8. Convert the media harness from experiment language to one purposeful,
   browser-backed seven-service runbook. Keep deterministic API configuration
   where supported, use the browser for UI-only steps and evidence, regenerate
   the portable bundle from canonical sources, and reject any drift.
9. Validate metadata, behavior seams, Bash and Bun TypeScript entrypoints,
   registry/catalog semantics, package reproducibility, installer link/copy
   layouts, selected-profile contents, and independent use after source removal.
10. Perform an independent requirement and diff audit, record exact proof in
    this ledger, make one coherent commit, push `main`, and verify remote CI.

## Proof recorded 2026-09-07

| Gate | Result |
| --- | --- |
| Primary-source research | Commit-pinned comparison of the Agent Skills specification and six prominent first-party repositories; common patterns are reflected above. |
| Repository and package | All 7 validation groups pass; registry, profiles, metadata, public surface, generated indexes, reproducible package, and 12 repository contracts are green. |
| Behavior | All 14 skills are covered and pass. Setup proves project/scope-isolated prerequisites, gated browser checks, safe stale-lock recovery, and explicit profile-to-service bindings; upkeep accepts pending pre-apply adapter state, then checks valid, missing, symlinked, and tampered accepted connection state. |
| Real Skills CLI | Lists exactly 14 grouped choices, verifies link and copy modes, installs the exact 9-skill media profile, and runs every detached install after source removal. The official `vercel-labs/agent-browser` source resolves exactly the `agent-browser` skill. |
| Password and connections | All 5 focused verifier sections pass; the generated password is derived only for authorized handoff, the private connection file contains exact reusable fields and no password, and legacy password-bearing files remain safely destroyable. |
| Generated media | All 37 bundle files verify and match canonical sources, with only the two declared portability transforms. |
| Performance | Thirty-run p95 is 38.56 ms for catalog, 42.50 ms for photos, and 38.59 ms for backups against a 500 ms budget. |
| Independent review | Fresh read-only spec and standards audits report no remaining concrete P0/P1 gap after checking canonical sources, generated artifacts, and the complete worktree diff. |
| Source policy | No tracked `.js`, `.mjs`, `.cjs`, or `.jsx` source exists; executable implementation is Bun TypeScript and Bash. |

## Completion bar

Every repository-level completion criterion is proved: no tracked JavaScript
source files, no password in project or connection metadata, all API-bearing
files private and ignored, a clean install of selected profiles, deterministic
resume and extension behavior, exact generated artifacts, and green repository,
behavior, package, installer, and browser-prerequisite gates.

A live host deployment remains intentionally per invocation: this repository
change did not invent a target project or bypass the required host inspection
and apply approval. The setup workflow now owns that full path when invoked.
