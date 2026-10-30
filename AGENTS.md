# Repository agent guide

`self-host` is one Go binary that installs and operates self-hosted apps with Docker Compose, for people through a terminal Dashboard and for agents through plain commands. The module is at the repository root. Read `CONTEXT.md` first and use its words exactly.

## Map

- `cmd/self-host/`: entry point. `internal/cli/` maps subcommands onto `internal/service/`, which implements every Project operation; `internal/tui/` is the Dashboard over the same service.
- `internal/apps/<id>/` and `internal/catalog/`: each App compiled into the binary, and the Catalog and Recipes. `internal/app/` is the App contract; `internal/helpers/` is the toolkit every Setup uses.
- `internal/skill/guide.md`: the agent guide embedded in the binary, printed by `self-host skill`.
- `skills/self-host/SKILL.md`: the one discoverable skill, a router to `self-host skill`.
- `internal/system/` holds every outside dependency; `internal/systemtest/` and `internal/clitest/` fake it for tests.
- `site/`: the static Astro site at self-host.fyi; `go run ./tools/sitegen` writes its `src/data/catalog.json` from the Catalog and `theme.css` from the Dashboard theme; `-stars` also refreshes GitHub star counts. `video/`: the showreel; renders in `video/reel/out/` are git-ignored, the served file is the committed `site/public/reel.mp4`.
- `dcm/`: DCM (Docker Compose Maker), the source library behind self-host.fyi/compose and the `ghcr.io/ajnart/dcm` image (React components, hooks, Container definitions, tests, generated data). It has no Astro app: `site/src/pages/compose/` renders it, and `@/` in `site/` means `dcm/src`. Container definitions are `dcm/src/tools/*.ts`, tests are `dcm/tests`. `go run ./tools/sitegen` also writes `dcm/src/data/selfhost.json`, one compose per App. Read `docs/agents/dcm.md` before touching it.
- Root `package.json` and `turbo.json` make `site/` and `dcm/` one bun workspace with one `bun.lock`; run `bun install` at the root only.
- `docs/migration/` is the runbook that made this repository the home of `ajnart/dcm`'s history.
- `e2e/` (build tag `e2e`, runs Docker), `tools/` (development generators), `scripts/verify-install.sh`, `install.sh`, `.goreleaser.yaml`.
- `docs/`: `adr/` decisions, `agents/` briefs for agents, `releasing.md`, `spec.md`, and proofs under `docs/*-proof.*`. Files named `legacy-*`, `where-to-look.md` and `handoff.md` describe the removed TypeScript product and are historical.

## Ownership

One package owns one boundary. Do not reach around it.

- Running `docker compose`: `internal/compose/` only.
- Machine inspection and Host settings: `internal/host/`.
- Project directory, secrets, state: `internal/project/`.
- Backup archives: `internal/backup/`. Release lookup, install and self-update: `internal/release/`.
- Progress reporting: `internal/events/`; what a person sees of it: `internal/activity/`.
- Generated data: `tools/sitegen` owns `site/src/data/`, `site/src/styles/theme.css` and `dcm/src/data/`. Change the Go App or the generator and rerun it; leave generated files to it.
- DCM-only containers: `dcm/src/tools/`. Apps in the Catalog come from `internal/apps/` and are edited there.

## Protected invariants

- Inspect, plan, approval, apply, verify. Loading the skill conveys intent, never approval (ADR 0005).
- Apps share one Compose Project, the mutation boundary. No broad Docker teardown, prune, volume deletion or casual socket mount.
- Secrets live only in the Project's `secrets.env`. Keep them out of arguments, output, fixtures and screenshots. Treat `.sessions/`, `.env*`, credential stores and browser profiles as out of scope: never read or print them.
- Container liveness and HTTP 200 are narrow observations, not acceptance.
- Existing `--json` keys, non-TTY output and persisted formats keep working; new fields are additive.
- Telemetry follows ADR 0006.

## Local gate

These runs from the repository root are the gate:

```bash
export GOFLAGS=-buildvcs=false
gofmt -l .                       # must print nothing
go build ./... && go vet ./... && go vet -tags e2e ./e2e/
go test ./...
go test -race ./internal/tui/ ./internal/activity/   # plus any package with goroutines you touched
bash -n install.sh
```

Run the web gate only when you touch `site/`, `dcm/` or `tools/sitegen/`:

```bash
bun install --frozen-lockfile
go run ./tools/sitegen && git diff --exit-code site/src/data dcm/src/data site/src/styles
bunx turbo run build test lint check
```

Turbo caches every task: an unchanged repeat run is instant, and the site build's inputs include `dcm/src`. `turbo run test` skips `dcm/tests/validate-compose.test.ts` because it runs `docker compose config`; CI runs it as `test:compose`. The site build reads the version and changelog from git and GitHub, which turbo cannot hash, so a local cache hit can show a stale release: set `SELF_HOST_SITE_VERSION` (CI uses `0.0.0`) or run with `--force`.

Never run Docker, the e2e runtime, a browser or the installer for a focused change. Add dependencies only after checking `go.mod`, and say why in the PR.

## Working rules

Preserve concurrent work: check `git status` before and after edits and stage only files you own. Use conventional commits. Exploration subagents are read-only; keep their reports short and source-backed.

## Agent skills

- Catalog: before adding an App, changing an App's image, port, Compose, env or notes, editing a Recipe or hiding an App, load the `edit-catalog` skill (`.claude/skills/edit-catalog/SKILL.md`).
- DCM Container: before adding or editing a Container in `dcm/src/tools/`, load the `add-container` skill (`.claude/skills/add-container/SKILL.md`).
- Generated data: before changing `site/src/data/`, `dcm/src/data/`, `site/src/styles/theme.css`, an icon, a star repository or an App count, read `docs/agents/generated-data.md`.
- DCM (`dcm/`): before adding or editing a container, a template, the generated data or the DCM build, read `docs/agents/dcm.md`.
- Homarr integrations: before adding, repairing or verifying native wiring, read `docs/agents/homarr-integrations.md`.
- Issue tracker: GitHub Issues for `ajnart/self-host`. Read `docs/agents/issue-tracker.md` before tracker operations.
- Triage labels: the five defaults. Read `docs/agents/triage-labels.md` before triaging.
- Domain docs: one context, `CONTEXT.md`, with ADRs in `docs/adr/`. Read `docs/agents/domain.md` before exploring the code or changing the domain.
- Filing an issue or opening a PR: read `docs/agents/filing-issues.md` first.
- Spec #191 tickets: read `docs/agents/implementing.md` before working on any of them.
