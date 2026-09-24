# 40 - Configure Seerr

Read `docs/seerr.md`. Initialize Seerr through its API:

1. Run `bun scripts/setup-seerr.ts "$RUN_ID"`. It keeps the Jellyfin
   password and service API keys inside the private process and prints only a
   fixed pass/fail diagnostic.
2. The helper enables Movies and Shows and derives the exact `Any` profile and
   matching root IDs from Seerr's live Radarr/Sonarr test APIs. Stop on any
   conflict; do not replace or add a second server.
3. Check Seerr's status and saved service settings with the verifier. Open the
   browser only if the script fails or visual proof was requested. Do not
   create a media request or trigger a download.

## Stop gate

The per-run key returns HTTP 200 from status and settings APIs. Jellyfin lists
Movies and Shows; Radarr and Sonarr each show the internal host, default=true,
profile, and matching root folder. Capture a redacted settings screenshot.
