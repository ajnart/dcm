# Home/AI headless recheck — 2026-10-03

Source review of eight existing app IDs and their version-tagged shared recipes.
Older `product/research/catalog-*` discovery-only decisions predate these adapters.
No images were pulled, services deployed, credentials inspected, or live acceptance
claimed. Apply still resolves/reviews exact image digests. The fixes below use
existing private transport, checkpoint and owner-only session facilities.

| App / selected image version | Current source-backed setup boundary and changes |
| --- | --- |
| Ollama `0.34.1` | [Pinned routes](https://github.com/ollama/ollama/blob/v0.34.1/server/routes.go) expose `/api/version` and `/api/tags`; [local authentication docs](https://docs.ollama.com/api/authentication) do not require a local account/key. Existing version/inventory inspection remains read-only; an empty inventory does not prove inference. No change. |
| Open WebUI `v0.11.4` | [Pinned auth router](https://github.com/open-webui/open-webui/blob/v0.11.4/backend/open_webui/routers/auths.py) backs saved-password signin and returned administrator identity. Default setup remains **account only**. New non-secret `integration-access=enabled` choice is persisted before actions and requires the [global API-key policy](https://docs.openwebui.com/features/authentication-access/api-keys/) to be already enabled separately; 403 returns pending/not-ready, without policy mutation. GET `/api_key` recovers existing plaintext, or 404 permits one checkpointed POST. Plaintext is saved before fallible same-owner verification; lost responses use GET, never another POST. Private JWT reuse keeps deferred approvals stable; JWT GETs explicitly disclose their [activity timestamp write](https://github.com/open-webui/open-webui/blob/v0.11.4/backend/open_webui/utils/auth.py). Upstream POST has no atomic create-if-absent operation: other operators must serialize key management. Model/provider/chat and Homarr are still unverified. |
| Home Assistant `2026.9.3` | [Pinned onboarding](https://github.com/home-assistant/core/blob/2026.9.3/homeassistant/components/onboarding/views.py) and [auth module](https://github.com/home-assistant/core/blob/2026.9.3/homeassistant/components/auth/__init__.py) back first owner, current owner/admin readback and once-issued long-lived token. Existing checkpoint/private login-flow session and save-before-verification behavior remain intact. No change; LAN discovery/devices are excluded from this bridge recipe. |
| Homebridge `2026-09-25` / UI `5.29.0` | [Wizard controller](https://github.com/homebridge/homebridge-config-ui-x/blob/v5.29.0/src/modules/setup-wizard/setup-wizard.controller.ts) and [auth controller](https://github.com/homebridge/homebridge-config-ui-x/blob/v5.29.0/src/core/auth/auth.controller.ts) back checkpointed first-user creation and expiring login. Fixed completed replay to avoid rewriting an unchanged verified checkpoint, which is part of subsequent approval subjects. Existing exact instance/owner/admin checks remain. No durable key is fabricated; HomeKit pairing remains separately approved/unverified. |
| Node-RED `5.0.7` | [Official security contract](https://nodered.org/docs/user-guide/runtime/securing-node-red) backs pre-start bcrypt `adminAuth` and wildcard administrator permissions. [Password grant](https://nodered.org/docs/api/admin/methods/post/auth/token/) issues an expiring session, not a durable key. Added anonymous `/flows` 401/403 proof before login, positive expiry validation, and required denial evidence in readiness. `/data` retains flows; no flow execution or restart claim follows. |
| Scrypted `v0.147.0-noble-lite` | [Exact recipe source commit](https://github.com/koush/scrypted/blob/e9a157a329f91d3849d33444abf9dd03592cc5e5/server/src/scrypted-server-main.ts) returns a durable key in first creation and a timestamp-dependent bearer on password login. Fixed immediate private key capture, bounded base64url private session reuse bound to the saved password, and completed-checkpoint no-op. Approved GET `/login` remains explicitly stateful: it can consume `reset-login` and erase users, even after marker inspection. Only HTTP 401 or pinned `Not logged in.` clears the session; 403/500/unknown errors preserve it. Existing first-owner admin authority remains source-inferred, not a new role-readback claim. Cameras/mDNS/NVR/hardware are excluded. |
| Speedtest Tracker `v1.14.7-ls165` | [Pinned User model](https://github.com/alexjustesen/speedtest-tracker/blob/05621935b64192bf2e86fa1ac2e6db6f40857e2c/app/Models/User.php) verifies seeded password/admin and scopes one Sanctum token to `results:read`. Fixed saved-token reconciliation to require its creation checkpoint, original administrator ID and private file, then finalize once without replay churn. Plaintext is still saved before fallible statistics/owner checks; missing plaintext never repeats creation. [Pinned Sanctum guard](https://github.com/laravel/sanctum/blob/fee27a573d1a013af3721d86153a65e0b11927e6/src/Guard.php) updates `last_used_at`: statistics verification now carries explicit approval, not a read-only inspection claim. No speedtest/measurement is run. |
| Gotify `3.1.1` | [Pinned API specification](https://github.com/gotify/server/blob/v3.1.1/docs/spec.json) backs Basic-auth current-user administrator readback, application inventory and checkpointed application creation. Existing adapter saves the application token before subsequent verification and refuses unsaved ambiguous creation replay. No change; an application token is a notification-sending credential, not a client/read-all token. Notification delivery remains unverified. |

## Focused verification

- `packages/cli/tests/scrypted-deferred-setup.test.ts`: **pass**, real shared
  HTTP/checkpoint/private-session transport with synthetic loopback upstream;
  fresh and lost-create paths, stable approval hashes, immediate key capture,
  completed replay, uncertain errors and definitive session invalidation. The
  reset-marker observation alone is stubbed; no Docker or upstream instance.
- `packages/cli/tests/home-ai-setup-replay.test.ts`: **pass**, synthetic adapter
  fixtures for Homebridge checkpoint/owner replay, Speedtest save-before-failure,
  checkpoint/owner recovery and refusal, and Node-RED anonymous denial/expiry.
- `packages/cli/tests/open-webui-integration-access.test.ts`: **pass**, real
  shared HTTP/checkpoint/session/key transport with synthetic loopback upstream:
  default account-only behavior, policy gate, stable authenticated approvals,
  existing-key recovery/no rotation, one creation, save-before-verification,
  lost-create recovery and unchanged completed replay.
- Changed adapters and three fixtures: focused Bun builds and owned diff check.
  These are source/fixture checks, not fresh-instance, restart, browser, device,
  model, notification, measurement or Homarr acceptance.

Context7 was queried for Scrypted, Speedtest Tracker, Node-RED and Open WebUI. Scrypted
had no matching login/token documentation; exact upstream source supplied that
contract. No new shared engine primitive or host-access grant was introduced.
