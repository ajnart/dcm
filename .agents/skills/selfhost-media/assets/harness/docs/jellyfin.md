# Jellyfin TLDR

- Purpose: media server and Seerr identity/media source.
- Image: `ghcr.io/hotio/jellyfin:latest` (observed 10.11.11 on 2026-08-28).
- Internal URL: `http://jellyfin:8096`; host URL comes from `scripts/session.sh urls`.
- State: `/config`; libraries: `/data/media`.

## Minimum fresh-run path

1. Complete the first-run wizard with agent-browser and create the standard
   local admin username `admin`. Fill the password and confirmation refs with
   `scripts/session.sh browser-password "$RUN_ID" @eN @eN`.
   If Next is inert after credentials, focus password confirmation and press
   Enter; this was reproducible on 10.11.11.
2. Add TV library `/data/media/tv` and movie library `/data/media/movies` so
   Seerr has real libraries to discover; accept normal metadata/remote defaults.
3. Sign in once and confirm the dashboard loads. Use the helper with the fresh
   password ref; never pass the password to agent-browser as an argument.
4. In Seerr, select Jellyfin and use `http://jellyfin:8096` as the internal URL,
   the host URL as the external URL, and the Jellyfin admin account for setup.

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
