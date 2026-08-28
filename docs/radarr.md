# Radarr TLDR

- Purpose: movie library manager; sends downloads to qBittorrent and receives
  indexers from Prowlarr.
- Image: `ghcr.io/hotio/radarr:latest` (observed 6.3.0.10514 on 2026-08-28).
- Internal URL: `http://radarr:7878`; host URL comes from `scripts/session.sh urls`.
- State: `/config`; shared media/download tree: `/data`.
- Secret: fresh `RADARR_API_KEY`, captured into the run secret store by
  `scripts/session.sh keys`; never reveal it.

## Minimum fresh-run path

1. Run `scripts/session.sh bootstrap RUN_ID`; it configures Forms auth, root
   folder `/data/media/movies`, and a tested qBittorrent client at the run's
   dynamic internal port with category `movies-radarr`.
2. It creates/tests the Prowlarr Full Sync application at
   `http://radarr:7878` and waits for its indexer.
3. Confirm the list state in agent-browser and run the verifier. If login is
   required, use username `admin` and fill its fresh password ref through
   `scripts/session.sh browser-password "$RUN_ID" @eN`.
4. Seerr must add Radarr as its default non-4K movie server, select a quality
   profile and `/data/media/movies`, and enable scanning.

## Proof

- `/ping` responds on the host URL.
- The qBittorrent client is enabled and its test succeeds.
- At least one Prowlarr-managed indexer appears after app sync.
- Seerr shows one default Radarr server and Homarr's Radarr integration test
  succeeds.

## Traps

- Override the default qBittorrent category; do not leave it as `radarr`.
- Never use host ports or `localhost` on the Compose network.
- Re-snapshot after every modal change and test before save.

Sources: [Servarr Radarr docs](https://wiki.servarr.com/radarr),
[hotio image docs](https://hotio.dev/containers/radarr/).
