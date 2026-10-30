# Repo-scoped agent skills: what to add, and how they stop drift

Question: which skills under `.claude/skills/` should this repository add so the
Go Catalog, the site and DCM stay in step, and what must each contain?
Requested by `.scratch/dcm-merge-spec.md:12` ("repo skills in `.claude/skills/`
built with skill-creator + writing-for-agents"). Other research notes live in
`docs/research/` and `docs/homarr-integration-coverage-research.md`; this one sits
at `docs/` root because the request named that path.

Date: 2026-10-30. Branch `dev-dcm-merge`.

## Result

Add three skills and one shared brief. Everything else already has a home that
works, or is too thin to earn an always-loaded description.

| Name                                                 | Invocation                              | One line                                                                                                                   |
| ---------------------------------------------------- | --------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `edit-catalog`                                       | model                                   | Add or change an App or Recipe, regenerate site and DCM data, fix the hand-kept counts.                                    |
| `add-container`                                      | model                                   | Add or edit a DCM-only Container, with the Container-vs-App collision check nothing automates today.                       |
| `release`                                            | user (`disable-model-invocation: true`) | Order the release gates from `docs/releasing.md` with completion criteria and approval stops. Optional, medium confidence. |
| `docs/agents/generated-data.md` (brief, not a skill) | pointer                                 | The drift map below, kept once and pointed at by both skills and `AGENTS.md`.                                              |

Fix first, or none of this ships: `.gitignore:8` ignores `/.claude/`, so a new
skill is silently untracked. See [Blocker](#blocker-gitignore-hides-new-skills).

## Method and limits

Read: `AGENTS.md`, `CONTRIBUTING.md`, `docs/agents/*`, `docs/releasing.md`,
`.claude/skills/release-visual/SKILL.md`, `.github/workflows/{ci,dcm-add-container,stars}.yml`,
`tools/sitegen/*`, `dcm/src/lib/{catalog,selfhost}.ts`, `internal/app/app.go`,
`internal/catalog/*_test.go`, `internal/skill/install.go`, and `git log -400`.
Authoring rules come from the local `writing-for-agents` (`SKILL.md`,
`SKILL-MECHANICS.md`) and `skill-creator` skills.

**Not verified: external documentation.** The fetches of the Anthropic Agent
Skills overview and best-practices pages, agentskills.io, and the Codex and
opencode docs were declined in this session, so none of them is cited. Claims that
depend on them are marked _unverified_ and listed in
[Discovery](#discovery-claudeskills-codex-opencode). Re-run them before relying on
those claims.

## Findings

### One skill exists, and the pointer pattern is already in use

- `.claude/skills/release-visual/SKILL.md` is the only repo skill: a
  description, three steps (Discover, Render, Embed), each with a checkable end,
  and a pointer to `docs/releasing.md` instead of a copy of it.
- `AGENTS.md` ("Agent skills") points at `docs/agents/*` briefs by trigger
  ("before adding or editing a container...", "Homarr integrations: before
  adding, repairing or verifying..."). Those are context pointers in the
  `writing-for-agents` sense, and they work in any agent that reads `AGENTS.md`
  (`CLAUDE.md` is a symlink to it).
- `skills/self-host/SKILL.md` is the product skill shipped to users. It is not a
  repo-maintenance skill and stays separate.

### What recurs in history

Counts from `git log --oneline -400`, grouped by conventional-commit scope:

| Workflow                    | Evidence                                                                                 | Has a brief?                                                                               |
| --------------------------- | ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| Add/change an App or Recipe | `feat(apps)` Cleanuparr (`ca78641b`, `00af75ef`), 5 `feat(catalog)`, `refactor(apps)` x4 | No                                                                                         |
| Homarr native wiring        | 11 `fix(homarr)`, about 40 `chore: reconcile accepted Homarr integrations`               | Yes, `docs/agents/homarr-integrations.md` (149 lines, 7 ordered steps, each with **Done**) |
| DCM Container               | 8 `fix(dcm)`, 4 `feat(dcm)`, issue-driven `dcm-add-container.yml`                        | Yes, `docs/agents/dcm.md`                                                                  |
| Release                     | 7 `feat(release)`, 5 `fix(release)`                                                      | Doc, not a brief: `docs/releasing.md`, 398 lines                                           |
| Site work                   | 27 `feat(site)`, 7 `fix(site)`                                                           | Constraints live in `dcm.md` (CSP, Tailwind scope); no repeatable workflow                 |
| Issue/PR filing             | `docs/agents/filing-issues.md`, 20 lines                                                 | Yes                                                                                        |
| e2e                         | 5 `test(e2e)`, 3 `fix(e2e)`                                                              | `e2e/README.md` (not read for this note)                                                   |

### What adding an App touches today

`ca78641b feat(apps): Cleanuparr (#554)` changed 13 files. That is the real
footprint, and no brief lists it:

- `internal/apps/cleanuparr/cleanuparr.go` and `cleanuparr_test.go`
- `internal/catalog/batch_misc2.go` (import plus `cleanuparr.App{}`)
- `docs/catalog/traps/cleanuparr.md` (the App's header comment points at it)
- `tools/sitegen/catalog.go` (`"cleanuparr": "png/cleanuparr.png"`; the icon tables now live in `icons.go`)
- `tools/sitegen/stars.go` (`"cleanuparr": "Cleanuparr/Cleanuparr"`)
- `site/src/data/catalog.json` (generated)
- `README.md` (count), `e2e/acceptance.md` (94 Apps), `e2e/acceptance_fixture_test.go`
  (`len(got) != 101`), `e2e/testdata/inventory.json`, two TUI onboarding goldens

Eight of the thirteen (README, `e2e/acceptance.md`, the fixture test,
`inventory.json`, the two goldens, the icon entry, the stars entry) are hand-edited
counts and declarations that no generator writes. That is where drift enters.

### Drift mechanisms that already exist

- **Generated data.** `go run ./tools/sitegen` writes `site/src/data/catalog.json`,
  `dcm/src/data/selfhost.json` and `site/src/styles/theme.css`; `-stars` writes
  `site/src/data/stars.json`. CI's `test` job runs it and `git diff --exit-code`
  on `site/src/data dcm/src/data site/src/styles` (`.github/workflows/ci.yml`,
  step "Generated data is current").
- **Icons.** `tools/sitegen/icons.go`: an App must be in `icons`
  (`""` means no icon); a missing, unknown or duplicated id fails sitegen.
- **Standalone guide.** `app.StandaloneGuide` is an optional App interface;
  `checkGuide` in sitegen fails when the guide names a variable or folder the
  converted compose does not read or mount.
- **Catalog tests.** `internal/catalog/`: `descriptions_test`, `parity_test`,
  `ownership_test`, `generated_test`, `secondary_ports_test`, `unavailable_test`,
  `homarr_recipe_test`.
- **Site schema and SEO.** `site/src/content.config.ts` validates `catalog.json`;
  `site/src/lib/seo.mjs` fails the build on a page missing its SEO or share tags.
- **DCM tests.** `dcm/tests`: `validate-all-containers`, `templates`,
  `validate-networks`, `compose-dedupe`, `compose-env`, and `validate-compose`
  (runs `docker compose config`; CI as `test:compose`).
- **Stars.** `.github/workflows/stars.yml` opens a weekly PR from `bun run stars`.

### Unguarded drift (found, not fixed here)

1. **`.gitignore:8` ignores `/.claude/`.** `release-visual` is tracked only
   because it was force-added (`git ls-files .claude` lists it; `git check-ignore`
   exits 1 for it but 0 for a fresh `.claude/skills/add-app/SKILL.md`).
2. **Container-vs-App collisions have no test.** `dcm/src/lib/selfhost.ts:44`
   holds `ALIASES` (7 hand-kept entries: `actualbudget`, `adguardhome`, `firefly`,
   `homeassistant`, `jellyseerr`, `overseerr`, `postgres`). `coveredByApp` in
   `dcm/src/lib/catalog.ts:82` only drops a Container whose id starts with
   `<app>-` and whose services the App already provides. A Container named
   `bitwarden` beside an App `vaultwarden`, or `nginxproxymanager` beside
   `nginx-proxy-manager`, shows up twice. No file under `dcm/tests` mentions
   `ALIASES` or `coveredByApp`.
3. **App counts are hand-kept and the README ones are unguarded.** `README.md`
   lines 17, 68, 85 say 93; `e2e/acceptance.md:3` says 94. The numbers match
   `site/src/data/catalog.json` (93 visible) and the full registry including the
   hidden Passbolt (`README.md:266`); that reading is an inference. The e2e count
   is pinned by `acceptance_fixture_test.go`; no test reads `README.md` for it.
4. **A missing `repos` entry in `tools/sitegen/stars.go` is not an error.** The App
   sorts last on the site (`stars.go:15`, lookup near line 128).
5. **Two hand-kept lists of agent skill directories:** `internal/skill/install.go`
   (`targets`) and `site/src/content/docs/docs/agents.md:18`.

## Discovery: `.claude/skills`, Codex, opencode

| Claim                                                                                                                                  | Status                | Source                                                                                                                                                                                                       |
| -------------------------------------------------------------------------------------------------------------------------------------- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Claude Code reads project skills from `.claude/skills/<name>/SKILL.md`                                                                 | **Observed**          | `release-visual` exists only in this repo's `.claude/skills/` (absent from `~/.agents/skills`, `~/.claude/skills`, `~/.config/opencode/skills`) and appears in this session's skill list.                    |
| Per-agent _user-level_ skill dirs                                                                                                      | **From the repo**     | `internal/skill/install.go` `targets`: `~/.agents/skills` (always), `~/.claude/skills`, `~/.codex/skills`, `~/.pi/agent/skills`, `~/.gemini/config/skills`, `~/.hermes/skills`, `~/.config/opencode/skills`. |
| Codex discovers _project_ `.claude/skills`                                                                                             | **Unverified**        | Needs the Codex docs.                                                                                                                                                                                        |
| opencode discovers project `.claude/skills`                                                                                            | **Unverified**        | The local `opencode` skill (v2.2.1) names `.opencode/` and a `skills` config field and says nothing about `.claude/skills`; `opencode debug` has no skill subcommand. Docs: `opencode.ai/v2/docs/`.          |
| `.agents/skills` is a cross-agent project path                                                                                         | **Unverified**        | Only the user-level `~/.agents/skills` appears in this repo's code.                                                                                                                                          |
| Frontmatter (`name`, `description` required), description as the trigger, three-level progressive disclosure, SKILL.md under 500 lines | **From local skills** | `skill-creator/SKILL.md` ("Progressive Disclosure": metadata always loaded, body under 500 lines), `writing-for-agents`. Anthropic's own docs not fetched.                                                   |
| `disable-model-invocation: true` makes a skill user-invoked only                                                                       | **From local skills** | `writing-for-agents/SKILL-MECHANICS.md` ("Invocation").                                                                                                                                                      |

Consequence: do not depend on skill discovery alone. Every new skill gets one
pointer line in `AGENTS.md` ("Agent skills"). That line is read by every agent
that reads `AGENTS.md`, costs one line, and keeps the skill body single-sourced.

To check later: Anthropic Agent Skills overview and best-practices, the
agentskills.io specification, the opencode V2 docs for skills and rules, and the
Codex docs for `AGENTS.md` and skills.

## Blocker: `.gitignore` hides new skills

`.gitignore:8` is `/.claude/`. A directory exclusion cannot be undone for a child
path, so a `!` line alone does nothing. Tested in a scratch repo: this pair
un-ignores skills and keeps the rest of `.claude/` ignored.

```gitignore
/.claude/*
!/.claude/skills/
```

Change line 8 accordingly in the same commit that adds the first skill.

## Authoring rules applied

From `writing-for-agents` and `skill-creator`:

- The description is a context pointer: lead with the one word the agent will see
  in a task (`Catalog`, `Container`), one trigger per branch, no synonyms.
- Every step ends on a checkable **Done**.
- Single source of truth: the environment (`ci.yml`, `package.json`, `--help`,
  the commit that did it last) already holds commands and file lists. Skills cache
  only what the agent cannot find by looking: order, gotchas, reasons.
- Positive targets ("run sitegen, then the diff is empty"), not prohibitions.
- Branch-only reference goes behind a pointer, not in `SKILL.md`; keep `SKILL.md`
  well under 500 lines (`release-visual` is 61).
- Model-invoked skills carry a description; user-invoked ones set
  `disable-model-invocation: true`.

## Recommended skills

### 1. `edit-catalog` (model-invoked)

Description draft:

> Catalog edits: add an App, change an App's Compose, env, notes or StandaloneGuide, change a Recipe, or hide an App. Regenerates site and DCM data and updates the hand-kept App counts.

Branches: new App; change existing App; Recipe; hide/unhide (the `unavailable`
map in `internal/catalog/catalog.go`). Hand off, do not
duplicate: Homarr wiring to `docs/agents/homarr-integrations.md`; a DCM-only
Container to `add-container`.

Steps, each with its completion criterion:

1. **Resolve upstream facts** (image, tag, ports, volumes, env) from the project's
   own docs or registry. _Done:_ each fact has a source URL in the PR body.
2. **Find an existing home.** Search `internal/apps/`, `dcm/src/tools/` and
   `ALIASES` (`dcm/src/lib/selfhost.ts`) for the product under any spelling.
   _Done:_ no hit, or the existing id is edited and a new one is not created.
3. **Write the App** in `internal/apps/<id>/<id>.go` with its test and
   `docs/catalog/traps/<id>.md`; copy the shape of the last App commit
   (`ca78641b`) rather than a described layout. _Done:_
   `go test ./internal/apps/<id>/` passes.
4. **Register** in a `internal/catalog/batch_*.go` (Recipes through
   `registerRecipes`). _Done:_ `go test ./internal/catalog/` passes.
5. **Declare site metadata** in `tools/sitegen`: icon in `icons`
   (`""` for none), upstream repo in `stars.go`'s `repos`. _Done:_ both entries
   exist; a missing `repos` entry would not fail anything, so check it by hand.
6. **Regenerate.** `go run ./tools/sitegen`. Add a `StandaloneGuide` only when the
   standalone Compose needs guidance; `checkGuide` must pass. _Done:_ a second run
   changes nothing and `git diff` shows only `site/src/data/catalog.json` and
   `dcm/src/data/selfhost.json`.
7. **Fix the hand-kept counts**: `README.md` (badge, intro, table),
   `e2e/acceptance.md`, `acceptance_fixture_test.go`, `e2e/testdata/inventory.json`,
   TUI onboarding goldens (`-update`, then read each). _Done:_ every count equals
   the registry length, with Apps hidden from new installs counted where the file
   already counts them.
8. **Gate.** The `AGENTS.md` local gate plus the web gate, since generated data
   changed. _Done:_ both exit 0.

Drift checks it owns: sitegen plus `git diff --exit-code`, icons, `repos`,
`StandaloneGuide`, counts, `ALIASES` (step 2).
Replaces: nothing; points to `docs/agents/dcm.md` ("How an App reaches DCM"),
`docs/agents/generated-data.md`, ADR 0001.

### 2. `add-container` (model-invoked)

Description draft:

> DCM Container: add or edit a Container in dcm/src/tools, including accepted `container` issues. Catalog Apps go to edit-catalog.

Steps:

1. **Collision check.** Search the App ids in `dcm/src/data/selfhost.json`, then
   `ALIASES`, for the product under any spelling and for an `<app>-` id prefix.
   _Done:_ none matches. A match means the App's Compose wins; stop and use
   `edit-catalog`. This is the check the repo does not automate.
2. **Cite image and ports** from a current primary source. _Done:_ URL recorded.
3. **Add the `DockerTool`** to the right `dcm/src/tools/<category>.ts`. _Done:_ it
   has a lowercase hyphenated `id`, `composeContent` starting `services:` with the
   `${PUID}`... variables, a `githubUrl`, and no `stars`.
4. **Run what you touched**: `validate-all-containers`, `templates`,
   `validate-networks` tests, then `bunx turbo run build lint`. _Done:_ all pass;
   leave `validate-compose` to CI.
5. **Issue path.** For a PR opened by `dcm-add-container.yml`, review it against
   steps 1 to 3. _Done:_ the diff touches only `dcm/src/tools/`.

Replaces: the "Add or edit a Container" section of `docs/agents/dcm.md`. Move its
five steps here and leave a one-line pointer, so the steps live once. The rest of
`dcm.md` (where things live, preloading, image, gate) stays as disclosed reference.
Drift checks it owns: collision and alias check, no hand-edited `stars`.

### 3. `release` (user-invoked, optional)

`disable-model-invocation: true`; the description is a one-line human summary.
Releases need the user's approval, so the agent should never fire this on its own.

Body: the gates of `docs/releasing.md` in order, each with a completion criterion
and a stop for approval before tag and publish: Prepare; Release from CI or
locally; Publish the channels; Verify; redeploy the site (the doc says to redeploy
after every release and that `publish-channels.sh` ends with `publish-site.sh`);
the new-Apps visual through `release-visual`. Link to doc sections, do not copy
them. Medium confidence: the doc is already the source of truth, so the skill adds
only ordering and stops. Write it last, and only after reading `docs/releasing.md`
end to end.

### Brief: `docs/agents/generated-data.md`

One home for the [drift map](#drift-map). `AGENTS.md` ("Ownership", "Generated
data") and both skills point at it. Skills with no description cannot share
reference; a plain file can (`SKILL-MECHANICS.md`, "Invocation").

## Considered and not recommended

- **`homarr-integration`.** The brief is already skill-shaped (ordered steps, a
  **Done** each) and the `AGENTS.md` pointer carries the branch trigger. A skill
  would be a second pointer to the same file.
- **`filing-issues` / `open-pr`.** 20 lines. A skill would duplicate it.
- **A standalone `drift-check` skill.** It would restate the `AGENTS.md` web gate
  and `ci.yml`. Put the checks in each workflow's last step and the map in the
  brief.
- **`site` work.** No repeatable workflow in 34 commits; constraints are in
  `docs/agents/dcm.md`.
- **`e2e`.** Not enough read to recommend. `AGENTS.md` forbids running it for a
  focused change; revisit after reading `e2e/README.md`.

## Drift map

Every shared fact, its source of truth, what is derived from it and what fails
when they disagree.

| Fact                                              | Source of truth                                                        | Derived artifact                                                                                                                     | Check                                                                                                                                         |
| ------------------------------------------------- | ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------- |
| App id, name, description, category, ports, image | `internal/apps/<id>/`, registered in `internal/catalog/batch_*.go`     | `site/src/data/catalog.json`, `dcm/src/data/selfhost.json`                                                                           | CI "Generated data is current"; `site/src/content.config.ts`; `descriptions_test`, `ownership_test`, `secondary_ports_test`, `generated_test` |
| Standalone Compose, env, notes                    | App plus optional `StandaloneGuide` through `tools/sitegen/standalone` | `dcm/src/data/selfhost.json`                                                                                                         | `checkGuide` in sitegen; `dcm/tests/validate-compose.test.ts` (CI `test:compose`)                                                             |
| Icon                                              | `tools/sitegen/icons.go` (`icons`)                                     | icon path in both JSON files                                                                                                         | `checkIcons` fails sitegen                                                                                                                    |
| Stars                                             | `tools/sitegen/stars.go` `repos`                                       | `site/src/data/stars.json`, `dcm/src/data/stars.json`                                                                                | `stars.yml` weekly PR; **none** for a missing `repos` entry                                                                                   |
| Recipes                                           | `registerRecipes` in `internal/catalog/batch_recipes.go`               | `selfhost.json` recipes, DCM Templates                                                                                               | `parity_test`, `homarr_recipe_test`                                                                                                           |
| Hidden App | `unavailable` map, `internal/catalog/catalog.go:42` | omitted from `Catalog.Apps()`, so from the site and new installs; `AllApps()` keeps it | `unavailable_test` |
| Dashboard theme                                   | `tui.DarkColors`                                                       | `site/src/styles/theme.css`                                                                                                          | sitegen diff in CI                                                                                                                            |
| DCM-only Container                                | `dcm/src/tools/<category>.ts`                                          | merged by `dcm/src/lib/catalog.ts`                                                                                                   | `validate-all-containers`, `templates`, `validate-networks`, `compose-dedupe`, `compose-env`                                                  |
| Container id to App id                            | `ALIASES`, `coveredByApp`                                              | one merged DCM entry                                                                                                                 | **none**                                                                                                                                      |
| App counts                                        | registry length                                                        | `README.md` 17/68/85; `e2e/acceptance.md:3`; `e2e/acceptance_fixture_test.go`; `e2e/testdata/inventory.json`; TUI onboarding goldens | e2e fixture test and goldens fail; **none** for README                                                                                        |
| CLI command table                                 | registered commands                                                    | `internal/skill/guide.md`                                                                                                            | `TestSkillGuideCommandsTableListsEveryRegisteredCommand`                                                                                      |
| New-App release visual                            | App ids at two refs                                                    | `scripts/release-new-apps.sh` output                                                                                                 | `release-visual` skill                                                                                                                        |
| Agent skill directories                           | `internal/skill/install.go` `targets`                                  | `site/src/content/docs/docs/agents.md:18`                                                                                            | **none**                                                                                                                                      |

## Decisions for the owner

1. Merge the `.gitignore` change first. Without it, step 1 of every skill fails
   silently.
2. Close the Container-vs-App gap with a check, not a reminder. Options: a
   `dcm/tests` case that fails when a Container id equals an App id or alias
   target, or the skill's step 1 only. The first needs a test, which your rules say
   to add only on request.
3. Count drift: derive the README and e2e counts from sitegen output, or keep
   step 7 as the guard. Deriving removes five of the thirteen hand-edited files
   per App (README, `e2e/acceptance.md`, the fixture test, two goldens); keeping step 7 costs nothing to build.
4. Re-run the declined external lookups before closing the discovery table.
