# Speedtest Tracker Link: source-only record (#296)

This is a source implementation, not functional or measured-network acceptance.
No Docker, browser, external speed test, provider account, terms acceptance,
analytics or person's result history was used. Existing focused tests and the
full local gate passed; their synthetic data proves only code behavior.

## Compatibility and image provenance

The common contract is inherited from committed reference `d956824f` on
`feat/homarr-immich-sol`. The peer owns `target_speedtest_tracker.go` and
`speedtestTrackerTarget()`. The reference owner must register that descriptor
in `targets.go`; this lane does not modify the registry or reconciliation.
Final ownership normalization and review remain pending.

Homarr's accepted API version is `2.4.1`. The actual-image source revision is
`3d4150e59f600876b7e308f857b2f21572b75348`, not the tagged research baseline
`ebbd4876d25a51151444a009ab596e1154d62880`. The Speedtest adapter, result schemas,
widget/router/request handler, integration/credential definitions and Stats
provider registry were compared at those commits and are identical. This is
source equivalence, not a runtime version/digest assertion.

Read-only registry inspection on October 11, 2026 resolved
`lscr.io/linuxserver/speedtest-tracker:v1.14.7-ls165` to:

| Identity               | Value                                                                     |
| ---------------------- | ------------------------------------------------------------------------- |
| Index digest           | `sha256:10a08318f473e65d29c21326387b127ac4bb2abf6574187541f5422ce333c399` |
| linux/arm64 manifest   | `sha256:f476ecd787d601917584cff782ddc749bbcd72c013d5ac2d9f29b0f642d048b5` |
| linux/amd64 manifest   | `sha256:70716926f82a05f3eeb052626bdbcc62a08a35b38b79259049461a9238d18be9` |
| Image version label    | `v1.14.7-ls165`                                                           |
| Image source label     | `linuxserver/docker-speedtest-tracker`                                    |
| Image builder revision | `58239d70849f8348dd3a34e20ef7d6d4fb2ffade`                                |
| Tracker v1.14.7 source | `05621935b64192bf2e86fa1ac2e6db6f40857e2c`                                |
| arm64 App source layer | `sha256:8a8e237e2e3e4c7ad675e6f5a70a1f4492e674f68b2cc66ee79015b51d2169f5` |

The public arm64 source layer was downloaded without executing it, and its
digest checked. A whitelist of eleven source files was compared byte-for-byte
with the Tracker source commit: API routes, results/statistics controllers and
resources, token page/form, User model, application config and pagination config.
All matched. No private configuration, credential or environment file was read.
The amd64 manifest was inspected, not source-layer compared or executed.
Mutable tags still require resolved identity recording during future acceptance.

The actual arm64 image's `composer.lock` and installed Sanctum source were also
read before writing the runtime issuance code. Dependencies already present are
Laravel `v13.21.1` (`303b5f8dc899f89e8c38c350b639b8fbd193ed16`) and Sanctum
`v4.3.3` (`fee27a573d1a013af3721d86153a65e0b11927e6`). Its installed
`HasApiTokens::createToken`, `tokens` relationship and `PersonalAccessToken`
lookup/ability model match the selected framework contract. No dependency,
Tinker installation or new route is added.

## Account and credential boundary

The existing Compose first-start Admin login and read-only administrator Check
are retained. No password reset, role escalation or account adoption is added.
The misleading empty-configuration deletion hint is replaced with credential
recovery through the Project boundary.

The browser token interface is `/admin/api-tokens`, implemented by Filament.
There is no token-issuance endpoint in the pinned routes or supported token CLI
in the official commands. This slice instead uses the approved, documented
Laravel Sanctum `User::createToken('self-host Homarr results', ['results:read'])`
method through the existing owned helper runtime inside the exact App container.
The same User trait is used by the App's token page. This is framework-runtime
issuance, not a new HTTP API/CLI or raw database/hash/token-row injection.

Before issuing, the script verifies the explicit seeded Admin email, shared
Admin password and administrator role, and any previously recorded account ID.
It refuses a colliding token name on that account; a matching manual token is
never adopted. The new token's identity, account ID and exact one-element ability
set are checked before persistence. Never grant `speedtests:run`,
`ookla:list-servers` or `*` for this Link.

The one-time plaintext is captured privately through the helper and saved with
`h.SetSecret` as `SPEEDTEST_TRACKER_HOMARR_API_KEY`, alongside
`SPEEDTEST_TRACKER_HOMARR_API_KEY_ID` and `SPEEDTEST_TRACKER_HOMARR_ADMIN_ID`.
Never send it in chat, shell arguments, logs or proof fixtures. A durable
`SPEEDTEST_TRACKER_HOMARR_TOKEN_PENDING` guard is written before attempting
issuance and cleared only after private persistence. An ambiguous response,
storage failure, collision or lost value stops as Manual rather than issuing a
second token. Recovery restores the recorded value or requires an explicit
ownership decision before removing only the recorded token and clearing its
private ownership/pending fields. No password reset or account role change occurs.

Checks and preflight inspect the recorded token with the installed Sanctum lookup
and read-only User relationship/metadata. Token ID, recorded account ID, current
Admin login, name, exact `['results:read']` abilities and expiration must match.
Authenticated result reads then verify actual API enforcement. A missing value,
unrecorded credential, broadened ability, changed account, rejected token or
unavailable owned runtime remains Manual with recovery instructions. No fallback
to the deprecated unauthenticated `/api/speedtest/latest`, automatic rotation,
hash comparison reimplementation or silent credential adoption is used.

This implementation establishes a source-backed private provisioning/scope seam;
the actual framework call, one-time capture, effective owner/scope enforcement,
ambiguity recovery and idempotent reuse have not been exercised in a real App.
Existing synthetic tests do not establish real credential acceptance.

