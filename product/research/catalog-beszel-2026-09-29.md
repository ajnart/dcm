# Beszel 0.20.0 shared-Compose first-run contract

- Checked: 2026-09-29
- Status: blocked for a complete headless username/password/API-key handoff
- Scope: Beszel Hub only; no agent, Docker, browser, or live-instance check
- Source allowlist: `beszel.dev`, `www.beszel.dev`, `github.com/henrygd/beszel`

## Primary evidence

| Role | Source | Finding |
| --- | --- | --- |
| Official 0.20.0 guide | [Environment variables](https://beszel.dev/guide/environment-variables) | `USER_EMAIL` and `USER_PASSWORD` create the first user. The page does not specify the resulting Hub role, separate PocketBase superuser state, restart semantics, or an API-key export. |
| Official guide | [User accounts](https://beszel.dev/guide/user-accounts) | Hub users and PocketBase superusers are separate accounts. The interactive initial setup creates both, while the documented `superuser upsert` command changes only the PocketBase identity and takes a password argument. |
| Official guide | [REST API](https://beszel.dev/guide/rest-api) | Regular-user password authentication is documented through PocketBase; API response structure may change in minor releases. No first-run API-key creation or stable export contract is documented. |
| Upstream issue | [Initial environment role discussion](https://github.com/henrygd/beszel/issues/2013) | Reports that environment-created first users may have `user`, not `admin`, role. This is an issue report, not a version-pinned guarantee. |
| Upstream discussion | [Universal-token API discussion](https://github.com/henrygd/beszel/discussions/1241) | Describes an agent registration token, not a proven Hub user API key; the report shows token rotation between calls. |

The [hub installation guide](https://www.beszel.dev/guide/hub-installation) and [v0.20.0 release](https://github.com/henrygd/beszel/releases/tag/v0.20.0) support the existing hub-only Compose candidate: `henrygd/beszel:0.20.0`, port 8090, `APP_URL`, and persistent `/beszel_data`. The [health guide](https://www.beszel.dev/guide/healthchecks) supports `/api/health` as a narrow HTTP check. The recipe's `admin@example.test` is a placeholder, not a deliverable email identity.

## Decision

Keep the Beszel recipe at manual first-email onboarding and do not add a `setup.ts` adapter yet. Environment bootstrap is a plausible partial path, but a generated credential in Compose is insufficient to prove an administrator login, the separate superuser, and a stable API key. A source-proven and replay-safe route would need version-pinned 0.20.0 verification of both account records/roles and login, a documented definition and creation/readback endpoint for the requested API key, and recovery behavior after an interrupted first run. The current shared setup context also cannot safely pass a secret password to the documented `superuser upsert` CLI without putting it in argv.

The hub recipe deploys no monitoring agent. Hub health, login, an agent with fresh metrics, and restart persistence remain separate acceptance claims.

## Evidence handling and limits

No secrets or raw browser payloads were captured. No browser session was opened. The cited pages were reachable in public source lookup on 2026-09-29; no live Beszel image or API behavior was tested. Confidence is high for the documented distinction between accounts and the absence of a documented key route in these sources, and medium for the environment-created user's role because that claim comes from an upstream issue.
