# Identity/productivity headless adapter audit

2026-10-03. Source and synthetic-fixture review only; no deployment, image pull,
runtime credential/session read, restart, browser, CI, or commit. Existing
`product/research/catalog-*-2026-09-*.md` and
`research/catalog-audits/identity-existing.md` were reused before changes.
Earlier notes predating implemented adapters are historical, not current gaps.

## Corrections

- BookStack now saves its pending CSRF token and cookies in the existing
  exact-owner/origin private session facility before requesting login approval.
  It validates a digest of the saved email/password before reuse. Separate CLI
  invocations therefore review the same POST body. Explicit expiration or
  rejected authenticated readback clears the pending form; generic failures do
  not trigger a new login automatically. A successful password POST must still
  open the administrator-only users page. The pinned controller regenerates
  the session on login. [BookStack v26.05.3 login controller](https://github.com/BookStackApp/BookStack/blob/v26.05.3/app/Access/Controllers/LoginController.php)
- Firefly III preserves pending registration/login forms in the same private
  facility, validates the owner-password digest, and rechecks the managed email
  on its authenticated profile each invocation. A saved creation checkpoint
  reconciles a lost registration response through independent login, never
  another registration POST. An authenticated session survives later OAuth
  approvals; its result explicitly distinguishes current password login from
  previously verified password login. A lost one-time token result still blocks
  duplicate creation. [Pinned registration form](https://github.com/firefly-iii/firefly-iii/blob/v6.7.2/resources/views/auth/register.blade.php),
  [login form](https://github.com/firefly-iii/firefly-iii/blob/v6.7.2/resources/views/auth/login.blade.php),
  [login controller](https://github.com/firefly-iii/firefly-iii/blob/v6.7.2/app/Http/Controllers/Auth/LoginController.php).
  Current Laravel documentation was obtained with Context7; its CSRF/session
  contract is corroborating documentation, not a claim about Firefly's exact
  dependency version. [Laravel CSRF](https://laravel.com/docs/13.x/csrf)
- Keycloak no longer accepts master-realm readability alone as administrator
  proof. It reads the unique enabled exact `admin` account and its effective
  realm roles, requiring the master-realm `admin` role (not a client/view role).
  The first successful check saves the account/realm IDs; replay refuses a
  replacement identity. The pinned bootstrap grants precisely this role, and
  the role representation exposes `clientRole` and `containerId`.
  [26.7.4 bootstrap](https://github.com/keycloak/keycloak/blob/26.7.4/services/src/main/java/org/keycloak/services/managers/ApplianceBootstrap.java),
  [effective realm-role route](https://github.com/keycloak/keycloak/blob/26.7.4/services/src/main/java/org/keycloak/services/resources/admin/RoleMapperResource.java),
  [representation fields](https://github.com/keycloak/keycloak/blob/26.7.4/server-spi-private/src/main/java/org/keycloak/models/utils/ModelToRepresentation.java).
  Context7's official Keycloak docs confirmed the composite role-mapping API and
  bootstrap lifecycle; pinned source determines this adapter's behavior.

## Per-app boundary

The new fixture covers BookStack, Firefly III, and Keycloak only. Other rows are
source/code review and reuse of earlier evidence, not newly executed tests.
**Fresh-instance, scoped restart, and full app-function acceptance were not run
for any row.** App tiles, native Homarr descriptors, authenticated integrations,
and useful widgets remain separate claims; no Homarr runtime check ran here.

| App / pin | First-run and replay evidence | Remaining boundary |
| --- | --- | --- |
| Authentik / 2026.8.3 | Bootstrap token proves `akadmin` superuser; identification/password flow proves saved password. Inspection truthfully labels historical password proof. [Identity source](https://github.com/goauthentik/authentik/blob/version/2026.8.3/authentik/core/api/users.py) | Bootstrap env creates an account during Compose startup, not an observed fresh adapter creation. Provider/MFA/SSO and restart acceptance pending. |
| Keycloak / 26.7.4 | Saved-password grant, unique enabled account, master admin role, same account/realm checkpoint. New demotion/replacement fixture passes. [Bootstrap source](https://github.com/keycloak/keycloak/blob/26.7.4/services/src/main/java/org/keycloak/services/managers/ApplianceBootstrap.java) | Bootstrap temporary-admin lifecycle and production TLS/SSO pending. `productionEdgeVerified:false` is retained. |
| LLDAP / 2026-08-28 | Saved password plus GraphQL `admin` identity and `lldap_admin` group; prior demotion fixture retained. [Permissions](https://github.com/lldap/lldap/blob/main/docs/scripting.md) | Date-tag-to-source association, LDAP bind/consumer compatibility pending. No durable JWT claim. |
| Forgejo / 16.0.5 | Empty CLI user inventory, checkpointed random-password capture, Basic API active admin proof; no creation replay after lost capture. [Creation source](https://codeberg.org/forgejo/forgejo/src/tag/v16.0.5/cmd/admin_user_create.go) | Runtime CLI user/layout, Git operation and restart pending. Current checkpoint does not bind API user ID across replacement. |
| Docmost / 0.96.0 | SetupGuard-gated setup, private cookie login, owner role and checkpoint-bound user/workspace UUIDs. [Owner assignment](https://github.com/docmost/docmost/blob/9b3e5dd3dc21588fa20c02c5b8646d2f46ee73af/apps/server/src/core/auth/services/signup.service.ts) | Community internal API is not Enterprise API acceptance; page edit/read persistence pending. |
| BookStack / v26.05.3-ls277 | Checkpointed initial admin command/password capture, approval-stable form, saved-password login plus users-page access. New deferred/mismatch/expiry/rejected-readback fixture passes. [Login source](https://github.com/BookStackApp/BookStack/blob/v26.05.3/app/Access/Controllers/LoginController.php) | Runtime capture contract, page round-trip and restart pending; no token generated. |
| Actual Budget / 26.9.0 | Checkpointed password bootstrap; login token plus validated password-method ADMIN; no duplicate bootstrap after uncertainty. [Account routes](https://github.com/actualbudget/actual/blob/v26.9.0/packages/sync-server/src/app-account.js) | Creating/syncing a budget and restart pending. Password-only server owner is not multi-user acceptance. |
| Firefly III / 6.7.2 | Pending forms and authenticated session persist privately; current profile email, owner-role token readback, registration-closed page; checkpointed token capture. New fresh-call/replay/lost-result fixture passes. [Token controller](https://github.com/firefly-iii/firefly-iii/blob/v6.7.2/app/Http/Controllers/Profile/OAuthController.php) | Session reuse is not a new password login. Ledger/transaction behavior and restart pending; token/profile proof binds email, not immutable user ID. |
| Umami / 3.4.0 | Seed login, one-time generated-password rotation, saved UUID/admin-role login, seed rejection. [Authentication docs](https://docs.umami.is/docs/api/authentication) | No durable key is generated; native Homarr descriptor does not prove integration auth. Website event/statistics acceptance pending. |
| FreshRSS / 1.30.0 | Checkpointed install/user/hash writes; private `password_verify`, default enabled user's initialized database. [Password utility](https://github.com/FreshRSS/FreshRSS/blob/1.30.0/app/Utils/passwordUtil.php) | This is hash/database proof, **not a web password login**. Feed fetch/read and restart pending. |
| Linkwarden / v2.16.3 | Empty owned Prisma user count, checkpointed signup, private session, first-owner ID, one-time token plus token readback. [Signup controller](https://github.com/linkwarden/linkwarden/blob/v2.16.3/apps/web/lib/api/controllers/users/postUser.ts) | Count/signup is non-atomic. Registration closure is a separate approved Compose transition; archive round-trip/native Homarr auth/restart pending. |

## Focused validation

`packages/cli/tests/identity-productivity-setup.test.ts` passed under Bun 1.4.0:
pending approvals repeated twice before exact-body approval, changed owner
password refusal, expired/rejected BookStack form clearing, Firefly cached
profile uncertainty versus explicit expiration, one registration after a lost
response, no second token after lost plaintext, Keycloak demotion and identity
replacement refusal. The fixture hashes approval-sensitive request fields and
checkpoint revisions; it is not an actual shared-transport or live-app test.
Builds of the three changed adapters and new fixture passed. No broad suite ran.
