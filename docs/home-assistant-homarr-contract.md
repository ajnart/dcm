# Home Assistant → Homarr Link

This peer follows the [Homarr ownership and compatibility contract](homarr-integration-contract.md).
The reference owner must register `homeAssistantTarget()` in
`internal/apps/homarr/targets.go`; this peer does not edit the common registry.

## Source baseline, not live acceptance

- Homarr `2.4.1`, source `ebbd4876d25a51151444a009ab596e1154d62880`.
- Home Assistant `2026.9.3`, image
  `ghcr.io/home-assistant/home-assistant:2026.9.3`.
- Both the authenticated `/api/config` version and the WebSocket welcome
  version must match the supported Home Assistant version.
- No Docker or browser run was made in this peer lane. Resolved image digests,
  rendered widget acceptance and the contained lifecycle proof remain pending
  the parent's approved disposable Project batch. Fake tests are not live proof.

## Account and token

Owner creation keeps the existing official `/api/onboarding/users` flow.
Its authorization code is not a usable Homarr credential. The login flow
`/auth/login_flow` and `/auth/login_flow/<id>` yields an authorization code;
form-encoded `/auth/token` exchanges that code for a temporary access token
and an OAuth refresh token. Neither is saved as Homarr's API key.
Temporary refresh tokens are revoked through `/auth/revoke` when the helper
finishes, including on failure.

Through the official `/api/websocket` API, Setup lists users with
`config/auth/list`, creates a dedicated `self-host Homarr` identity with
`config/auth/create`, and attaches the `self-host-homarr` login using
`config/auth_provider/homeassistant/create`. Its sole group is
`system-read-only`, with `local_only=true`; it is not an owner or administrator.
The owned user ID and generated password use `h.SetSecret`, not database access.
An existing name/username without recorded ownership is not adopted. Changed
groups, missing users/passwords, MFA and rejected authentication remain Manual.
No user's password, group, token, device or automation is reset.

After signing in as that dedicated user, `auth/long_lived_access_token` creates
the token named `self-host Homarr`, valid for 365 days. `auth/current_user` and
`auth/refresh_tokens` verify the current token's exact identity, name, type and
identifier. Setup stores `HOME_ASSISTANT_HOMARR_TOKEN` and its ID through the
Project secret boundary; a valid token is reused. A named token whose value
was lost is not silently replaced: restore it, or delete only that named token
in the dedicated user's profile and retry `self-host setup home-assistant`.
The owner can inspect the dedicated identity in Settings → People → Users.

The helper runs through `h.Exec` in the App container and uses its already
shipped Python/aiohttp dependency (Home Assistant pins aiohttp `3.14.3`).
Credentials travel only in the helper environment and HTTP/WebSocket bodies,
never command arguments. Captured token output is registered for redaction
before storage or error handling; raw response bodies and tracebacks are not
printed. No Go dependency, host mount, device privilege or socket is added.

Browser-only recovery stays Manual. Sign in as the dedicated user and issue
`self-host Homarr` under Profile → Security → Long-Lived Access Tokens, then
import it through the CLI private-input path:

```sh
self-host install home-assistant --set-file home-assistant.homarr_token=- --yes
self-host setup home-assistant
self-host setup homarr
```

Enter the value privately on stdin; never put it in a command argument or chat.
An imported token still must pass identity, group and token-type verification.
Owner MFA is not disabled or bypassed; when it blocks that verification,
Setup continues to report Manual rather than claiming unattended readiness.
Restore a lost dedicated password or identity record from a Backup.

## Real entity and widget data

The native kind is `homeAssistant`, with one `apiKey` secret containing the
verified long-lived access token. Homarr uses `http://home-assistant:8123`
server-side; the app tile separately uses the browser Address.

Authenticated `/api/states` discovery selects an existing available `sun.*`
or `input_text.*` entity, deterministically, and records its returned ID.
It never assumes `sun.sun` exists. If neither exists, the person explicitly
selects an actual safe entity or creates a harmless text helper in Home
Assistant. For example, replacing the placeholder with its actual ID:

