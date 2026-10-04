# Passbolt shared setup: verified image, exact remaining engine seams

Checked 2026-10-03. **Not installable through the current shared engine.** No
recipe/setup adapter was added and no automation support was promoted. This is
an executable-interface conclusion, not a lifecycle-note guess.

Current docs were resolved/fetched with Context7 (`/websites/passbolt`); pinned
5.16.0 source owns version-specific behavior. Public
[publisher metadata](https://hub.docker.com/v2/repositories/passbolt/passbolt/tags/5.16.0-1-ce)
was freshly fetched: `docker.io/passbolt/passbolt:5.16.0-1-ce`, index
`sha256:dc7298c2847e406154beea5c4c82062828e0b1690d1d9869b2dbeae6f6e70bfc`,
Linux amd64/arm64/arm. Manifest provenance is now known; selected platform
resolution remains apply-time work, not a live server claim.

## Existing interfaces versus requirements

| Requirement | Current implementation | Smallest owner change |
| --- | --- | --- |
| Stable private HTTPS `APP_FULL_BASE_URL` | App-owned `canonical-origin.ts` exists; shared registry currently registers only Vaultwarden/Docmost. TLS transport supports applied same-owner proof but a new Passbolt service cannot yet consume owner origin choices before startup. | Register this app declaration and support explicit new-plan origin inputs without a fabricated completed owner. |
| SMTP sender/host/TLS and optional credentials | `SetupAdapter.inputDefinitions` is post-deployment. Static recipes cannot encode owner-specific pre-start SMTP configuration; owner-file import is storage, not arbitrary secret-environment injection. | Typed non-secret pre-start recipe inputs and documented owner-secret file consumer. Never use sample sender/host/password values. |
| One-time first administrator | Pinned `register_user` rejects root; `SetupContainerCommand` has no approved runtime-user selector. | A fixed source-pinned `www-data` exec profile bound to exact service/image, checkpoint and approval. Do not add an arbitrary-user escape. |
| Private registration link | Existing app parser matches pinned `/setup/start/<uuid>/<uuid>`. Transport capture is only `captureAdminPassword`; private storage exposes API-key/password methods, not enrollment custody. | Typed bounded private-output capture and immutable enrollment-link storage; return only path/reference plus user ID, never URL payload. User/role readback and ambiguous-write reconciliation are required. |
| Honest pending-client onboarding | No-account forbids required generated DB secrets. Token onboarding mislabels SMTP/DB secrets. Official-client-first-email models a generated master password, not Passbolt GPG enrollment. | Explicit pending-GPG-client onboarding with no invented server username/password/key; server readiness, active owner and encrypted-client readiness stay separate. |

The [official CE Docker guide](https://www.passbolt.com/docs/hosting/install/ce/docker/)
supports private self-signed HTTPS, requires SMTP and time synchronization, and
documents registration followed by client completion. Public DNS/ACME and paid
licensing are not inherent CE install requirements. Trust/name resolution and
SMTP delivery still require real evidence.
[Docker secrets](https://www.passbolt.com/docs/hosting/faq/how-to-use-docker-secrets)
documents database password file transport. Do not infer every SMTP setting's
file syntax from that example.

[Pinned registration](https://github.com/passbolt/passbolt_api/blob/v5.16.0/src/Command/RegisterUserCommand.php)
prints the private setup token URL and refuses root; it does not generate an
administrator password or API key. Current docs illustrate `/setup/install/`,
while pinned command emits `/setup/start/`; retain the source-pinned parser.
[Official first setup](https://www.passbolt.com/docs/user/quickstart/browser/first-setup/)
requires client key/passphrase/recovery custody. No browser-free equivalent was
established; do not claim encrypted setup from a registered database record.

## Changes and focused checks

- Verified image/source facts and explicit origin/private-link/GPG prerequisites
  added to the real manifest and prerequisite document.
- Existing Passbolt fixture now exercises the **actual catalog exact-app plan**,
  preserving SMTP/origin/private-link/GPG/recovery gates and discovery support;
  existing origin/argv/private-URL parser checks remain.
- Focused fixture passed with locally available Bun 1.3.14; this is below the
  repository's Bun 1.4 requirement and is not required-version validation.
  Scoped diff hygiene passed. No runtime source was changed.

Generic seams were reported to the shared owner before any duplicate
implementation. No mock compiler, placeholder recipe, fake login or API key,
Docker/provider operation, private payload read, broad tests, CI or commit.
Confidence: high for source/engine gaps; no live server/client acceptance.
