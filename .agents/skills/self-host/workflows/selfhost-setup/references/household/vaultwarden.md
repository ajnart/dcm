# Vaultwarden: private password vault

Status: guided recipe, sources checked 2026-09-21. An isolated pinned 1.37.3
test observed signup, identity-matched fresh login, and login after registration
closure; this is not household-device trust or recovery proof. Explain that
Vaultwarden works with compatible Bitwarden clients.
It is a shortcut-only app in the current Homarr catalog, not a live integration.

## Choices and identity

Ask for the account email if it is not already known. Do not turn the chosen
username into an invented email address. Generate a separate strong vault master
password; never reuse the media administrator password or a server admin token.
Keep it in the explicitly requested owner-only credential handoff. The user
must retain access to that handoff independently of this vault.

## Owned deployment

The standalone `self-host vaultwarden local-https init|plan|apply|status` path
can first create an independently approved host-only Caddy route. `init`
requires a fresh owner-only host inspection with an exact free selected port,
complete Docker networks, and a local `default` or `rootless` Docker context.
The bounded general listener inventory may be truncated; the exact selected
port result and the first-apply live bind are the authoritative checks. It
writes one no-clobber owner-only route input under
`.selfhost` and runs no Docker command. The route defaults to
the candidate `vaultwarden.localhost` on loopback port `28443`, accepts
`localhost` or another `.localhost` name, requires a fresh unused-port
observation, and re-probes the port immediately before first apply. Its one
official version-tagged digest-pinned Caddy container has no Docker socket,
persists `/config` and `/data`, and owns an internal upstream bridge plus a
separate rootless-compatible ingress bridge. The later Vaultwarden project joins
only the upstream bridge. Apply exports the local CA. Its recorded
`curl --cacert --resolve` result proves only a TLS endpoint, not ordinary name
resolution, browser/client trust, or the backend application. A 502 before
Vaultwarden joins the network is expected. Install and verify the exported CA
and private name on every intended client without using a certificate-warning
bypass.

