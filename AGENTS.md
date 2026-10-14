# Repository agent guide

`self-host` is one Go binary that installs and operates self-hosted apps with Docker Compose, for people through a terminal Dashboard and for agents through plain commands. The module is at the repository root. Read `CONTEXT.md` first and use its words exactly.

## Map

- `cmd/self-host/`: entry point. `internal/cli/` maps subcommands onto `internal/service/`, which implements every Project operation; `internal/tui/` is the Dashboard over the same service.
- `internal/apps/<id>/` and `internal/catalog/`: each App compiled into the binary, and the Catalog and Recipes. `internal/app/` is the App contract; `internal/helpers/` is the toolkit every Setup uses.
- `internal/skill/guide.md`: the agent guide embedded in the binary, printed by `self-host skill`.
- `skills/self-host/SKILL.md`: the one discoverable skill, a router to `self-host skill`.
- `internal/system/` holds every outside dependency; `internal/systemtest/` and `internal/clitest/` fake it for tests.
- `site/`: the static Astro site at self-host.fyi; `go run ./tools/sitegen` writes its `src/data/catalog.json` from the Catalog and `theme.css` from the Dashboard theme; `-stars` also refreshes GitHub star counts. `video/`: the showreel.
- `e2e/` (build tag `e2e`, runs Docker), `tools/` (development generators), `scripts/verify-install.sh`, `install.sh`, `.goreleaser.yaml`.
- `docs/`: `adr/` decisions, `agents/` briefs for agents, `releasing.md`, `spec.md`, and proofs under `docs/*-proof.*`. Files named `legacy-*`, `where-to-look.md` and `handoff.md` describe the removed TypeScript product and are historical.

## Ownership

One package owns one boundary. Do not reach around it.

- Running `docker compose`: `internal/compose/` only.
- Machine inspection and Host settings: `internal/host/`.
- Project directory, secrets, state: `internal/project/`.
- Backup archives: `internal/backup/`. Release lookup, install and self-update: `internal/release/`.
- Progress reporting: `internal/events/`; what a person sees of it: `internal/activity/`.

## Protected invariants

- Inspect, plan, approval, apply, verify. Loading the skill conveys intent, never approval (ADR 0005).
- Apps share one Compose Project, the mutation boundary. No broad Docker teardown, prune, volume deletion or casual socket mount.
- Secrets live only in the Project's `secrets.env`. Keep them out of arguments, output, fixtures and screenshots. Treat `.sessions/`, `.env*`, credential stores and browser profiles as out of scope: never read or print them.
- Container liveness and HTTP 200 are narrow observations, not acceptance.
- Existing `--json` keys, non-TTY output and persisted formats keep working; new fields are additive.
- Telemetry follows ADR 0006.

## Local gate

CI cannot run (account billing), so these runs from the repository root are the gate:

```bash
export GOFLAGS=-buildvcs=false
gofmt -l .                       # must print nothing
go build ./... && go vet ./... && go vet -tags e2e ./e2e/
go test ./...
go test -race ./internal/tui/ ./internal/activity/   # plus any package with goroutines you touched
bash -n install.sh
```

Never run Docker, the e2e runtime, a browser or the installer for a focused change. Add dependencies only after checking `go.mod`, and say why in the PR.

## Working rules

Preserve concurrent work: check `git status` before and after edits and stage only files you own. Use conventional commits. Exploration subagents are read-only; keep their reports short and source-backed.

## Agent skills

- Homarr integrations: before adding, repairing or verifying native wiring, read `docs/agents/homarr-integrations.md`.
- Issue tracker: GitHub Issues for `ajnart/self-host`. Read `docs/agents/issue-tracker.md` before tracker operations.
- Triage labels: the five defaults. Read `docs/agents/triage-labels.md` before triaging.
- Domain docs: one context, `CONTEXT.md`, with ADRs in `docs/adr/`. Read `docs/agents/domain.md` before exploring the code or changing the domain.
- Filing an issue or opening a PR: read `docs/agents/filing-issues.md` first.
- Spec #191 tickets: read `docs/agents/implementing.md` before working on any of them.
