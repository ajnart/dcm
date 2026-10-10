# Contributing

`self-host` is a Go CLI. Read `CONTEXT.md` for the vocabulary, `docs/adr/` for settled decisions, and `AGENTS.md` for the map and the gate.

## Change

1. Open or pick a GitHub issue. Use the glossary's words in code, docs and commits.
2. Work test-first through the existing seams (see `docs/agents/implementing.md`). Add no dependency without checking `go.mod` and saying why in the pull request.
3. Update `CONTEXT.md` when a term changes, and `README.md` and `internal/skill/guide.md` when behaviour a person or agent sees changes.
4. Cite a current primary source for every upstream fact about an App (image, ports, first-run behaviour).

## Gate

CI cannot run for now, so run this from the repository root and paste the result in the pull request:

```bash
export GOFLAGS=-buildvcs=false
gofmt -l .
go build ./... && go vet ./... && go vet -tags e2e ./e2e/
go test ./...
go test -race ./internal/tui/ ./internal/activity/
bash -n install.sh
```

Docker, e2e and browser runs happen only when the ticket asks.

## Pull requests

Use conventional commit titles, one ticket per branch, and end the body with `Closes #<n>`. Disclose material AI assistance. Keep secrets, private hosts and session data out of every file and screenshot.
