# Contributing

`self-host` is a Go CLI. Read `CONTEXT.md` for the vocabulary, `docs/adr/` for settled decisions, and `AGENTS.md` for the map and the gate. Participation is covered by the [Code of Conduct](CODE_OF_CONDUCT.md).

## Change

1. Open or pick a GitHub issue. Use the glossary's words in code, docs and commits.
2. Work test-first through the existing seams (see `docs/agents/implementing.md`). Add no dependency without checking `go.mod` and saying why in the pull request.
3. Update `CONTEXT.md` when a term changes, and `README.md` and `internal/skill/guide.md` when behaviour a person or agent sees changes.
4. Cite a current primary source for every upstream fact about an App (image, ports, first-run behaviour).

## Gate

Run this from the repository root and paste the result in the pull request:

```bash
export GOFLAGS=-buildvcs=false
gofmt -l .                       # must print nothing
go build ./... && go vet ./... && go vet -tags e2e ./e2e/
go test ./...
go test -race ./internal/tui/ ./internal/activity/   # plus any package with goroutines you touched
bash -n install.sh
```

Docker, e2e and browser runs happen only when the ticket asks.

For optional workflow execution on macOS, see [Local CI with act](docs/local-ci.md).

## Web and DCM

`site/` (self-host.fyi) and `dcm/` (Docker Compose Maker, self-host.fyi/compose) are one bun workspace. Run `bun install` at the root only; there is one `bun.lock`. Read `docs/agents/dcm.md` first.

- To add a container to DCM, edit `dcm/src/tools/` (or open a Container submission issue). An App in the Catalog is edited under `internal/apps/`, then `go run ./tools/sitegen` regenerates `site/src/data`, `dcm/src/data` and `site/src/styles`; never hand-edit those.
- Run when you touch `site/`, `dcm/` or `tools/sitegen/`:

```bash
bun install --frozen-lockfile
go run ./tools/sitegen
git add -N site/src/data dcm/src/data site/src/styles
git diff --exit-code site/src/data dcm/src/data site/src/styles
bunx turbo run build test lint check
```

`bun run test` in `dcm/` needs no Docker: it skips `dcm/tests/validate-compose.test.ts` because that runs `docker compose config`. CI adds it as `test:compose` (`bunx turbo run build test test:compose lint check`; locally `cd dcm && bun run test:compose`, Docker required). Turbo caches every task and the site build reads the release version and changelog from git and GitHub, which it cannot hash: set `SELF_HOST_SITE_VERSION=0.0.0` (as CI does) or add `--force` so a cache hit does not show a stale release.

## Pull requests

Use conventional commit titles, one ticket per branch, and end the body with `Closes #<n>`. Disclose material AI assistance. Keep secrets, private hosts and session data out of every file and screenshot.

- Be detailed, not padded. Say what was wrong, what you changed and why, in plain words. Prefer simple fixes; reviewers will push back on AI filler, restated diffs and speculative extras.
- Show the change. For anything a person can see, attach before and after screenshots in a table using `gh pr create --attach`, or the GitHub UI if you are not on the CLI.
- Large PRs need prior discussion. A pull request touching 100 or more files that was not agreed in an issue first is closed without review. Open an issue, get a yes, then split the work.
- Tests are welcome.
