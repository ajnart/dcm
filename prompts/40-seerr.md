# 40 - Configure Seerr

Read `docs/seerr.md`. Initialize Seerr through agent-browser:

1. Choose Jellyfin. The form prepends the scheme: enter host `jellyfin`, port
   `8096`, disposable email `admin@example.test`, and username `admin`. Fill the
   password only through `scripts/session.sh browser-password "$RUN_ID" @eN`
   using its fresh input ref.
2. Hydrated buttons can acknowledge a mouse click without firing. If the page
   does not advance, focus the button and press Enter; never keep stale refs.
3. Sync libraries, select both Movies and Shows, set the Jellyfin host URL as
   External URL, save, and start the first manual scan.
4. Add default non-4K Radarr (`radarr`, `7878`) and Sonarr (`sonarr`, `8989`)
   with their per-run API keys and host URLs as external URLs.
5. Enable scan and automatic search. Select Any plus the matching root folder.
   Sonarr requires both standard and anime profile/root-folder selections even
   in this non-anime baseline; enable season folders. Test before Add Server.
6. Finish setup and confirm the Discover page loads.

## Stop gate

The per-run key returns HTTP 200 from status and settings APIs. Jellyfin lists
Movies and Shows; Radarr and Sonarr each show the internal host, default=true,
profile, and matching root folder. Capture a redacted settings screenshot.
