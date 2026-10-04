# NetBird 0.80.0 first-owner adapter fit — 2026-10-03

Status: app-local private wire contracts only; no registered `setup.ts`, recipe,
service provisioning, TLS/UDP changes, account/key mutation or live acceptance.
Existing pinned `configuration.ts` and first-owner bootstrap remain the owners
of their respective contracts. Context7 resolved `/netbirdio/docs` and fetched
official onboarding/OAuth/PAT documentation; pinned publisher code controls
the actual routes/schema below (the indexed PAT request example differs).

## Implemented gap

`netbird/login-contract.ts`, re-exported by `bootstrap.ts`, builds a fresh local
password login using retained private OAuth state/nonce and S256 PKCE verifier:

1. `GET /oauth2/auth/local` with public client `netbird-dashboard`, approved
   `${canonicalOrigin}/nb-auth`, `openid profile email` and `prompt=login`.
2. Validate a same-origin redirect to `/oauth2/auth/local/login`, keeping the
   server-generated auth-request state distinct from the caller OAuth state.
   Send saved credentials only in URL-encoded `POST` body.
3. Require the exact same-origin callback and matching OAuth state, then
   exchange its one-use code at `/oauth2/token`. Do not follow the callback into
   the dashboard. Reject failed-password HTML, MFA/approval/foreign redirects,
   duplicate parameters, errors and callback fragments.
4. Shape-check the temporary bearer JWT and verify successful authenticated
   `GET /api/users/current`: exact saved email/optional retained ID, active
   unblocked current local owner, not a service user or pending approval.

The [NetBird embedded configuration](https://github.com/netbirdio/netbird/blob/v0.80.0/management/server/idp/embedded.go)
enables local password DB, public dashboard/CLI clients and skipped approval.
[NetBird's Dex config translation](https://github.com/netbirdio/netbird/blob/v0.80.0/idp/dex/config.go)
does **not** configure `PasswordConnector`. Its
[pinned Dex dependency](https://github.com/netbirdio/netbird/blob/v0.80.0/go.mod)
is `a163de3129e5`; that revision's
[server](https://github.com/netbirdio/dex/blob/a163de3129e5/server/server.go)
only enables the password grant when configured, and its
[handlers](https://github.com/netbirdio/dex/blob/a163de3129e5/server/handlers.go)
register connector/login/token routes, accept form fields `login`/`password`,
enforce PKCE and return bearer JWTs. A guessed JSON login or password grant
would therefore be wrong for this candidate. The flow requires trusted HTTPS,
manual redirects and a fresh private cookie jar, not an existing session.

Token-shape validation is deliberately **not** signature/nonce verification.
Successful management authentication/readback is still required; a future
caller consuming OIDC claims must independently validate the signed ID token.
All returned credentials/request headers are private-boundary values, not
reports. The pure contract performs no HTTP, cookie persistence or I/O.

## Resume and PAT limits

The [current-user handler](https://github.com/netbirdio/netbird/blob/v0.80.0/management/server/http/handlers/users/users_handler.go)
returns current ID, email, role, state and local connector metadata. After a
lost setup response, saved-password login can recover and verify the exact
owner without another setup POST. If a retained ID exists, it must match.
It cannot recover the one-time PAT. After a lost code exchange, start a fresh
login; never recreate the owner or a PAT.

Authenticated [PAT metadata routes](https://github.com/netbirdio/netbird/blob/v0.80.0/management/server/http/handlers/users/pat_handler.go)
are `GET /api/users/{userId}/tokens` and the corresponding token-ID route.
`netbirdSetupPatReadback` requires a unique `setup-token` created by the saved
owner within the retained bootstrap attempt/completion window, a still-valid
one-day lifetime envelope and any previously retained token ID. Missing,
expired, mismatched or ambiguous metadata fails closed without issuing a key.
The [setup service](https://github.com/netbirdio/netbird/blob/v0.80.0/management/server/instance/setup_service.go)
names the optional key `setup-token`, defaults to one day and returns only its
plain value; unlike ordinary key creation, it returns **no token ID**.

[PAT construction](https://github.com/netbirdio/netbird/blob/v0.80.0/management/server/types/personal_access_token.go)
uses local-calendar `AddDate` (the helper conservatively permits 23–25h across
DST). There is no token-specific scope field: permissions inherit the user.
[Authentication middleware](https://github.com/netbirdio/netbird/blob/v0.80.0/management/server/http/middleware/auth_middleware.go)
checks the exact presented PAT's hash and expiry, then uses its owner identity.
Thus successful PAT-authenticated owner readback proves the saved PAT is
currently accepted. Listed metadata cannot cryptographically prove which
token ID corresponds to the presented plain key. Unique name/time correlation
is narrower evidence, not a durable credential-binding or rotation claim.
No automatic PAT rotation or replacement is implemented.

## Exact promotion gate

Before any registered setup/recipe can ship, reuse the shared owner to persist
approval-bound attempt/checkpoint state, private once-only response capture,
retained identity/key metadata and a protected fresh-login cookie/redirect
transport. Declare independent verified management-target transport/TLS facts;
do not let these pure helpers authorize origin, DNS, proxy or UDP changes.
The existing candidate still requires typed non-secret dashboard OIDC metadata,
a secondary private management HTTP frontend, protocol-aware HTTPS HTTP/OAuth,
WebSocket and native gRPC/h2c ownership, and separately approved direct STUN.
PAT expiry/rotation policy and exact secret-to-ID reconciliation remain explicit
gates, not covered by the metadata envelope. Fresh login/PAT acceptance, real
authorized client connectivity and exact-project restart persistence need live
evidence before installability or managed support changes.

## Focused validation

Only `packages/cli/tests/netbird-bootstrap.test.ts` was extended/run, under
Bun 1.4.0. It passes deterministic PKCE/form/token requests, wrong-origin/state,
duplicate/error/MFA rejection, fresh-password and PAT owner readbacks, metadata
ambiguity/mismatch/expiry rejection and all existing bootstrap replay cases.
Both app-owned modules build with `--target=bun --outfile=/dev/null`; focused
diff whitespace validation passes. No runtime acceptance was performed.
