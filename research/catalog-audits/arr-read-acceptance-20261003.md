# Sonarr/Radarr staged selected-library restart observers

Checked 2026-10-03. Source and synthetic fixtures only; **zero live points**.
No Docker, real service, credential store, browser, CI, media acquisition or
runtime mutation was used. Existing XML-key onboarding is unchanged.
Both observers are staged without active `acceptance-contract.json` mappings.
The dispatcher remains unavailable for both apps: no full-product acceptance
mapping, generic core-round-trip credit or live/restart score is granted.

## Primary contract

The existing [media audit](media-existing.md) pins Sonarr 4.0.19.2979 and Radarr
6.4.4.10685. Fresh read-only inspection of their matching official source
confirmed the following routes and resource fields:

| App | Selected existing resource | Imported-file records |
| --- | --- | --- |
| Sonarr | `GET /api/v3/series/{id}`: local ID, TVDB ID, quality-profile ID, monitored | `GET /api/v3/episodefile?seriesId={id}`: ID, series ID, season number, size |
| Radarr | `GET /api/v3/movie/{id}`: local ID, TMDB ID, quality-profile ID, monitored, movie-file ID | `GET /api/v3/moviefile?movieId={id}`: ID, movie ID, size |

Sources: Sonarr [series controller](https://github.com/Sonarr/Sonarr/blob/v4.0.19.2979/src/Sonarr.Api.V3/Series/SeriesController.cs),
[series resource](https://github.com/Sonarr/Sonarr/blob/v4.0.19.2979/src/Sonarr.Api.V3/Series/SeriesResource.cs),
[episode-file controller](https://github.com/Sonarr/Sonarr/blob/v4.0.19.2979/src/Sonarr.Api.V3/EpisodeFiles/EpisodeFileController.cs),
[episode-file resource](https://github.com/Sonarr/Sonarr/blob/v4.0.19.2979/src/Sonarr.Api.V3/EpisodeFiles/EpisodeFileResource.cs);
Radarr [movie controller](https://github.com/Radarr/Radarr/blob/v6.4.4.10685/src/Radarr.Api.V3/Movies/MovieController.cs),
[movie resource](https://github.com/Radarr/Radarr/blob/v6.4.4.10685/src/Radarr.Api.V3/Movies/MovieResource.cs),
[movie-file controller](https://github.com/Radarr/Radarr/blob/v6.4.4.10685/src/Radarr.Api.V3/MovieFiles/MovieFileController.cs),
[movie-file resource](https://github.com/Radarr/Radarr/blob/v6.4.4.10685/src/Radarr.Api.V3/MovieFiles/MovieFileResource.cs).

The adapter reads the existing exact-owner private API key saved by setup from
owned `config.xml`; it does not fetch XML again, guess onboarding, log in,
rotate credentials or create keys. An authenticated host-config GET must still
identify the configured `admin` Forms policy with authentication enabled.
This proves observed owner policy, not a separate password-login test.

## Deliberately narrow workload

Review a positive integer `series-id` or `movie-id`. The selected resource must
match exactly. Sonarr needs 1–10,000 unique file records belonging to that
series, each with a positive size and valid season number. Radarr needs exactly
one positive-size file record matching both selected movie ownership and the
movie's file ID. Empty libraries, metadata-only selected resources, foreign
file records and duplicate IDs fail instead of gaining a baseline.

Only stable whitelisted IDs, quality-profile/monitored configuration and file
ID/size/season metadata enter the digest. File order is canonicalized. Raw
titles, paths, usernames, keys and arbitrary upstream fields never enter
checkpoint or result. The observer makes GET requests only.

The common read-only lifecycle factory binds immutable reviewed inputs,
completed exact shared ownership, recipe/images/manifest and trusted start
chronology. After its recorded stop and distinct restart, the exact same
sanitized library baseline must remain. A second begin cannot replace a
changed baseline; resumed finish cannot change restart chronology.

This is a populated **library/file-record read and persistence** candidate,
not file-byte availability, import execution, downloader/indexer connectivity,
search, media requests, playback, external-client or Homarr acceptance.
Those broader result flags explicitly remain false. No upstream write means
no workload cleanup is required.
The initially added generic core-round-trip mappings were removed after review:
imported-file metadata does not prove the apps' import/acquisition workload or
media-byte access. Keep this narrower observer directly testable without
promoting it to full-product acceptance.

## Focused validation

- `packages/cli/tests/arr-read-acceptance.test.ts` passed with Bun 1.4.0.
- Both app acceptance adapters built with `--target=bun --outfile=/dev/null`.
- Fixtures reject invalid selections, empty/duplicate/foreign files, incorrect
  selected resources, foreign saved-key paths, altered owner policy, denied
  reads, zero-byte records, workload/profile drift and invalid restart lineage.
  They prove GET-only behavior, no baseline on failed reads, immutable begin,
  restart replay and exclusion of raw titles/paths/key fields from evidence.
  They also assert contract loading returns null and dispatcher availability
  remains false for both staged observers.

These synthetic checks do not prove actual image/API compatibility or an
observed live restart. No app receives a live receipt from source tests.
