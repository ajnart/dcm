# Prowlarr TLDR

- Purpose: central indexer manager; full-syncs indexers to Sonarr and Radarr.
- Image: `ghcr.io/hotio/prowlarr:latest` (observed 2.5.2.5491 on 2026-08-28).
- Internal URL: `http://prowlarr:9696`; host URL comes from `scripts/session.sh urls`.
- State: `/config`.
- Secret: fresh `PROWLARR_API_KEY`, captured into the run secret store by
  `scripts/session.sh keys`; never reveal it.

## Minimum fresh-run path

1. Run `scripts/session.sh bootstrap RUN_ID`; it configures Forms auth, probes a
   bounded public-indexer list, and keeps only an entry whose live test passes.
2. It adds Sonarr at `http://sonarr:8989` and Radarr at
   `http://radarr:7878`, using per-run keys and **Full Sync**.
3. It triggers the supported `ApplicationIndexerSync` task through the command
   API and waits until both downstream apps contain the indexer.
4. Confirm the indexer and both apps in agent-browser, then run
   `scripts/session.sh verify RUN_ID`.

## Proof

- `/ping` responds on the host URL.
- The chosen indexer is enabled and its test succeeds.
- Both application tests succeed and the application list contains Sonarr and
  Radarr with full sync.
- The synced indexer appears in both downstream apps.
- Homarr's Prowlarr integration test succeeds.

## Traps

- An entry that merely saved is not a working indexer.
- Internet Archive returned 429 and several sources hit Cloudflare in the first
  generation; Nyaa.si passed on 2026-08-28. Always retain live probing rather
  than treating that observation as a permanent provider choice.
- 1337x is commonly Cloudflare-protected and requires a working FlareSolverr
  proxy; use a test-passing source unless FlareSolverr is part of the run.
- Use Docker DNS and internal ports for all application links.

Sources: [Servarr Prowlarr docs](https://wiki.servarr.com/prowlarr),
[hotio image docs](https://hotio.dev/containers/prowlarr/).
