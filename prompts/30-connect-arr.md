# 30 - Connect the Arr pipeline

## Script-first wiring

The four `setup-*.ts` commands in module 10 configure qBittorrent and the Arr
graph. On a resumed or failed service, rerun only `bun
scripts/setup-SERVICE.ts "$RUN_ID"` for `qbittorrent`, `sonarr`, `radarr`, or
`prowlarr`. Read that service's private `setup-fallback-SERVICE.json` if it
failed.
Run `session.sh verify "$RUN_ID"` to check the saved graph. No browser is
needed for a passing API path.

## Browser fallback

Only after a script fails, use the run's host URLs and fresh refs. Login with `$ADMIN_USERNAME` and
`browser-password`; fill API-key inputs with `browser-key fill`. Keep secrets
out of snapshots, screenshots and command arguments.

1. In Sonarr `/settings/mediamanagement`, add root folder `/data/media/tv`.
   In Radarr use `/data/media/movies`.
2. Open each app's `/settings/downloadclients`, add qBittorrent, and enter
   host `qbittorrent`, the run's `QBITTORRENT_PORT`, chosen username, and generated
   password. The chooser order is not an identity: confirm the opened dialog
   title includes `qBittorrent` before filling anything. Use
   category `tv-sonarr` or `movies-radarr`. Test, then save.
3. In Prowlarr `/settings/applications`, add Sonarr and Radarr with Full Sync.
   Do not trust chooser position: inspect the opened modal title and require
   exactly **Add Application - Sonarr** or **Add Application - Radarr** before
   entering any values; cancel any other draft.
   Use `http://prowlarr:9696` as Prowlarr server, and the target's Docker URL
   (`http://sonarr:8989` or `http://radarr:7878`). Fill its key privately, test,
   and save. If `browser-key refs` cannot find the Prowlarr dialog's unlabeled
   `apiKey` input, use `scripts/session.sh browser-key fill-prowlarr-app
   "$RUN_ID" sonarr` (or `radarr`) while the exact **Add Application - Sonarr**
   (or **Radarr**) dialog is open. The helper checks the run-scoped Prowlarr
   page, dialog title, and unique visible field before sending the key through
   browser stdin. Never copy the key into a browser or shell argument.
4. Add the user's selected authorized-content indexer in Prowlarr. Test before
   saving, then sync applications. If no content source is selected, record
   indexer sync as pending and ask for that choice; do not silently choose a
   provider merely because it responds.
5. Run `scripts/session.sh verify "$RUN_ID"`. Confirm both download clients,
   both Full Sync applications, and the downstream indexer lists in the UI.

Do not select an indexer for the user. If none was authorized, downstream
indexer sync stays pending even when every other connection passes.

## Stop gate

Every claimed graph edge passes its connection test. An unavailable indexer
leaves acquisition acceptance pending; the remaining private integrations can
still be configured and tested. Record the exact cause and any recovery.
