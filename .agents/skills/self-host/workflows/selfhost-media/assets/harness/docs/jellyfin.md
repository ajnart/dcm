# Jellyfin TLDR

- Purpose: media server and Seerr identity/media source.
- Image: `ghcr.io/hotio/jellyfin:latest` (observed 10.11.11 on 2026-08-28).
- Internal URL: `http://jellyfin:8096`; host URL comes from `scripts/session.sh urls`.
- State: `/config`; libraries: `/data/media`.

## Default API-first setup

Run `scripts/session.sh bootstrap-jellyfin RUN_ID` in hybrid mode. The helper
checks the first-run state, calls `GET /Startup/User` to initialize the first
user before `POST /Startup/User`, and sets the chosen administrator only while the wizard
is incomplete, authenticates that account, adds missing Movies/Shows libraries,
verifies their types and paths, and logs out its temporary API session. It
refuses conflicting existing libraries instead of overwriting them. Passwords
and tokens stay in private process memory; output is fixed PASS/FAIL text.

Then sign in through agent-browser and verify both libraries. If the deployed
version no longer supports the startup API, report the exact failure and use
the wizard below; never retry by editing Jellyfin's database or config files.
The official stable OpenAPI marks some startup routes deprecated, so keep the
browser fallback and record the image version used for each measurement.

API schema: [Jellyfin OpenAPI](https://api.jellyfin.org/openapi/jellyfin-openapi-stable.json).

## Browser fallback and comparison path

1. Complete the first-run wizard with agent-browser and create the standard
   local admin username `$ADMIN_USERNAME`. Fill the password and confirmation refs with
   `scripts/session.sh browser-password "$RUN_ID" @eN @eN`.
   If Next is inert after credentials, focus password confirmation and press
   Enter; this was reproducible on 10.11.11.
2. Add TV library `/data/media/tv` and movie library `/data/media/movies` so
   Seerr has real libraries to discover; accept normal metadata/remote defaults.
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

- `localhost` inside Seerr points to Seerr, not Jellyfin.
- Do not skip libraries: Seerr service configuration and availability scans need
  usable library/root-folder choices.
- Finish the wizard and verify a post-login page; HTTP 200 alone is insufficient.

Sources: [Jellyfin container docs](https://jellyfin.org/docs/general/installation/container/),
[hotio image docs](https://hotio.dev/containers/jellyfin/).

Startup ordering source: [Jellyfin 10.11.11 StartupController](https://github.com/jellyfin/jellyfin/blob/v10.11.11/Jellyfin.Api/Controllers/StartupController.cs).
