# Prowlarr TLDR

- Purpose: central indexer manager; full-syncs indexers to Sonarr and Radarr.
- Image: `ghcr.io/hotio/prowlarr:latest` (observed 2.5.2.5491 on 2026-08-28).
- Internal URL: `http://prowlarr:9696`; host URL comes from `scripts/session.sh urls`.
- State: `/config`.
- Secret: fresh `PROWLARR_API_KEY`, captured into the run secret store by
  `scripts/session.sh keys`; never reveal it.

## Minimum fresh-run path

1. Run `scripts/session.sh bootstrap RUN_ID`; it configures Forms auth without
   creating, replacing, or choosing an indexer.
2. It adds Sonarr at `http://sonarr:8989` and Radarr at
   `http://radarr:7878`, using per-run keys and **Full Sync**.
3. Add the user's selected authorized-content indexer in the UI and test it,
   then sync applications. Existing indexer records remain untouched.
4. Confirm the selected indexer and both apps in agent-browser, then run
   `scripts/session.sh verify RUN_ID`. If login is required, use username
   `$ADMIN_USERNAME` and fill its fresh password ref through
   `scripts/session.sh browser-password "$RUN_ID" @eN`.

## Proof

- `/ping` responds on the host URL.
- The chosen indexer is enabled and its test succeeds.
- Both application tests succeed and the application list contains Sonarr and
  Radarr with full sync.
- The synced indexer appears in both downstream apps.
- Homarr's Prowlarr integration test succeeds.

## Traps

- An entry that merely saved is not a working indexer.
- Bootstrap never chooses a provider based on availability. Without an explicit
  authorized source, indexer sync and acquisition acceptance remain pending.
- Use Docker DNS and internal ports for all application links.

Sources: [Servarr Prowlarr docs](https://wiki.servarr.com/prowlarr),
[hotio image docs](https://hotio.dev/containers/prowlarr/).
