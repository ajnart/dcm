# Dashboard and Pre-boot entrances (#264)

## Scope

Built from `origin/main` at `5aafb4c1` in the isolated
`feat/tui-entrances-sol` branch. No Docker, installer, browser, person's Project,
secrets, credential stores or browser profiles were used. No dependencies added.

Dashboard opening settles only the existing purple accent and bright hierarchy
over three frames at 12 fps (250 ms nominal). Text, layout and state colours are
present immediately. Any key skips that settle and retains its normal meaning;
clicks and scrolling also skip it. Onboarding and read errors bypass it.

Pre-boot reveals only the existing artwork outward from its centre over twelve
frames at 24 fps (500 ms nominal, ease-out cubic). Text, pull count, bar, narrative
and existing skip keys remain present from frame zero. At frame twelve the output
is exactly the existing main scene. Entrance frames are part of the existing
clock, not added to the four-second no-pull interval or to the exit.

`enter` skips Pre-boot to Activity; `q` and `ctrl+c` quit throughout.
`SELF_HOST_REDUCED_MOTION=1` bypasses the opening and Pre-boot, showing the approved
first Action directly in Activity. It does not change approval or backend work.
Existing Activity indicators and Onboarding's Doctor reveal remain unchanged.
`NO_COLOR` remains separate and preserves Pre-boot's glyph motion.

## Reproduce the fake-data preview

From the repository root, pick a new, writable output directory:

```bash
mkdir -p "$TMPDIR/self-host-entrance-preview"
GOFLAGS=-buildvcs=false go test ./internal/tui \
  -run '^(TestApprovingReviewShowsPrebootAndDispatchesTheInstall|TestFramesTickOnlyWhileSomethingAnimates)$' \
  -count=1 -args -entrance-preview="$TMPDIR/self-host-entrance-preview/entrances"
```

This produces `entrances-dashboard.cast` and `entrances-preboot.cast` (asciicast
v2). Replay with an existing asciicast player, or inspect the JSON frames. The
Dashboard has frames at 0, 83.333, 166.667 and 250 ms. Pre-boot has frames from
0 through 3.417 seconds: entrance, the existing scene, the existing exit and
Activity. Dates, header clock and events are fixed fake data from the existing
TUI model harness. The capture flag writes nothing unless explicitly supplied.

Two independent preview runs produced byte-identical casts (`cmp` passed).
SHA-256:

```text
3d380a7270dd743400ea511fc2b6ff5d49ef22f85017aaf940bcb57737cff1b1  entrances-dashboard.cast
6d7906d7ae4f48400d571c072bc437c34b6219e3763e16fae4a7a845b85a3bfa  entrances-preboot.cast
```

The PR's attached images are rendered views of these fake ANSI frames, not
screenshots of a live install. They show opening and settled frames at 120×30.
Font rendering and real terminal scheduling are not acceptance claims. No real
network pull or install performance was measured.

## Exact transition evidence

- `internal/tui/preboot_test.go`,
  `TestFramesTickOnlyWhileSomethingAnimates`: opening only changes the palette,
  repeated rendering is identical, three frames restore the original output,
  idle ticking ends, keys keep their meaning, reduced motion skips opening, and
  an early read failure appears immediately.
- `TestApprovingReviewShowsPrebootAndDispatchesTheInstall`: the approved fake
  install runs before advancing entrance frames; frame zero includes
  `0 of 2 images` and `Pulling 2 images`; frame twelve matches `preboot.Render`
  byte-for-byte with the same Progress.
- `internal/preboot/preboot_test.go`, `TestRenderingIsAFunctionOfItsInputs`:
  every entrance frame 0–12 is repeatable at 120×30 and 80×24, retains progress,
  and frame twelve exactly matches the unchanged renderer.
- `TestPrebootIsFullScreenAtTheTerminalSize`: entrance resizes through 80×24,
  40×12, 70×20 and 120×30 with exactly the requested rows and columns.
- `TestPrebootPlaysTheExitThenLandsOnActivity`: a completed pull at frame zero
  starts the existing exit on frame one, without finishing the entrance first.
  The existing exit still lands on Activity.
- `TestAFailedPullLandsOnActivityAtOnce`,
  `TestAFailedInstallLandsOnActivityWithoutWaitingForAFrame`, and
  `TestAnEarlyFailureReturnsToReviewFromPreboot`: failures retain the existing
  prompt failure/recovery paths, including during entrance.
- `TestPrebootPlaysAboutFourSecondsWithNothingToPull`: the original no-pull
  timing remains unchanged. `TestEnterSkipsPrebootToActivity` also verifies
  reduced motion still dispatches the approved install.
- `TestQuitsFromPreboot`: quitting cancels the pending frame command and a late
  frame cannot schedule another. `Run` cancels frames on all return paths.
- Existing colour/light-palette, keybind, 80-column and golden coverage passes;
  no goldens regenerated. The interactive root additionally prints help rather
  than launching the TUI when `--json` is supplied, verified by the bare-JSON
  case of `internal/cli/updatenotice_test.go`,
  `TestTheNoticeObeysEverySuppressionRule`.

## API verification and local gate

Context7 returned its monthly-quota error. API behavior was checked against the
official installed `charm.land/bubbletea/v2@v2.1.0` sources: `commands.go` documents
concurrent `Batch`, one-shot `Tick` and automatic `WindowSizeMsg`; `tea.go`'s
`handleCommands` explains why command timers cannot be cancelled by Bubble Tea.
The existing frame chain now owns a cancellable one-shot Go timer instead. It
adds no animation goroutine or repeating ticker and never serializes backend
commands behind motion.

Passed with `GOFLAGS=-buildvcs=false`:

```bash
gofmt -l .
go build ./...
go vet ./...
go vet -tags e2e ./e2e/
go test ./...
go test -race ./internal/tui/ ./internal/activity/ ./internal/preboot/ ./internal/cli/
bash -n install.sh
```

`gofmt -l .` was empty. The `e2e` build tag was used only for vet, never the
Docker runtime. CI is not claimed: the repository records account billing as
its blocker. Final parent review and integration with concurrent work remain
outside this worker's scope.
