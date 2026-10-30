# Generated data and shared facts

One fact often lives in several files. This page names each fact's source of truth, the artifacts derived from it, the command that regenerates them and the check that catches drift. Read it before changing an App, a Container, an icon, a star count or an App count. DCM specifics are in `docs/agents/dcm.md`; the gate is in `AGENTS.md`.

## Regenerate

```bash
go run ./tools/sitegen                    # site/src/data/catalog.json, dcm/src/data/selfhost.json, site/src/styles/theme.css
GITHUB_TOKEN=... bun run stars            # site/src/data/stars.json and dcm/src/data/stars.json
go test ./internal/tui -update            # the Dashboard goldens, after a Catalog or layout change
```

The drift check CI runs (`ci.yml`, `test` job). `git add -N` makes a newly generated file count:

```bash
go run ./tools/sitegen && git add -N site/src/data dcm/src/data site/src/styles && git diff --exit-code site/src/data dcm/src/data site/src/styles
```

`internal/catalog/generated.go` is written by `go run ./tools/appgen` from `tools/catalog-import/facts.json` and `tools/appgen/overrides.json`. It needs a checkout of the removed legacy catalog (`-catalog`), so edit the override or the App package and leave `generated.go` alone.

## Drift map

| Fact                                                    | Source of truth                                                                                          | Derived copy                                                                         | What catches drift                                                                                                                    |
| ------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------- |
| App id, name, description, category, image, port, Links | `internal/apps/<name>/` (the id without hyphens, or a shorter name), listed by `register(...)` in a `internal/catalog/batch_*.go` or by `generated.go` | `site/src/data/catalog.json`                                                         | Loud: the sitegen drift check                                                                                                         |
| App Compose, env, notes; Recipes                        | the App, and the Recipes in `internal/catalog/`                                                          | `dcm/src/data/selfhost.json`                                                         | Loud: the sitegen drift check                                                                                                         |
| Dashboard palette                                       | `tui.DarkColors` in `internal/tui`                                                                       | `site/src/styles/theme.css`                                                          | Loud: the sitegen drift check                                                                                                         |
| App icon                                                | `icons` in `tools/sitegen/icons.go`: the Dashboard Icons path, or `""` for none                          | the icon field of both JSON files                                                    | Loud: sitegen fails on an App with no icon and on an `icons` key that is not in the Catalog                                           |
| Standalone guide                                        | `StandaloneGuide()` on the App                                                                           | the notes in `dcm/src/data/selfhost.json`                                            | Loud: `checkGuide` in `tools/sitegen/standalone/notes.go` fails when the guide names a variable or folder the converted Compose lacks |
| GitHub repo for an App's stars                          | `repos` in `tools/sitegen/stars.go`                                                                      | `site/src/data/stars.json`                                                           | Silent: an App missing from `repos` is skipped, and the file only changes when `bun run stars` runs (weekly through `stars.yml`)      |
| GitHub repo for a Container's stars                     | `githubUrl` in `dcm/src/tools/*.ts`                                                                      | `dcm/src/data/stars.json`                                                            | Silent, same as above                                                                                                                 |
| Container id against App ids                            | App ids; `ALIASES` in `dcm/src/lib/selfhost.ts`; `coveredByApp` in `dcm/src/lib/catalog.ts`              | what DCM's All mode shows                                                            | Silent: see Collisions                                                                                                                |
| Hidden Apps                                             | `unavailable` in `internal/catalog/catalog.go`                                                           | `Apps()` leaves them out (JSON, README count, goldens); `AllApps()` keeps them (e2e) | `unavailable_test.go` checks the behaviour, not the counts                                                                            |
| Legacy facts of a ported App                            | `internal/catalog/testdata/legacy-facts.json`                                                            | the App's image repository, ports, env, mounts, category                             | Loud: `parity_test.go`; an intended difference needs a `deviations` entry with its reason                                             |
| App description                                         | `maxDescriptionLength` and `jargon` in `internal/catalog/descriptions_test.go`                           | `Info().Description`                                                                 | Loud: at most 100 characters, no unexplained jargon                                                                                   |
| Service names                                           | `ownership_test.go`                                                                                      | an App's extra services are named `<id>-...`, and no two Apps share a service        | Loud                                                                                                                                  |
| Traps and security notes                                | `docs/catalog/traps/<id>.md`                                                                             | none                                                                                 | Silent: convention only; every App has one                                                                                            |

## App counts

Four kinds of number are kept by hand, and they differ on purpose. Before reading a mismatch as a bug, find which kind it is.

| Where                                                                            | Counts                                                                     | Today | Caught by                                                  |
| -------------------------------------------------------------------------------- | -------------------------------------------------------------------------- | ----- | ---------------------------------------------------------- |
| `README.md`: the badge, the Catalog paragraph and the table row                  | visible Apps (`Apps()`)                                                    | 93    | nothing                                                    |
| `e2e/acceptance.md`, first paragraph                                             | all Apps, the hidden ones included (`AllApps()`)                           | 94    | nothing                                                    |
| `e2e/acceptance_fixture_test.go` (`len(got)`) and `e2e/testdata/inventory.json`  | all Apps, the visible Recipes and the hidden `homarr-control-plane` Recipe | 102   | `go test ./e2e/`, which has no build tag                   |
| `internal/tui/testdata/onboarding-what-default-focus*.golden`, the `N more` line | visible Apps and Recipes that do not fit on screen                         |       | `go test ./internal/tui`; `-update` accepts the new number |

`site/` pages compute their numbers from `catalog.json`, so they need no edit. `docs/handoff.md`, `docs/runtime-matrix.*`, `docs/homarr-*` and `video/reel/` hold dated snapshots; leave them.

Check the real values:

```bash
jq '.apps | length, (.recipes | length)' site/src/data/catalog.json
grep -rn "Apps-[0-9]\|[0-9][0-9] Apps\|[0-9][0-9] self-hosted" README.md e2e/acceptance.md
```

Adding an App adds one to every row. Hiding one through `unavailable` subtracts one from the README, the goldens and `catalog.json`, and leaves `e2e/acceptance.md` and the fixture as they are.

## Collisions between Containers and Apps

DCM's `buildCatalog` merges `dcm/src/tools` with `selfhost.json`:

- A Container whose `id` equals an App's `id`, or is an `ALIASES` key for it, merges with the App: the App's compose, env and notes win and the Container keeps its tags and icon. This is the design (37 Containers do it today), so a second Container for an App's product never adds a compose.
- A Container whose `id` starts with `<app>-` and whose services the App already provides is dropped from All mode.
- A Container spelled differently from its App (`actualbudget` against `actual-budget`) and missing from `ALIASES` shows up twice, once as the Container and once as the App.

No test covers any of these. Adding a Container checks that its `id` is no App id, no `ALIASES` key and no `<app>-` prefix of an App that provides its services. Adding an App checks `dcm/src/tools` for a Container of the same product and, when the spelling differs, adds the `ALIASES` entry.

## Which check for which change

| You changed                            | Run                                                                                                     |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| an App, a Recipe, an icon, the palette | the Go gate from `AGENTS.md`, then the sitegen drift check, then `bunx turbo run build test lint check` |
| a Container                            | `bun test` for the three files named in `dcm.md`, then `bunx turbo run build lint`                      |
| only the star counts                   | `bun run stars`, then the web gate                                                                      |
| an App count                           | `go test ./e2e/ ./internal/tui`                                                                         |

`validate-compose.test.ts` runs `docker compose config` and needs Docker; CI runs it as `test:compose`.
