# Existing identity and application adapters

Audit date: 2026-10-03. Scope: the 17 existing catalog folders below; shared
engine and Homarr descriptors have separate owners. No Docker apply, image
pull, live login, browser, restart, public route, hardware access, or notification
was performed. Earlier `product/research/catalog-*-2026-09-{29,30}.md` notes were
reused before inspecting current recipes and adapters. Several of those notes
predate the adapters and explicitly say no recipe exists: those conclusions are
historical, not the current catalog state.

## Corrections verified locally

- Home Assistant 2026.9.3 returns from onboarding component setup without
  registering its HTTP views when all steps were previously saved. A restart
  therefore makes `/api/onboarding` absent. The adapter now permits HTTP 404 only
  with a recognized creation checkpoint for this app/project and the actual
  first-owner attempted action. Saved-password login remains mandatory; 404
  alone never authorizes account creation or adoption. [Pinned component setup](https://raw.githubusercontent.com/home-assistant/core/2026.9.3/homeassistant/components/onboarding/__init__.py)
- LLDAP regular users may read their own identity. Checking only `id=admin`
  incorrectly accepted a demoted account. The adapter now queries the account's
  groups and requires `lldap_admin`. The date-tagged image's exact source commit
  is not established by these moving documentation links; live image acceptance
  is still pending. [Scripting permissions](https://github.com/lldap/lldap/blob/main/docs/scripting.md), [admin group](https://github.com/lldap/lldap/blob/main/README.md#general-configuration-guide), [GraphQL schema](https://github.com/lldap/lldap/blob/main/schema.graphql)
- Seafile 13.0.28 now uses the documented `Bearer` account-token scheme for its
  admin-only read, instead of the legacy pre-11 `Token` scheme. This is a
  source-contract correction, not proof that the pinned image rejects every
  legacy scheme. [Official authentication reference](https://seafile-api.readme.io/reference/authentication)
- Home Assistant now exchanges the password login for an expiring session,
  proves the current local owner's role over the exact private WebSocket, and
  checkpoints before creating one long-lived token for Homarr. The token is
  privately saved and reconnected to prove the same owner. A lost token result
  without saved plaintext blocks creation replay. Login flow/code/session phases
  are saved in the exact-owner mode-0600 session facility so deferred approvals
  retain their hashes. Current token verification never claims a new password
  login. [Pinned auth/token and WebSocket implementation](https://raw.githubusercontent.com/home-assistant/core/2026.9.3/homeassistant/components/auth/__init__.py)
- Docmost now checks cookie-authenticated `/api/users/me` for the exact email,
  `owner` role, and matching saved user/workspace UUIDs. Linkwarden now reads the
  owned database's user count before signup and refuses nonempty/unknown state
  without sending a signup. Their private login sessions are preserved between
  deferred approval steps; explicit HTTP 401 clears the session, not a generic
  transport failure. [Docmost identity controller](https://github.com/docmost/docmost/blob/9b3e5dd3dc21588fa20c02c5b8646d2f46ee73af/apps/server/src/core/user/user.controller.ts), [owner assignment](https://github.com/docmost/docmost/blob/9b3e5dd3dc21588fa20c02c5b8646d2f46ee73af/apps/server/src/core/auth/services/signup.service.ts), [Linkwarden image layout](https://github.com/linkwarden/linkwarden/blob/v2.16.3/Dockerfile)

The new `check-identity-existing-setup.ts` passes Home Assistant fresh creation,
same-owner replay after endpoint removal, rejected saved login, foreign and
action-less checkpoints, foreign existing owner refusal, and lost-response
recovery without another creation write. It also checks LLDAP admin/demoted and
malformed group responses and Seafile bearer/replay/admin-denial handling.
`check-nextcloud-setup.ts` passes its existing OCS/WebDAV and lost-write-response
fixture. Builds of the three changed adapters and new fixture passed. These are
synthetic checks; no fresh instance or restart passed here.

Follow-up Bun 1.4 checks also passed the expanded identity fixture (HA owner-role,
durable-token capture/replay/lost-result; Docmost role demotion/workspace change;
Linkwarden nonempty preflight), and `home-assistant-deferred-setup.test.ts` using
actual shared-transport approval hashing across reconstructed CLI facilities.
The latter uses only a temporary synthetic loopback HTTP server and mocks the
read-only current-user WS reply; live token creation is not claimed. It proves
stable pending approvals for flow-password POST, code exchange, and token
creation while each preceding HTTP mutation happens once.

## Per-app evidence and outstanding checks

`F` = focused fixture executed in this audit; `S` = source audit only, no
app-specific fixture executed here. Every row's fresh-instance and scoped
restart checks are **not run**. Native Homarr capability, an app tile, successful
integration authentication, and a useful widget are distinct; **none of the 17
apps had a Homarr runtime/widget check here**.

| App / pinned image version | Source-backed first-owner/auth/key route | Fixture | Existing-owner / replay boundary and remaining acceptance |
| --- | --- | --- | --- |
| Authentik / 2026.8.3 | Bootstrap password/token env; `/api/v3/core/users/me/` checks `akadmin` superuser; bounded identification/password flow confirms the saved password. [Pinned identity source](https://raw.githubusercontent.com/goauthentik/authentik/version/2026.8.3/authentik/core/api/users.py), [bootstrap docs](https://docs.goauthentik.io/install-config/automated-install/) | S | No reset through bootstrap on replay; read-only inspection explicitly reports only historical password-login proof. Fresh flow redirects/cookies, MFA refusal, token persistence, and provider acceptance pending. No native Homarr mapping claimed. |
| Keycloak / 26.7.4 | First-start bootstrap env; `admin-cli` password grant; bearer master-realm read. Session discarded, no durable key. [Versioned server development](https://www.keycloak.org/docs/26.7.4/server_development/), [bootstrap lifecycle](https://www.keycloak.org/server/bootstrap-admin-recovery) | S | Saved password is rechecked, not reset. Temporary bootstrap-admin lifecycle, host/port redirects and actual production SSO need acceptance; HTTP localhost candidate is not TLS/production SSO. No native Homarr mapping claimed. |
| LLDAP / 2026-08-28 | Password/seed/JWT files; `/auth/simple/login`; GraphQL saved `admin` plus `lldap_admin` group readback. [Scripting](https://github.com/lldap/lldap/blob/main/docs/scripting.md) | F | Demoted account now rejected. Exact image/source association, file readability, LDAP bind and consumer integration pending. No persisted JWT or native Homarr mapping claimed. |
| Nginx Proxy Manager / 2.16.0 | Initial email/password env; `/api/tokens`; `/api/users/me` must return enabled expected-email admin. [Pinned token schema](https://github.com/NginxProxyManager/nginx-proxy-manager/blob/v2.16.0/backend/schema/paths/tokens/post.json), [bootstrap env](https://nginxproxymanager.com/advanced-config/) | S | Rechecks saved credential; session token is not a durable API key. 2FA requires manual completion. No proxy host, DNS/TLS, 80/443 exposure or native Homarr mapping accepted. |
| Home Assistant / 2026.9.3 | Checkpointed owner creation; password flow/code exchange; WS current-owner role; one checkpointed long-lived token and saved-token same-owner readback. [Pinned onboarding](https://raw.githubusercontent.com/home-assistant/core/2026.9.3/homeassistant/components/onboarding/views.py), [auth implementation](https://raw.githubusercontent.com/home-assistant/core/2026.9.3/homeassistant/components/auth/__init__.py) | F | Foreign owner/changed owner rejected; ambiguous creation reconciled without replay. Dynamic login phases remain private and approval-stable; lost token plaintext blocks duplication. Full onboarding, actual restart and native Homarr integration/widget remain runtime-pending. |
| Homebridge / 2026-09-25, UI 5.29.0 | `/api/auth/settings` instance/wizard state; checkpointed first-user route; saved-password login and `/api/users` admin identity. [Pinned UI source](https://github.com/homebridge/homebridge-config-ui-x/tree/v5.29.0/src), [image release](https://github.com/homebridge/docker-homebridge/releases/tag/2026-09-25) | S | Checkpoint binds instance ID and later owner ID; lost creation not replayed blindly. Bridge UI is not upstream host-network HomeKit pairing acceptance. Expiring bearer is discarded; no native Homarr mapping claimed. |
| Scrypted / v0.147.0-noble-lite | Empty rejected `/login` probe, checkpointed first login, then saved password and durable owner-token readback. [Pinned login implementation recorded in manifest](https://github.com/koush/scrypted/blob/e9a157a329f91d3849d33444abf9dd03592cc5e5/server/src/scrypted-server-main.ts), [reset marker behavior](https://docs.scrypted.app/maintenance/lost-password.html) | S | Saved unit fingerprint/password-file binding; ambiguous creation requires observed existing account. `/login` GET can consume a reset marker: adapter checks marker and labels the route as approved, but a concurrent marker insertion remains unsafe. Admin role is source-inferred, not directly read back. Camera/HomeKit/NVR not accepted; no native Homarr mapping claimed. |
| Node-RED / 5.0.7 | Pre-start bcrypt-derived `adminAuth`; `/auth/login`, password grant `/auth/token`, authenticated `/flows`. [Security contract](https://nodered.org/docs/user-guide/runtime/securing-node-red), [Admin API authentication](https://nodered.org/docs/api/admin/oauth) | S | Saved hash/password equality belongs to shared preparation. Fresh image-user config readability, anonymous denial, flow round-trip and persistence pending. HTTP-node security is separate; expiring token is discarded; no native Homarr mapping claimed. |
| Forgejo / 16.0.5 | Empty `admin user list`; one-time random-password admin creation privately captured; Basic `/api/v1/user` checks active admin. [Pinned creation command](https://codeberg.org/forgejo/forgejo/src/tag/v16.0.5/cmd/admin_user_create.go), [user API](https://codeberg.org/forgejo/forgejo/src/tag/v16.0.5/routers/api/v1/user/user.go) | S | Creation checkpoint required even when password works; lost password capture stops replay. No installer POST/password argv or durable token claim. Empty-inventory formatting, command runtime user, Git round-trip and persistence pending; no native Homarr mapping claimed. |
| Linkwarden / v2.16.3 | Owned-container read-only Prisma user count before checkpointed `/api/v1/users`; saved `/api/v1/session` and `/users/me` id 1; one-time durable `/tokens`; registration env transition and denial probe. [Pinned controller](https://github.com/linkwarden/linkwarden/blob/v2.16.3/apps/web/lib/api/controllers/users/postUser.ts), [token source](https://github.com/linkwarden/linkwarden/blob/v2.16.3/apps/web/lib/api/controllers/tokens/postToken.ts) | F | Nonempty inventory now blocks signup before mutation. Count and signup are not an atomic operation; prevent concurrent registration during approved bootstrap. Lost token response without saved key blocks duplicate creation. Closure-denial probe can create an extra account if closure failed; approval discloses it. Runtime client resolution/count, native Homarr mapping and archive acceptance remain unverified. |
| Docmost / 0.96.0 | SetupGuard-gated `/api/auth/setup`; saved password/cookie login; authenticated `/api/users/me` owner-role and exact saved user/workspace readback. Community implementation, not Enterprise public API. [Identity controller](https://github.com/docmost/docmost/blob/9b3e5dd3dc21588fa20c02c5b8646d2f46ee73af/apps/server/src/core/user/user.controller.ts), [API licensing](https://docmost.com/docs/user-guide/api) | F | No setup replay after attempted checkpoint. Demoted owner and changed saved workspace rejected; private session preserved across deferred identity approval. Workspace/page/file round-trip and actual restart pending; tile-only coverage is not a native integration. |
| BookStack / v26.05.3-ls277 | One-time `bookstack:create-admin --initial --generate-password`, private capture; fresh email login and protected settings/users read. [Command contract](https://www.bookstackapp.com/docs/admin/commands/), [versioned image release](https://github.com/linuxserver/docker-bookstack/releases/tag/v26.05.3-ls277) | S | Initial command rejects unrelated users; placeholder digest distinguishes lost capture and prevents retry. Actual seeded credential rejection is still not exercised by adapter/fixture here. No API-token creation claim; fresh rotation/seed rejection/book round-trip/restart pending; no native Homarr mapping claimed. |
| FreshRSS / 1.30.0 | Install/create-user without password argv; bcrypt through private stdin to `reconfigure-user.php`; hash plus initialized default-user DB checks. [Pinned CLI manual](https://github.com/FreshRSS/FreshRSS/blob/1.30.0/cli/README.md), [password implementation](https://github.com/FreshRSS/FreshRSS/blob/1.30.0/app/Utils/passwordUtil.php) | S | Partial/foreign directories and ambiguous attempted stages rejected. Hash equality is narrower than an actual web login; new user exists briefly without a hash until the approved next step. No mobile-API credential claim. Actual form login/feed round-trip/restart pending; no native Homarr mapping claimed. |
| Nextcloud / 35.0.1-apache | Seeded admin file; version/status, protected OCS user list; checkpointed `If-None-Match:*` WebDAV probe, exact GET. [Pinned status](https://github.com/nextcloud/server/blob/v35.0.1/status.php), [provisioning API](https://docs.nextcloud.com/server/latest/admin_manual/configuration_user/user_provisioning_api.html) | F | Lost PUT is read back, never repeated. Probe intentionally retained; cleanup and actual web/cron restart persistence not executed. Native Homarr capability exists; integration credential/widget proof remains separate. |
| Seafile / 13.0.28 | Initial email/password env; `/api2/auth-token/`; bearer `/api/v2.1/admin/users/` protected read. [13.0 Docker contract](https://manual.seafile.com/13.0/setup/setup_ce_by_docker/), [authentication](https://seafile-api.readme.io/reference/authentication) | F | No password-reset-on-replay. Source correction alone does not prove nondefault loopback authority generates correct file URLs. Library/file round-trip, account readback and restart pending; token not exported as created durable key; no native Homarr mapping claimed. |
| Firefly III / version-6.7.2 | Guest registration/CSRF; saved web login; approved side-effecting OAuth profile GET; one-time personal token and `/api/v1/about/user` owner-role readback; registration closure. [Pinned OAuth controller](https://github.com/firefly-iii/firefly-iii/blob/v6.7.2/app/Http/Controllers/Profile/OAuthController.php), [register controller](https://github.com/firefly-iii/firefly-iii/blob/v6.7.2/app/Http/Controllers/Auth/RegisterController.php) | S | Lost token without saved plaintext blocks duplicate write; checkpoint binds manifest/password path. Queue timing, cookie/CSRF shape, closed-registration text, finance round-trip and restart pending; no native Homarr mapping claimed. |
| Actual Budget / 26.9.0 | `/account/needs-bootstrap`; one-time password-only bootstrap; independent login and `/account/validate` ADMIN check. [Pinned account routes](https://github.com/actualbudget/actual/blob/v26.9.0/packages/sync-server/src/app-account.js) | S | Unowned bootstrapped server rejected; attempted incomplete bootstrap not replayed. No username or durable API key invented. Budget encryption password is separate; budget round-trip and restart pending; no native Homarr mapping claimed. |

## Approval-ready fresh validation batches

Do not run these from this audit. Each batch needs a fresh host/port/storage
inspection, resolved immutable digests for every selected recipe service, exact
reviewed Compose owner and approval. Proposed batches cover every app without
hardware, socket mounts, public routes, third-party providers or external
notifications:

| Batch | Apps | Boundary to validate before same-owner restart |
| --- | --- | --- |
| Identity A | authentik, lldap | Bootstrap/login/admin-role/token readback; anonymous non-admin/denial. Authentik Flow Executor requires actual fresh-cookie proof. |
| Identity B | keycloak, nginx-proxy-manager | Bootstrap password and protected admin reads; no SSO clients, TLS, proxy hosts or ports 80/443. |
| Home UI | home-assistant, homebridge, scrypted | Owner creation, saved login, foreign-owner refusal and lost-response handling; no pairing/cameras/plugins. HA must complete onboarding under its own approval before testing the missing-view restart case. Scrypted reset-marker test must be separately reviewed because its presence is destructive. |
| Developer | node-red, forgejo | Anonymous denial, private editor/admin login, random-password capture; no custom nodes, external remotes or execution of flows. |
| Documents A | linkwarden, docmost | First-user/workspace identity, one-time credential capture and replay; Linkwarden registration closure requires its separate exact transition approval. Add role/foreign-owner regression proofs before declaring complete. |
| Documents B | bookstack, freshrss | Private generated/hash credential, actual login, BookStack public seed rejection, no duplicate creation. No remote RSS fetch required. |
| Files | nextcloud, seafile | Synthetic authorized file round-trip, generated nondefault private URLs, cron readiness; no external storage, shares or SeaDoc. |
| Finance | firefly-iii, actual-budget | Owner/password-only distinction, personal token/ADMIN readback, synthetic finance/budget content only. No bank sync, importer, email or external transactions. |

Use a new mode-0700 root per batch, unique project ID and inspected loopback
ports, project-owned named volumes and the existing shared apply/setup commands.
Review host capacity before choosing concurrency; one batch at a time is the
default. Keep secret values and session cookies out of argv, ordinary evidence,
screenshots and reports. Save only credential file paths and redacted results.

For every app record separate results for image/Compose shape, fresh account,
saved-password login, current role or its explicit gap, durable API key or its
absence, replay, deliberate lost-response reconciliation, functional synthetic
round-trip, scoped service restart, and then optional Homarr tile/integration/
widget. A restart must reauthenticate from the saved private files and read back
the same synthetic content. Stop only the exact batch owner on completion and
retain data for recoverable review; no prune, global teardown or volume removal
is authorized. Failure/unknown is not a passed fresh check and must not promote
the catalog support claim.
