# Gotify existing-message read acceptance — 2026-10-03

Source/fixture work only. No live Gotify, Docker restart, private state, push, or
client-delivery acceptance was performed. Support and catalog validation credit
remain unchanged.

This adapter is staged only: there is no active `acceptance-contract.json`.
`loadSharedAcceptanceContract("gotify")` returns null and the shared acceptance
dispatcher is unavailable. Stored-message reads do not establish Gotify's core
publish/read/push workflow, so they earn no generic core-round-trip or full
product acceptance credit. Activation requires reviewed, real scoped
publish/read/push proof; a source fixture or retained message cannot supply it.

## Pinned evidence

- [v3.1.1 API specification](https://raw.githubusercontent.com/gotify/server/v3.1.1/docs/spec.json)
  declares Basic auth or client tokens for message reads. The onboarding API key
  is an application publisher token, not a read credential.
- [v3.1.1 router](https://raw.githubusercontent.com/gotify/server/v3.1.1/router/router.go)
  registers `GET /application/:id/message` beneath `RequireClient`, along with
  `/application` and `/current/user`. There is no `GET /message/:id` route.
- [v3.1.1 application handler](https://raw.githubusercontent.com/gotify/server/v3.1.1/api/application.go)
  lists only the authenticated user's applications and clears response tokens.
- [v3.1.1 message handler](https://raw.githubusercontent.com/gotify/server/v3.1.1/api/message.go)
  enforces application ownership against the authenticated user. `since` is an
  exclusive upper ID bound, and `limit` bounds the returned page.

Context7 resolved `/gotify/server` and confirmed the read route and
`RequireClient` Basic-auth behavior. Its indexed source is master, so the
version-pinned API specification and handlers above own the implementation
contract. Some direct auth source URLs were unavailable; no unverified token
transport or login route was invented.

## Implemented boundary

The reviewed `message-id` is a positive decimal integer of at most ten digits.
Saved administrator Basic credentials verify `/current/user` as `admin` with
`admin: true`; exactly one authenticated owned `Auto-Stack` application is
required. The adapter selects its existing message through
`GET /application/{applicationId}/message?limit=1&since={messageId+1}` and
requires exact returned `id`, `appid`, and nonempty message content. A missing
message, lower neighboring message, foreign application, denied read, or empty
body fails; none becomes an empty-inventory success.

Canonical JSON of the entire selected payload (including metadata/extras) is
hashed privately. Only user/application/message IDs, canonical byte size, and
SHA-256 are retained or returned; text, title, extras, and credentials are not.
Responses are limited to 1 MiB. The pinned `/version` read permits up to three
attempts after restart for 502/503/504 only; authenticated denials fail directly.

The common read-only acceptance lifecycle binds immutable input, shared owner,
exact `gotify` service/image set, durable pre-restart baseline, and real ordered
stop/start receipts. It re-reads the same message and compares all sanitized
baseline fields after restart. Observer calls are GET-only and cannot write
secrets or checkpoints. No message/application/token creation, deletion,
POST login, publisher-token use, or push/client-delivery claim exists. Cleanup
is unnecessary because this workload is read-only.

## Focused validation

Passed with Bun 1.4.0:

- `bun packages/cli/tests/gotify-read-acceptance.test.ts`
- `bun build .agents/skills/self-host/workflows/selfhost/references/catalog/apps/gotify/acceptance.ts --target=bun --outfile=/dev/null`
- `git diff --check`

Fixtures confirm absent contract/dispatcher availability and directly cover
successful pre/post staged readback, sanitized outputs/checkpoints,
invalid workload inputs, missing/empty/oversized/foreign messages, duplicate
application names, 401/403/404, changed user/application/body/metadata, immutable
input rejection, and wrong service/owner/restart epoch. Fixtures give zero live
restart, core-round-trip, full product, or app-function validation credit.
