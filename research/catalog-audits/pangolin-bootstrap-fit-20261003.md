# Pangolin bootstrap fit — 2026-10-03

Reused [remaining installability](remaining-installability-20261003.md),
[networking first-run](networking-first-run-20261003.md),
[remaining network](network-remaining-20261003.md) and the existing local-only
configuration helper. This resolves the pinned wire gap, not deployment/TLS or
acceptance. Context7 `library Pangolin` selected `/fosrl/pangolin`, then `docs`
retrieved mutable examples; official 1.24.0 source below overrides their incorrect
`setupComplete`, validation `setupToken`, admin `userId`, and bare response bodies.

## Token is not a password

[Startup implementation](https://github.com/fosrl/pangolin/blob/1.24.0/server/setup/ensureSetupToken.ts)
prints four consecutive lines: header `=== SETUP TOKEN GENERATED ===`,
`Token: ` followed by exactly 32 lowercase ASCII letters/digits, usage text,
then 32 equals signs. Header alternatives are `EXISTS` and `FROM ENVIRONMENT`.
The token database has `used`, `dateCreated`, `dateUsed`, but **no expiry**
([SQLite schema](https://github.com/fosrl/pangolin/blob/1.24.0/server/db/sqlite/schema/schema.ts)).
Restart before an admin exists reuses the unused token; it does not rotate it.
An explicitly supplied `PANGOLIN_SETUP_TOKEN` validates the same format and may
overwrite the unused token. Any existing server admin suppresses the whole
startup path. Admin creation consumes the token within the same transaction as
account insertion. Restart is not reset; deleting state is not authorized here.

An owned current-start log interval is a bounded observation window, not a token
TTL or proof of fresh persistent state. A future capture owner needs a distinct
typed **setup capability** slot, exact service/image/start binding, bounded log
cursor, exact multiline recognition, private storage/redaction, and saved-state
CAS. It must not write this into `adminPassword`, `readBootstrapPassword`, or a
Frigate/qBittorrent password profile. Those passwords authenticate login; this
token only authorizes first-admin creation. No generic token capture was added.

## Exact HTTP contract implemented as staged app helpers

All normal responses use `{data,success,error,message,status}` from the pinned
[response wrapper](https://github.com/fosrl/pangolin/blob/1.24.0/server/lib/response.ts).
Helpers validate actual HTTP status against wrapper status, success/error flags,
and the required data. Non-GET requests include JSON content type and
`x-csrf-token: x-csrf-protection`
([middleware](https://github.com/fosrl/pangolin/blob/1.24.0/server/middlewares/csrfProtection.ts)).

| Operation | Pinned wire | Helper boundary |
| --- | --- | --- |
| [Inspect setup](https://github.com/fosrl/pangolin/blob/1.24.0/server/routers/auth/initialSetupComplete.ts) | GET `/api/v1/auth/initial-setup-complete`, 200 `data:{complete:boolean}` | Existence only, never owned identity. |
| [Validate capability](https://github.com/fosrl/pangolin/blob/1.24.0/server/routers/auth/validateSetupToken.ts) | POST `/api/v1/auth/validate-setup-token`, body `{token}`, 200 `data:{valid:boolean,message:string}` | Approval-required request, no consumption. |
| [First admin](https://github.com/fosrl/pangolin/blob/1.24.0/server/routers/auth/setServerAdmin.ts) | PUT `/api/v1/auth/set-server-admin`, `{email,password,setupToken}`, 200 `data:null` | Fresh-state/completion/token predicates, before-send expected-revision checkpoint, once approval, reject attempted replay. |
| [Login](https://github.com/fosrl/pangolin/blob/1.24.0/server/routers/auth/login.ts) | POST `/api/v1/auth/login`, `{email,password}`, 200 `data:null`, private Set-Cookie | No saved cookie attached; require exact `Logged in successfully` branch, reject `Already logged in` and MFA/verification branches. |
| [Owned user](https://github.com/fosrl/pangolin/blob/1.24.0/server/routers/user/getUser.ts) | GET `/api/v1/user`, 200 data includes `userId,email,username,type,serverAdmin,emailVerified` | Match saved lowercase email, internal admin and verified email; optionally bind saved user ID. |
| [Root key creation](https://github.com/fosrl/pangolin/blob/1.24.0/server/routers/apiKeys/createRootApiKey.ts) | PUT `/api/v1/api-key`, `{name}`, 201 `data:{apiKeyId,name,apiKey,lastChars,createdAt}` | Explicit global-authority review; once/CAS; refuse saved-key/attempted duplication. Return private secret for immediate save, not ordinary reports. |
| [Key metadata](https://github.com/fosrl/pangolin/blob/1.24.0/server/routers/apiKeys/getApiKey.ts) | GET `/api/v1/api-key/:apiKeyId`, 200 `data:{apiKeyId,lastChars,createdAt,isRoot,name}` | Match saved metadata only, not secret authentication. |

The first-admin password has the pinned [8–128 character complexity rule](https://github.com/fosrl/pangolin/blob/1.24.0/server/auth/passwordSchema.ts).
[Session cookies](https://github.com/fosrl/pangolin/blob/1.24.0/server/auth/sessions/app.ts)
are configurable-name, HttpOnly, SameSite=Lax and carry Secure/Domain on HTTPS;
the approved canonical-origin transport must retain them privately. Session
expiry is unrelated to the non-expiring setup token. Helpers do not persist
cookies/checkpoints/secrets or prove the caller's supplied state facts.
`forceLogin=true` is not a password-proof bypass fix: pinned
[session verification](https://github.com/fosrl/pangolin/blob/1.24.0/server/auth/sessions/verifySession.ts)
still accepts a normal session issued within five minutes. The generated login
request has no Cookie header, and response validation rejects that early branch.

## Deliberately unfinished

Set-server-admin creates no organization. [Create org](https://github.com/fosrl/pangolin/blob/1.24.0/server/routers/org/createOrg.ts)
links the logged-in user as owner/admin; [user-org readback](https://github.com/fosrl/pangolin/blob/1.24.0/server/routers/org/listUserOrgs.ts)
returns ownership flags. Organization creation and org-scoped keys are not
implemented, avoiding duplicate org creation or invented ownership claims.

Root-key routes are OSS-only and session/server-admin guarded in the pinned
[external router](https://github.com/fosrl/pangolin/blob/1.24.0/server/routers/external.ts).
Key secrets are returned once; listing/GET retains only metadata. Missing output
after an attempted PUT requires private reconciliation, not another key.
The [Integration API](https://github.com/fosrl/pangolin/blob/1.24.0/server/integrationApiServer.ts)
is a separate listener/prefix `/v1`, with
[Bearer `apiKeyId.apiKeySecret`](https://github.com/fosrl/pangolin/blob/1.24.0/server/middlewares/integration/verifyApiKey.ts).
New root keys have no implicit action grants: selected actions must be reviewed
and set before authenticated functional readback
([action middleware](https://github.com/fosrl/pangolin/blob/1.24.0/server/middlewares/integration/verifyApiKeyHasAction.ts)).
Metadata readback does not prove the saved secret works. No action-grant helper
or Integration API acceptance claim was added.

`apps/pangolin/bootstrap.ts` is not a discoverable `setup.ts`. Existing pinned
digest, canonical domain/DNS/TLS/edge, image-readability/state, token capture,
owned organization, authenticated key action, actual local routed resource and
restart gates remain. No support/readiness/compatibility promotion, live Docker,
container exec, private configuration/credential reads, browser, CI, commit or
push occurred. Fixture values are synthetic; no real payloads appear here.

Validation: only the new `pangolin-bootstrap.test.ts` fixture and the staged
helper Bun build passed on Bun 1.4.0; focused diff check passed. These are pure schema,
freshness/replay/CAS, identity and key-output checks, not live first-run proof.
