# Generation 6 — installed-skill UX and script-first setup

Status: **UI baseline complete without a new full-Homarr survivor; headless
runtime deliberately not tested.**

## Boundary

The initial candidates installed the private `main` skill at `8bdf38b` into a
separate project with the public one-command Skills CLI copy flow. They did not
execute the later script-first source commit `d4970a6` or this source checkout.
Each candidate had a separate run ID, session directory,
Compose project, ports, and browser session. The instrumented `agent-browser`
shim logged only command categories, timings, session IDs, argument counts, and
exit codes into a private NDJSON file. It did **not** record authenticated HTTP
URLs, bodies, headers, cookies, or HAR data: such capture was rejected by the
environment's approval review. The API sequence in `docs/headless-setup.md`
comes from first-party route/source inspection, not from a claimed HTTP trace.

| Run | Target | Observed result | Browser CLI invocations | Failed invocations | Measured run time |
| --- | --- | --- | ---: | ---: | --- |
| `g6coreb` | six configured apps; intentionally skip Homarr onboarding | Core, Jellyfin, and Seerr passed; Homarr container remained uninitialized; Prowlarr indexer downstream pending an authorized source | 99 | 3 | unavailable; browser-proof window about 11 minutes |
| `g6fulla3` | full seven-service board | Core/Jellyfin/Seerr passed; Homarr onboarding claim locked by another browser, so no board | 29 | 9 | 26m 30s |
| `g6fullc` | full seven-service board | Four persisted Homarr connections; Radarr and Prowlarr unfinished; browser context reset to Essentials, so no board | 374 | 16 | 59m 58s |
| `g6fulld` | full seven-service board, one panel at a time | Core/Jellyfin/Seerr passed; Homarr admin reached Essentials, then browser daemon failed on restart before Connect | 29 tagged | 1 tagged | 5m 13s UI scope; full run time unavailable |

All four ran in isolated stacks and left their containers intact for scoped
inspection. `g6coreb` is a valid **skip-Homarr** variant, not a completed
seven-service result. None of the full candidates passed Homarr board, widget, or
MCP acceptance. No candidate chose an indexer, media request, or download for
the user. The browser logger recorded 30 additional unassigned diagnostic
commands (eight nonzero), excluded from candidate totals. The later three
unassigned diagnostics overlapped `g6fulld`'s browser recovery, but cannot be
attributed from the session-tagged log alone. Exact model turn and
token counters were not exposed to the supervisor; they remain **unavailable**,
not estimates.

Historical Generation 5's promoted candidate did complete the seven-service
board and browser acceptance, with approximately 100 *meaningful actions*
(a different unit from the CLI invocation counts above). Thus the revised
installed skill has not yet demonstrated an easier full-Homarr UI path. The
failed candidates exposed two concrete costs: an onboarding claim/context
reset, form tests that appeared green before all fields persisted, and browser
daemon startup failure. There is no finished-board screenshot from this
generation; the saved `g6fullc` Connect screenshot documents the precise
unfinished-integration warning. Reusing Generation 5's board image as if it
proved this run would be misleading.

## Subjective scorecard (out of 100)

| Scope | Setup quality | Ease | Why |
| --- | ---: | ---: | --- |
| Then: Generation 5 promoted full stack | 90 | 50 | Full seven-service board/browser acceptance, but approximately 100 meaningful manual actions and recovery work. |
| Now: installed `8bdf38b`, skip-Homarr path | 78 | 68 | Six non-Homarr services worked and the early exit was clear; no authorized indexer/downstream sync, 99 browser CLI invocations. This is a different target, not a full-stack win. |
| Now: installed `8bdf38b`, full-Homarr UI path | 35 | 20 | Three isolated full attempts failed before board, including a 374-invocation, one-hour attempt. |
| Next: script-first source after `d4970a6` | unscored | unscored | Static, package, cookie-fixture, and independent install checks passed; no live setup before user GO. |

The scores are reviewer judgments over observed outcomes, not measured
statistical performance; CLI invocations and historical meaningful actions
must not be equated. The full-Homarr UI result is a regression in this sample.

## Changes promoted to source, not yet live-proven

- Public entry asks for purpose, access, storage, and username only as needed;
  `defaults` chooses non-secret defaults and a privately generated password,
  but never approves apply or public exposure.
- Portable install and generated media bundle include per-service setup scripts
  for qBittorrent, Sonarr, Radarr, Prowlarr, Jellyfin, Seerr, and Homarr.
- Local `curl` transport uses private per-origin cookie jars and private request
  config/body files. It refuses non-loopback HTTP targets and secret-bearing
  query parameter names, ignores user curl configuration, and deletes transient
  request files after each call.
- Homarr script follows onboarding claim, admin sign-in, six connection tests,
  board generation, and private API-key creation. Board proof checks six linked
  app tiles, host-facing navigation versus Docker ping URLs, seven live widget
  procedures, and per-integration errors.
- Agent-browser is a fallback on script failure or requested visual proof.
  The approved run and its exact evidence still decide acceptance; source
  inspection and static checks are not Docker/browser proof.

Repository validation, package validation, bundle integrity, targeted script
compilation, the isolated local curl-cookie fixture, and a new disposable
private-repo Skills CLI copy install all passed. The latter installed one
standalone `self-host` skill with byte-identical public entry and Homarr setup
script; it did not deploy services.

## Next generation gate

Wait for the user's **GO** before running the new headless setup against a
fresh isolated stack. Record start/end, per-service script elapsed time,
browser fallback invocations and failures, acceptance rows, and exact model
turn/token counts only if the agent platform makes them available. Compare
full-Homarr outcomes with full-Homarr outcomes and the skip-Homarr variant
separately. Do not promote a candidate on liveness, transient green form tests,
or a screenshot without saved integration and widget evidence.
