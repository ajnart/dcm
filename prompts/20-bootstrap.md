# 20 - Bootstrap service identities

Read `docs/qbittorrent.md`, `docs/jellyfin.md`, `docs/sonarr.md`,
`docs/radarr.md`, and `docs/prowlarr.md`.

The core bootstrap already configured qBittorrent and all three Arr services.
Do not repeat those forms. Use the run-scoped browser session for Jellyfin only:

1. Create the standard local admin in the first-run wizard.
2. If the credentials-page **Next** click is inert, focus password confirmation
   and press Enter.
3. Add a Shows library at `/data/media/tv` and a Movies library at
   `/data/media/movies`.
4. Accept the language and remote-access defaults, finish, sign in, and verify
   both libraries on the home page.
5. Run `scripts/session.sh verify "$RUN_ID"` to independently prove the core
   configuration before opening Seerr.

Prefer semantic locators over remembered refs. Record only meaningful actions,
not snapshots or waits, in the fitness count.

## Stop gate

Jellyfin accepts the standard login and shows both libraries. Every core
verification line is PASS.