## Read data and native widget

The internal integration Address is `http://speedtest-tracker:80`; the browser
Address is supplied independently by common Link code. App-owned token metadata
verification and all preflight requests are read-only, probe afresh and happen
before Homarr mutation:

- `/api/v1/results?result_count=30&sort=-created_at`: validate collection metadata,
  unique IDs, ordered timestamps and result fields.
- `/api/v1/results/latest`: require an explicitly completed measurement with
  present numeric ping/download/upload fields and a boolean/null health field.
  Download/upload byte rates must match rounded `* 8` bit rates.
- `/api/v1/stats`: validate positive measurement count and explicit minimum,
  average and maximum fields. `avg_bits`, when present, must agree with byte-rate
  rounding; missing data is not filled with zeros.

An authenticated zero-length collection plus latest HTTP 404 returns Manual:
speed is unknown/not measured. A failed, pending or incomplete latest measurement
also cannot count as success. No request runs a test or contacts an Ookla server.
HTTP 200, the healthcheck and seeded administrator verification are not sufficient.

The native widget is `speedtestTracker`, with latest result, aggregate statistics,
recent results and ping graph enabled. There is **no shared Stats provider** and
no invented metric key. It uses
`widget.speedtestTracker.getDashboard({ integrationIds: [ownedID] })`.
Verification compares the native latest measurement, aggregate fields and entire
returned history against fresh App reads. Missing/error/epoch-only results fail;
changing data or a stale Homarr cache requires a retry, never fake acceptance.
No other integration's shared Stats or Calendar bindings are touched.

The adapter sends `result_count=30`, but the pinned App uses JSON:API `page[size]`
and defaults to 25. The preflight deliberately matches the actual native request;
it does not claim to read all history. Result bandwidth is bits/second; raw
`download`/`upload` and statistics `avg` are bytes/second, ping is milliseconds.
Homarr formats supplied bits, or statistics byte rates multiplied by eight.

The App returns unzoned `created_at` values; its default `APP_TIMEZONE` is UTC.
Homarr parses these in its process time zone (`TZ` from Host settings), so
non-UTC Hosts can shift displayed instants. Verification checks that exact native
conversion, not corrected timing. True rendered timestamp fidelity in other time
zones is an upstream/acceptance gap. Recent charts additionally filter to the
last 12 hours; an old completed result does not prove a visible recent chart.

## Remaining acceptance gates

- Reference-owned registration, final common ownership SHA and independent review.
- Actual supported Sanctum token creation/private storage, account ownership and
  exact ability enforcement, credential reuse/rejection/ambiguity recovery in a
  disposable Project. No actual issuance was run here; PHP was not installed
  locally and the helper scripts were not executed or claimed runtime-verified.
- PHP-FPM/rootless readiness on the actual owned runtime; existing source launcher
  and diagnostics are not live readiness proof.
- A separately approved, lawful supported one-test measurement. No Ookla/EULA or
  bandwidth approval is implied by this source-only task. Synthetic fixtures
  cannot establish internet performance.
- Actual authenticated native data and rendered latest/statistics/history/ping,
  especially sizing, non-UTC timestamps and recent-chart cutoff behavior.
- Both installation orders, absent/unready/late peers, retry, restart, credential
  changes, stable owned IDs, user-resource preservation, removal/reinstallation.
  This descriptor reuses the common ownership code; tests without registry
  assembly do not prove the complete registered lifecycle.

## Primary sources

- [Homarr integration guide](https://homarr.dev/docs/integrations/speedtest-tracker/)
- [Actual-image adapter](https://github.com/homarr-labs/homarr/blob/3d4150e59f600876b7e308f857b2f21572b75348/packages/integrations/src/speedtest-tracker/speedtest-tracker-integration.ts)
- [Actual-image schemas](https://github.com/homarr-labs/homarr/blob/3d4150e59f600876b7e308f857b2f21572b75348/packages/integrations/src/speedtest-tracker/speedtest-tracker-types.ts)
- [Native widget/router](https://github.com/homarr-labs/homarr/blob/3d4150e59f600876b7e308f857b2f21572b75348/packages/api/src/router/widgets/speedtest-tracker.ts)
- [Native widget options](https://github.com/homarr-labs/homarr/blob/3d4150e59f600876b7e308f857b2f21572b75348/packages/widgets/src/speedtest-tracker/index.ts)
- [Stats provider registry](https://github.com/homarr-labs/homarr/blob/3d4150e59f600876b7e308f857b2f21572b75348/packages/integrations/src/stats/providers.ts)
- [Official API token abilities](https://docs.speedtest-tracker.dev/api/authorization)
- [Official supported commands](https://docs.speedtest-tracker.dev/other/commands)
- [Official Laravel 13 Sanctum issuance/abilities](https://github.com/laravel/docs/blob/13.x/sanctum.md#issuing-api-tokens)
- [Installed Sanctum lookup contract](https://github.com/laravel/sanctum/blob/fee27a573d1a013af3721d86153a65e0b11927e6/src/PersonalAccessToken.php)
- [Pinned token creation boundary](https://github.com/alexjustesen/speedtest-tracker/blob/05621935b64192bf2e86fa1ac2e6db6f40857e2c/app/Filament/Resources/ApiTokens/Pages/ListApiTokens.php)
- [Pinned result fields](https://github.com/alexjustesen/speedtest-tracker/blob/05621935b64192bf2e86fa1ac2e6db6f40857e2c/app/Http/Resources/V1/ResultResource.php)
- [Image build source](https://github.com/linuxserver/docker-speedtest-tracker/blob/58239d70849f8348dd3a34e20ef7d6d4fb2ffade/Dockerfile)
