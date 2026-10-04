# slskd 0.26.0 shared-Compose first-run contract

- Checked: 2026-09-29
- Status: source-backed headless credential verification; live behavior unverified
- Scope: private Web UI administrator and primary API key, not Soulseek account or peer ingress
- Source allowlist: `github.com/slskd/slskd`, `raw.githubusercontent.com/slskd/slskd`
- Browser session: not used; session closure not applicable

## Primary evidence

| Role | Pinned source | Finding |
| --- | --- | --- |
| Official configuration | [0.26.0 config](https://github.com/slskd/slskd/blob/0.26.0/docs/config.md) | Environment variables override defaults; `SLSKD_USERNAME`, `SLSKD_PASSWORD`, and `SLSKD_API_KEY` configure the Web UI login and primary API key. The primary key defaults to Administrator role and is sent in `X-API-Key`. The Soulseek account is separate. |
| Official image contract | [0.26.0 Docker guide](https://github.com/slskd/slskd/blob/0.26.0/docs/docker.md) | The image persists its application directory at `/app`; image user and port mapping are separate deployment decisions. |
| Official API source | [0.26.0 SessionController](https://github.com/slskd/slskd/blob/0.26.0/src/slskd/Core/API/Controllers/SessionController.cs) | `GET /api/v0/session/enabled` returns whether authentication is enabled; authenticated `GET /api/v0/session` checks a credential; `POST /api/v0/session` accepts the configured username/password and returns a token. |
| Official API source | [0.26.0 TokenResponse](https://github.com/slskd/slskd/blob/0.26.0/src/slskd/Core/API/DTO/TokenResponse.cs) | Successful password login returns a token and login name; the token can be used for an authenticated session readback. |

## Decision

Keep the generated 48-character alphanumeric password and primary API key in owner-only private files, bound to the documented environment variables through the shared Compose secret environment. The app adapter verifies authentication is enabled, checks the primary key via `X-API-Key`, then submits the saved `admin` username and password to the pinned session endpoint and reads the session with the returned bearer token. It checkpoints only after both credentials pass; inspection rechecks the API key and requires that saved login checkpoint. No credential is included in a report, URL, command argument, or checked-in recipe.

The adapter does not enable slskd's headless/no-Web-UI mode: that mode explicitly rejects password login, so it cannot establish the requested username/password handoff. “Headless setup” here means no browser interaction.

## Limits

The source URLs were reachable in public lookup on the check date; no browser, Docker, live image, Soulseek login, transfer, or restart test was performed. The fixed Web UI credentials and API key are pre-start configuration, not an account-created-through-API claim. The source-level setup route verifies credentials on a running shared unit; restart persistence, Soulseek account setup, peer ingress, and authorized transfers remain separate checks. No raw browser payload or secret was captured; redaction count is zero. Confidence is high for the pinned source contract and low for untested live acceptance.