For a Linux agent-browser acceptance run, check that its installed CLI supports
`--ca-cert` and that `certutil` is available (Debian/Ubuntu: `libnss3-tools`).
Start the fixed `selfhost-household-RUN_ID` session with
`agent-browser --session selfhost-household-RUN_ID --ca-cert EXPORTED_ROOT_CRT open HTTPS_ORIGIN`.
This trusts that public Caddy root only in the session's private Chromium NSS
database; hostname and validity checks remain active. Use the same session for
the credential helper. An older browser without `--ca-cert` needs trust set up
on the intended client before acceptance. See the
[agent-browser CA option](https://agent-browser.dev/proxy). This test does not
establish trust on another device.

The `self-host vaultwarden prepare|apply|close-registration|status`
path then uses the two-phase application recipe. Give `prepare` an owner-only account metadata
file (`schemaVersion`, `username`, `email`); it creates or reuses the private
Vaultwarden credential handoff. `prepare` records the exact manifest, private HTTPS route/TLS ownership,
and a SHA-256 approval digest. `apply` renders a content-addressed Compose
file and starts only that project, then stops at `browser-signup-required`.
For a newly prepared, originally-new run using the exact observed
`docker.io/vaultwarden/server:1.37.3@sha256:1587c45feaa479f1f5e8af3b00eded36bff77bcf1880cf8dbf0541706dd470e0`
image, use the separate `signup plan|apply|status` approval below. After a
secure-context signup and fresh login, supply its non-secret evidence and
verified-existing host observations to `close-registration`; approve that new
digest before its Compose revision. `status` reports checkpoints only, not
runtime health or vault acceptance. Complete vault acceptance and household
device trust remain separate from this pinned browser contract.

Use `selfhost-compose` for an owned project and `selfhost-ingress` for its
private HTTPS route. Resolve an immutable image digest from the official
`vaultwarden/server` repository before apply; record the source and digest.
Mount the exact owned persistent directory at `/data`. The official hardening
guide supports a non-root UID:GID. In rootless Docker, the CLI's first apply
maps the exact data directory to that container identity with one scoped
one-shot Compose helper; do not `chown` a broader host path. The host user may
then need a container-based backup/restore path for that mapped directory.
Use `ROCKET_PORT=8080` for an unprivileged container listener, and publish only
to the approved private/loopback address. Keep the optional admin page disabled
unless a separate server-administration task requires it.

Set `DOMAIN` to the approved user-facing HTTPS origin. Configure and test the
reverse proxy before onboarding. The web vault depends on browser WebCrypto;
loading its HTML over plain LAN HTTP does not prove it can create or unlock a
vault. Verify `window.isSecureContext` and `crypto.subtle` as booleans, and verify
the intended user's device trusts the certificate. Never treat a TLS-warning
bypass in the automation browser as client acceptance.

## First account and resume

For the bounded pinned CLI path, after bootstrap apply run `self-host
vaultwarden signup plan --project-root PROJECT --run-id RUN_ID --browser-bin
ABSOLUTE_EXECUTABLE --ca-cert PUBLIC_ROOT_CERT`. Review its exact content-bound
digest, then use the same options with `signup apply --approve DIGEST`.
The default browser sandbox is enabled; a host-required
`--browser-sandbox disabled` is a separate explicit choice bound into that plan.
Bun, agent-browser with `--ca-cert`, and NSS `certutil` are required. The helper
starts a fresh isolated CA-trusted session with ordinary hostname/validity
checks, privately fills managed fields, disables breach lookup, submits signup
once, handles only known pinned onboarding controls, signs out, and verifies
identity-matched fresh login. Only accepted execution writes
`.selfhost/vaultwarden/RUN_ID/signup-evidence.json` for registration closure.
The guarded welcome fix (`2fe471b`) handles only the known `You're in! Welcome
to Bitwarden` optional-tour dialog with its exact enabled `Skip` and `Start
tour` controls; unknown dialogs remain blocked.

The owner-only no-clobber attempt ledger is durably flushed before browser work
and before account submission. The owned nonce session is also flushed before
launch; interrupted status can retain its takeover reference without claiming
that launch or TLS trust was verified. Any interrupted, failed, or unknown attempt
blocks all future signup attempts. `signup status` offers only existing-account
fresh-login reconciliation. Failed execution reports a fixed stage and retains
its adapter-owned unpredictable browser session for private takeover. Never
print populated snapshots, field values, full URLs, or raw browser envelopes;
the ordinary fixed-session login command does not target this nonce session.
Successful signup closes only its owned session. Legacy runs have unknown signup history and cannot
use bounded signup. Do not submit signup manually before this approved path;
that would invalidate its first-attempt provenance. Registration closure always
keeps its separate approval. Never reset a vault or re-enable signup on resume.

On a fresh private deployment, permit registration only for the controlled
bootstrap interval. For a separately reviewed guided deployment outside the
bounded pinned path, open the web vault root, inspect current form metadata,
choose account creation, and enter the selected email/name plus the generated
master password and confirmation. Use private field-validated input; ordinary
snapshots must not contain populated credentials. Do not POST a plaintext
master password to a guessed server API: the official web client performs the
vault's cryptographic account setup.

For a standalone CLI install, use the fixed `selfhost-household-RUN_ID`
agent-browser session and fresh form refs, then `self-host browser fill
--project-root PROJECT --run-id RUN_ID --service vaultwarden --origin
HTTPS_ORIGIN --input email=@eN --input password=@eN` (repeat the password
input for confirmation). This packages the existing household helper; it
sends managed values over browser stdin and does not require the skill tree.
Verify actual client CA trust before counting browser acceptance.

After successful creation, sign out and open the initial email login form in
that same CA-trusted session. Run `self-host browser login --project-root
PROJECT --run-id RUN_ID --service vaultwarden --origin HTTPS_ORIGIN`.
It discovers fresh controls, privately fills the saved credentials, and submits
each login step once. `accepted` is narrow fresh-login evidence; `rejected` or
an unknown-state failure leaves the account gate open. A saved signup assertion
or successful field fill is not login proof. For an interrupted password form,
inspect privately and return to the initial email form before a new attempt;
first reconcile a rejected login rather than repeating signup.

Set `SIGNUPS_ALLOWED=false` and `INVITATIONS_ALLOWED=false` through the owning
Compose plan/apply flow, then verify the saved account still logs in and new
registration is disabled. Record the actual bootstrap path observed for the
pinned image. On resume, authenticate to the existing account; never re-enable
registration or reset an existing vault to recover an interrupted setup.

## Acceptance and handoff

- Persistent `/data`, the intended HTTPS origin, and client certificate trust.
- Fresh login and vault unlock using the selected account.
- Closed registration after bootstrap.
- Homarr shortcut points to the reachable origin; no API-key/widget claim.
- Encrypted export and isolated recovery evidence before migrating real vault
  contents. An empty test account does not establish recovery for real data.
- Private handoff records the account email, master password, URL, storage,
  deployment identity and the exact remaining recovery steps. No vault contents
  or credentials belong in the Homarr recap or ordinary report.

## Sources

- [Container deployment](https://github.com/dani-garcia/vaultwarden/wiki/Starting-a-Container)
- [Hardening guide](https://github.com/dani-garcia/vaultwarden/wiki/Hardening-Guide)
- [HTTPS and reverse proxy](https://github.com/dani-garcia/vaultwarden/wiki/Enabling-HTTPS)
- [Disable registration](https://github.com/dani-garcia/vaultwarden/wiki/Disable-registration-of-new-users)
- [Disable invitations](https://github.com/dani-garcia/vaultwarden/wiki/Disable-invitations)
