# Browser setup benchmark

Use this benchmark to compare reproducible setup journeys for the exact media
harness services: Sonarr, Radarr, Prowlarr, qBittorrent, Jellyfin, Seerr, and
Homarr. The recipe index is [browser-paths.json](browser-paths.json).

`browser` means the service is configured through its UI. `browser-wiring`
means the harness prepares only service identity while agent-browser performs
credential entry and cross-service wiring. `hybrid` means the harness performs
the supported API graph bootstrap and agent-browser verifies the resulting UI.
Keep fresh setup separate from returning
access. A recipe describes a path; only a completed recorded run is a
measurement.

## Recording rules

- Start elapsed time immediately before the first measured browser or bootstrap
  action and stop after the stated verification.
- Count each top-level URL change as one navigation, each fill/click/select/key
  action as one interaction, each interactive snapshot as one snapshot, each
  explicit wait as one wait, and every agent-browser or harness invocation as
  one tool call. Count an action attempted again after failure as one retry.
- Open the direct settings path from the recipe instead of traversing menus.
- Use semantic locators for known controls. Take a fresh interactive snapshot
  before using any element ref; never carry refs across navigation, dialogs, or
  material DOM changes.
- On Sonarr, Radarr, and Prowlarr `/settings/general`, use `browser-key
  capture-field RUN_ID SERVICE`; it reads the fixed readonly key without a
  snapshot or ref. Use `browser-key refs RUN_ID seerr` for Seerr; regular
  snapshots include input values. On every credential form, obtain
  general field refs with `browser-form RUN_ID`; its output contains only ref,
  role, and accessible-name metadata. The unnamed Prowlarr application key
  field uses `browser-key fill-prowlarr-app RUN_ID sonarr|radarr` only after
  confirming the exact dialog title. Capture credentials only with
  `browser-key` or `browser-password`. Do not use
  the clipboard, print a value, query it through general browser output, or
  retain raw traces. Benchmark records accept only fixed enums and bounded
  numeric counters.
- Record `fail` or `blocked` runs too. Do not omit retries or replace an
  observation with an estimate.
- In a restricted test host where Chromium cannot start its own sandbox, set
  `AGENT_BROWSER_ARGS=--no-sandbox` for every command in the named run session,
  including `browser-form` and `browser-password`; a restarted browser process
  otherwise loses a one-command launch flag. Keep this exception local to the
  isolated test host and refresh refs after any relaunch. Avoid the global
  browser doctor while another run's browser session is active.

## CLI

Validate the checked-in recipe index:

```bash
bun scripts/browser-benchmark.ts validate-recipes
bun scripts/browser-benchmark.ts lookup sonarr
```

Record one observed run:

```bash
bun scripts/browser-benchmark.ts record \
  --service sonarr --mode browser-wiring --journey fresh --outcome pass \
  --navigations 1 --interactions 2 --snapshots 2 --waits 1 \
  --tool-calls 6 --retries 0 --elapsed-ms 1200 \
  --output /absolute/run/artifacts/sonarr-browser-wiring-fresh.json
```

The numbers above demonstrate the file shape; they are not benchmark results.
Create a JSON array from validated record files when reporting several runs,
then render both machine-readable and reviewable artifacts:

```bash
bun scripts/browser-benchmark.ts report \
  --input /absolute/run/artifacts/browser-records.json \
  --json-output /absolute/run/artifacts/browser-benchmark.json \
  --markdown-output /absolute/run/artifacts/browser-benchmark.md
```

The report totals observed counters and elapsed milliseconds. Per
service/mode/journey groups expose elapsed median and p95 only after three
passed samples; failures and blocked runs remain separate counts. Compare
timings only when the recorded environment and service versions match. Missing
groups remain unmeasured and do not support a speed claim.
