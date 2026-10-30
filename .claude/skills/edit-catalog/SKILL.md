---
name: edit-catalog
description: Catalog edits in Go. Use for any task that adds an App, changes an App's image, port, Compose, env, notes or StandaloneGuide (even a one-line image bump), changes a Recipe, or hides or unhides an App. Each of these changes generated site and DCM data and hand-kept App counts. DCM-only Containers go to add-container; Homarr wiring goes to docs/agents/homarr-integrations.md.
---

# Edit the Catalog

Read `CONTEXT.md` for App, Recipe and Catalog, and `docs/agents/generated-data.md` for what is derived from what and which counts are hand-kept. For a new App, copy the shape of the last one: `git show --stat ca78641b` (Cleanuparr).

Pick the branch, then run its steps in order:

- **New App**: steps 1 to 8.
- **Change an App**: steps 1, 2, 6 and 8, plus 5 when its repository or icon changes. Edit the App's package under `internal/apps/`; its directory is the id without hyphens or a shorter name (`paperless-ngx` lives in `paperlessngx`), so find it with `grep -rl 'ID: "<id>"' internal/apps`.
- **Change a Recipe**: edit `registerRecipes` in `internal/catalog/batch_recipes.go`, then steps 6, 7 and 8.
- **Hide or unhide an App**: edit `unavailable` in `internal/catalog/catalog.go` with the reason and the issue that tracks the way back, then steps 6, 7 and 8.

## 1. Resolve upstream facts

Take the image, tag, ports, volumes and env from the project's own docs or registry page, not from memory or an aggregator.

**Done:** each fact has a source URL you can put in the PR body.

## 2. Find an existing home

Search `internal/apps/`, `internal/catalog/`, `dcm/src/tools/` and `ALIASES` in `dcm/src/lib/selfhost.ts` for the product under every spelling (`actualbudget` against `actual-budget`).

**Done:** no hit, so you add one App, or you edit the existing App and add none. Every Container for the same product in `dcm/src/tools` has the App's id or an `ALIASES` key for it; otherwise DCM lists the product twice. Add the missing `ALIASES` entry in the same change.

## 3. Write the App

Add `internal/apps/<name>/<name>.go` and its test, where `<name>` is the id without hyphens, and `docs/catalog/traps/<id>.md`, which keeps the hyphens. `Info().ID` is the id itself. The description is at most 100 characters in plain words (`internal/catalog/descriptions_test.go` enforces it). Extra services are named `<id>-...`. Setup follows `internal/helpers/` and the Protected invariants in `AGENTS.md`: Secrets stay in `secrets.env`.

**Done:** `go test ./internal/apps/<name>/` passes.

## 4. Register

Add the import and `<name>.App{}` to a `batch_*.go` in `internal/catalog/`, in alphabetical order. `generated.go` is generated; leave it.

**Done:** `go test ./internal/catalog/` passes. A `parity_test.go` failure on a ported App means a legacy fact changed: add a `deviations` entry with the reason; leave `legacy-facts.json` as it is.

## 5. Declare site metadata

In `tools/sitegen/icons.go` add the id to `icons` with its Dashboard Icons path (`""` for none); sitegen's error names the entry when one is missing. In `tools/sitegen/stars.go` add the upstream repository to `repos`. Nothing fails when `repos` lacks the App; its star count never appears.

**Done:** `grep -n "<id>" tools/sitegen/icons.go tools/sitegen/stars.go` prints a line from each file.

## 6. Regenerate

```bash
go run ./tools/sitegen
```

Add `StandaloneGuide` to the App only when its standalone Compose needs a sentence of guidance; sitegen fails when the guide names a variable or folder the converted Compose lacks.

**Done:** a second run changes nothing, and `git status` shows only your files plus `site/src/data/catalog.json` and `dcm/src/data/selfhost.json`.

## 7. Fix the counts

Follow the "App counts" table in `docs/agents/generated-data.md`: README, `e2e/acceptance.md`, the fixture and `inventory.json`, and the TUI goldens (`go test ./internal/tui -update`, then read the diff). The counts differ on purpose, so move each by the amount that table gives.

**Done:** the `jq` and `grep` commands in that page show the new numbers, and `go test ./e2e/ ./internal/tui` passes.

## 8. Gate

Run the Go gate from `AGENTS.md`, then the web gate: generated data changed. Never run Docker, `e2e` or the installer.

**Done:** both exit 0 and `git status` shows only files that belong to this change.