```sh
self-host install home-assistant --set home-assistant.homarr_entity_id=<selected-id> --yes
self-host setup homarr
```

`/api/states/<selected-id>` must return that entity, an available state,
attributes and valid change/update timestamps. An empty discovery list is a
valid empty dataset but cannot satisfy Entity State acceptance; unknown or
unavailable data remains Manual, not a fabricated state or an auth success.

The widget is `smartHome-entityState`, limited to one integration, with options
`entityId`, `displayName`, `entityUnit`, and `clickable=false`. It reads a state;
it cannot toggle anything. Verification reads Homarr's
`widget.smartHome.entityDetails` and requires the real selected state and
timestamps, not just the saved widget. Shared Stats binds `entities` and
`unavailable`, refreshed through `widget.stats.refresh`; all fields, freshness,
error state and update timestamp are checked. Legitimate zero unavailable
entities is accepted. Neither Calendar nor Execute Automation is enabled:
no calendar or safe automation identifier has been selected. Those features
would need their own selected identifiers and explicit action approval.

The common contract preserves owned integration/widget IDs and unrelated
resources. A selected-entity change or an enabled toggle in an already owned
Entity State widget is reported as Manual, with an instruction to edit only
that widget in place and disable clickable. The common seam does not yet
reconcile dynamic binding options, so the peer does not silently rewrite them.
Removal uses only the common recorded ownership and shared-binding cleanup.

## Remaining Manual boundaries

Home Assistant's `user`, `core_config`, `analytics` and `integration` onboarding
steps must all be complete, or its completed-onboarding route must be removed.
Core-config completion starts upstream provider flows and remains a person's
choice. Setup never submits it, scans the network, adds hardware, triggers an
automation or uses a real person's Project for acceptance.

The pending parent batch must establish both installation orders, late peer
readiness/retry, rerun/restart, credential updates, removal/reinstallation,
user-resource preservation and at least one rendered result from a controlled
entity through the registered descriptor. None of these live outcomes is
claimed by source implementation or API-shaped fixtures.

## Official sources

- [Homarr Home Assistant guide](https://homarr.dev/docs/integrations/home-assistant/)
- [Exact Homarr adapter](https://github.com/homarr-labs/homarr/blob/ebbd4876d25a51151444a009ab596e1154d62880/packages/integrations/src/homeassistant/homeassistant-integration.ts)
- [Exact entity widget options](https://github.com/homarr-labs/homarr/blob/ebbd4876d25a51151444a009ab596e1154d62880/packages/widgets/src/smart-home/entity-state/index.ts)
- [Exact native entity routes](https://github.com/homarr-labs/homarr/blob/ebbd4876d25a51151444a009ab596e1154d62880/packages/api/src/router/widgets/smart-home.ts)
- [Exact Stats metrics](https://github.com/homarr-labs/homarr/blob/ebbd4876d25a51151444a009ab596e1154d62880/packages/integrations/src/stats/existing.ts)
- [Home Assistant authentication API](https://developers.home-assistant.io/docs/auth_api/)
- [Home Assistant REST API](https://developers.home-assistant.io/docs/api/rest/)
- [Home Assistant user API](https://github.com/home-assistant/core/blob/2026.9.3/homeassistant/components/config/auth.py)
- [Home Assistant login credential API](https://github.com/home-assistant/core/blob/2026.9.3/homeassistant/components/config/auth_provider_homeassistant.py)
- [Home Assistant token API](https://github.com/home-assistant/core/blob/2026.9.3/homeassistant/components/auth/__init__.py)
- [Home Assistant onboarding boundaries](https://github.com/home-assistant/core/blob/2026.9.3/homeassistant/components/onboarding/views.py)
- [Image's existing dependencies](https://github.com/home-assistant/core/blob/2026.9.3/pyproject.toml)
