# Jellyfin TLDR

- Purpose: media server and Seerr identity/media source.
- Image: `ghcr.io/hotio/jellyfin:latest` (observed 10.11.11 on 2026-08-28).
- Internal URL: `http://jellyfin:8096`; host URL comes from `scripts/session.sh urls`.
- State: `/config`; libraries: `/data/media`.

## Default API-first setup

From the installed project's `.selfhost/media-harness` directory, run
`bun scripts/setup-jellyfin.ts "$RUN_ID"`. This current per-service path uses
the private curl transport. It checks the first-run state, calls
`GET /Startup/User` to initialize the first user before `POST /Startup/User`,
and sets the chosen administrator only while the wizard is incomplete. Fresh
setup calls `/Startup/RemoteAccess` with `EnableRemoteAccess: false` by
default. A browser-only run signed Seerr in over the Compose network with this
setting off after Seerr's required email field was filled; do not enable it
just to resolve a disabled Sign In button. The managed Compose recipe publishes
its host port on every interface; this Jellyfin setting does not restrict that
binding. It then
authenticates that account, adds missing Movies/Shows libraries, verifies their
types and paths, and logs out its temporary API session. It refuses conflicting
existing libraries instead of overwriting them. Passwords and tokens stay in
private process memory; output is fixed PASS/FAIL text. Curl is a required
prerequisite; the setup script reports a fixed error and stops rather than
switching to direct Fetch.

`scripts/session.sh bootstrap-jellyfin RUN_ID` remains a legacy direct-Fetch
compatibility path to `scripts/bootstrap-jellyfin.ts`; it is not the current
per-service curl-first command.

If the deployed version no longer supports the startup API, report the exact
failure and use the wizard below; never retry by editing Jellyfin's database or
config files. Use agent-browser for a failed service path or requested visual
proof; the script itself verifies the authenticated account and both
libraries. Record the image version used for each measurement.

API schema: [Jellyfin OpenAPI](https://api.jellyfin.org/openapi/jellyfin-openapi-stable.json).

## Browser fallback and comparison path

1. Complete the first-run wizard with agent-browser and create the standard
   local admin username `$ADMIN_USERNAME`. Fill the password and confirmation refs with
   `scripts/session.sh browser-password "$RUN_ID" @eN @eN`.
   If Next is inert after credentials, focus password confirmation and press
   Enter; this was reproducible on 10.11.11.
2. Add TV library `/data/media/tv` and movie library `/data/media/movies` so
   Seerr has real libraries to discover. Leave Jellyfin remote access off unless
   the user separately approved enabling it. A missing Seerr setup email, not
   this setting, can leave Seerr's Sign In button disabled.
3. Sign in once and confirm the dashboard loads. Use the helper with the fresh
   password ref; never pass the password to agent-browser as an argument.
4. In Seerr, select Jellyfin and use `http://jellyfin:8096` as the internal URL,
   the host URL as the external URL, and the Jellyfin admin account for setup.

## Live browser notes (2026-09-21)

The isolated run completed account creation, both libraries, and a fresh login
with the chosen username. The credentials-page Next action worked in this run;
keep the Enter fallback only for an observed inert click.

- Select Movies or Shows using `select` with a fresh combobox ref. In
  agent-browser 0.34.0, `find label ... select` is unsupported.
- After saving a folder, wait for the folder dialog to close before clicking
  the library dialog's OK. Both dialogs use the same button label.
- Filter out long language/country option lists when inspecting these non-secret
  library pages; this reduces output without changing browser actions.
- Verify the authenticated home has both Movies and Shows links. Saving the
  wizard alone is not login proof.

## Proof

- `/health` reports healthy on the host URL.
- Both TV and movie libraries appear in Jellyfin and Seerr can sync them.
- Seerr is initialized with Jellyfin and can sign in through that account.
- Homarr's Jellyfin integration test succeeds and its media widget loads.

## Traps

- If public readiness reports `NO_RESPONSE` while Compose says `Up`, check the
  run's Jellyfin supervisor and a redacted error classification before browser
  fallback. In a parallel-run test, `service-jellyfin` repeatedly stopped with
  `System.IO.IOException` because the host's per-user inotify instance limit
  was exhausted. Check `fs.inotify.max_user_instances`; first stop only
  completed, task-owned Compose runs to free capacity, then retry once the
  supervisor is up and the public endpoint responds. A host-wide sysctl change
  needs separate approval. Container `Up` alone is not Jellyfin readiness.
- `localhost` inside Seerr points to Seerr, not Jellyfin.
- Do not skip libraries: Seerr service configuration and availability scans need
  usable library/root-folder choices.
- Finish the wizard and verify a post-login page; HTTP 200 alone is insufficient.

Sources: [Jellyfin container docs](https://jellyfin.org/docs/general/installation/container/),
[hotio image docs](https://hotio.dev/containers/jellyfin/),
[Linux inotify limits](https://www.kernel.org/pub/linux/docs/man-pages/book/man-pages-6.13.pdf).

Startup ordering source: [Jellyfin 10.11.11 StartupController](https://github.com/jellyfin/jellyfin/blob/v10.11.11/Jellyfin.Api/Controllers/StartupController.cs).
