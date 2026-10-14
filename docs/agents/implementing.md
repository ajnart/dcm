# Implementing a ticket

Read this before working on any ticket of spec #191 ("self-host for
everyone"). Its comment "Order of work" gives the waves and the conflict
hotspots. One ticket per branch, per worktree, per pull request.

## Read first

1. The spec and your ticket: `gh issue view <n> --repo ajnart/self-host`,
   plus every ticket it is blocked by.
2. `CONTEXT.md`: the glossary. Use its words exactly (App, Recipe,
   Project, Access, Address, Home folder, Profile, Experience level, Recap,
   Debug report, Telemetry, Feedback, Unmanaged app, Setup, Link, Onboarding,
   Dashboard, Activity). "Exposure" survives only in stored values and flags.
3. The ADRs in `docs/adr/`, especially 0005 (agents load the skill;
   approval guards changes), 0006 (Telemetry) and 0007 (one repo, Go only).
4. The code and tests you will change.

## Settled decisions (do not reopen)

- The person this is for has never used Docker or a terminal server. Every
  word they see is plain; jargon lives in help pages and "Technical details".
- One Home folder, `~/.self-host`, holds the Project, Unmanaged apps under
  `extra/`, and `profile.json`. `SELF_HOST_HOME` is for advanced users.
- Access replaces Exposure in everything a person sees: Home network
  (default), Easy names at home (Caddy; sslip.io and `.local` names), From
  anywhere privately (Tailscale), Your own web address (Cloudflare Tunnel with
  a login page in front), Bring your own (SWAG, Pangolin, an existing proxy) and
  This computer only (`127.0.0.1`), offered in both Onboarding and Settings.
  Each has a diagram, like Onboarding's network step. Anything reachable from
  the internet needs its own explicit yes naming the risk.
- The `IP:port` Address always keeps working as a fallback.
- Agents load the skill on their own from a description of about 200 tokens.
  Loading conveys intent, never approval.
- Newcomer contract, for Experience level New: before installing software,
  changing Access or deleting data, one plain sentence and a yes through the
  agent's ask-user tool; the Project changes only through `self-host`
  commands; secrets are never asked for or shown (`self-host credentials`).
- Telemetry follows ADR 0006 exactly. Off with `SELF_HOST_NO_TELEMETRY=1` or
  `DO_NOT_TRACK=1`, always off in CI and development builds, never in tests.
- Agents are capable: ship only what they cannot work out themselves (no
  goal-to-Recipe tables, no copies of upstream docs).
- Unchanged unless a ticket says otherwise: existing `--json` keys, non-TTY
  output, persisted formats (new fields are additive), backend Action semantics.

## How to work

- Test-first, one behaviour at a time, through the existing seams: the pure
  Activity model and renderers, the TUI views plus Model harness (goldens at
  120x30 and 80x24, `TestEveryViewFitsEightyColumns`, `TestKeybindAudit`), the
  CLI and service tests with fakes, the App fragment, Setup and Link tests, and
  `TestSkillGuideCommandsTableListsEveryRegisteredCommand` for the guide.
  Expected values come from literals, never recomputed like the code.
- Goldens: regenerate with `-update`, then read every changed one.
- Style: gofmt, sparse comments, no speculative abstractions, no new
  dependencies without saying why in the PR (check `go.mod` first).
- Everything fits 80 columns. Long text truncates with "…".
- Never run Docker, e2e runtime, browser or installer runs unless the ticket
  asks. Never read `.sessions/`, `.env*`, secret files or credential stores.
- Use `command cp -f` / `command rm -f` (interactive shell aliases).
- `h.Step` re-runs `Check` after `Do`: every Check probes afresh.

## Finishing

1. From the repository root with `GOFLAGS=-buildvcs=false`: `gofmt -l .` empty,
   `go vet ./...`, `go vet -tags e2e ./e2e/`, `go test ./...`, and
   `go test -race` on every package with goroutines you touched.
   CI cannot run (account billing), so these local runs are the gate.
2. Update `CONTEXT.md` when a term changes, `README.md` and
   `internal/skill/guide.md` when behaviour a person or agent sees changes.
3. One pull request into `main`, body ending `Closes #<n>`, merged with a
   merge commit after a clean review.
