# 20 - Bootstrap service identities

Read `docs/qbittorrent.md`, `docs/jellyfin.md`, `docs/sonarr.md`,
`docs/radarr.md`, and `docs/prowlarr.md`.

The core bootstrap prepared qBittorrent and Arr. In default hybrid mode run
`scripts/session.sh bootstrap-jellyfin "$RUN_ID"`, then use the run-scoped
browser to sign in and prove both libraries on the home page. Skip completed
wizard forms. Keep API setup time in the benchmark.

For browser mode or an unsupported startup API, use the wizard:

1. Create the local admin username `$ADMIN_USERNAME` in the first-run wizard. After a
   fresh snapshot, fill its password and confirmation refs together with
   `scripts/session.sh browser-password "$RUN_ID" @eN @eN`.
2. If the credentials-page **Next** click is inert, focus password confirmation
   and press Enter. Use the helper again with a fresh ref for any later login.
3. Add a Shows library at `/data/media/tv` and a Movies library at
   `/data/media/movies`.
4. Accept the language and remote-access defaults, finish, sign in, and verify
   both libraries on the home page.
5. Continue to the Arr wiring module. Run the core verifier after wiring;
   identity preparation alone cannot pass the graph checks.

Prefer semantic locators over remembered refs. Record only meaningful actions,
not snapshots or waits, in the fitness count.

## Stop gate

Jellyfin accepts the per-run login and shows both libraries. The Arr graph remains pending until the next module.
