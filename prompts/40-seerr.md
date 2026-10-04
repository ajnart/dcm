# 40 - Configure Seerr

Read `docs/seerr.md`. Initialize Seerr through its API:

Before apply, ask whether future approved media requests may trigger automatic
Sonarr/Radarr searches. The current `setup-seerr.ts` path enables that future
behavior; run it only when the exact plan includes this choice. If the user
declines or a safety review rejects it, configure the UI with search off and
record Seerr's actionable-request verifier as pending. Never retry a rejected
save through another tool.

1. Run `bun scripts/setup-seerr.ts "$RUN_ID"`. It keeps the Jellyfin
   password and service API keys inside the private process. On failure it
   prints the failed stage and path to a secrets-full private takeover artifact.
2. The helper enables Movies and Shows and derives the exact `Any` profile and
   matching root IDs from Seerr's live Radarr/Sonarr test APIs. It enables
   read-only existing-media status sync and, when approved, automatic search
   **for future approved requests** on both saved servers;
   this does not issue a search or download during setup. Stop on any
   conflict; do not replace or add a second server.
3. Check Seerr's status and saved service settings with the verifier. Open the
   browser only if the script fails or visual proof was requested. Do not
   create a media request or trigger a download.

For a browser-only comparison, Seerr's Jellyfin sign-in also requires an
**Email Address** before Sign In enables. The managed API path uses the
non-deliverable benchmark default `admin@example.test`; use the same value in
an isolated browser run unless the user supplied an address. Seerr says this
email is not tied to Jellyfin and is used for notifications, password resets,
and local sign-in. Explain that the placeholder cannot receive mail; ask for a
real address if those features matter. Do not interpret a disabled Sign In
button as a Jellyfin network failure before checking this required field.

On browser-only Radarr/Sonarr forms, Seerr labels the key textbox with both
`API Key*` and a help sentence. `browser-key refs "$RUN_ID" radarr` (or
`sonarr`) accepts that exact service-specific label only on Seerr `/setup` or
`/settings/services`; `browser-key fill "$RUN_ID" SERVICE @eN` rechecks the
fresh form and sends the managed key privately. Require exactly one matching
field, test the service, then save. Do not type the key or relax the matcher
for an unknown label.
In the browser forms, keep `Enable Automatic Search` on for both servers so
the saved state matches the verifier **only when approved**. If approval is
absent or rejected, save with search off and report the exact verifier gap.
Do not create a request or run a search during setup; an indexer still
requires the user's explicit source choice.
`Enable Scan` is different: Seerr uses it to read existing Arr media/request
status and avoid duplicate requests. Leave it on for the managed recipe if a
normal save is permitted, but do not start a manual scan during setup.
On the Sonarr browser form, set both the standard and anime `Any` profile and
both root-folder selectors to `/data/media/tv`. The grouped verifier checks
both, even when no anime media is present.

## Stop gate

The per-run key returns HTTP 200 from status and settings APIs. Jellyfin lists
Movies and Shows; Radarr and Sonarr each show the internal host, default=true,
profile, and matching root folder. Capture a redacted settings screenshot.
