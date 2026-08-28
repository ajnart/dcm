# Sonarr TLDR

- Purpose: TV library manager; sends downloads to qBittorrent and receives
  indexers from Prowlarr.
- Image: `ghcr.io/hotio/sonarr:latest` (observed 4.0.19.2979 on 2026-08-28).
- Internal URL: `http://sonarr:8989`; host URL comes from `scripts/session.sh urls`.
- State: `/config`; shared media/download tree: `/data`.
- Secret: fresh `SONARR_API_KEY`, captured into the run secret store by
  `scripts/session.sh keys`; never reveal it.

## Minimum fresh-run path

1. Run `scripts/session.sh bootstrap RUN_ID`; it configures Forms auth, root
   folder `/data/media/tv`, and a tested qBittorrent client at the run's dynamic
   internal port with category `tv-sonarr`.
2. It creates/tests the Prowlarr Full Sync application at
   `http://sonarr:8989` and waits for its indexer.
3. Confirm the list state in agent-browser and run the verifier.
4. Seerr must add Sonarr as its default non-4K TV server, select a quality
   profile and `/data/media/tv`, and enable scanning.

## Proof

- `/ping` responds on the host URL.
- The qBittorrent client is enabled and its test succeeds.
- At least one Prowlarr-managed indexer appears after app sync.
- Seerr shows one default Sonarr server and Homarr's Sonarr integration test
  succeeds.

## Traps

- Never use `localhost` for container-to-container links.
- Browser refs are ephemeral. Snapshot after opening every modal/dropdown.
- A saved form is not proof; run its connection test and inspect the list view.

Sources: [Servarr Sonarr docs](https://wiki.servarr.com/sonarr),
[hotio image docs](https://hotio.dev/containers/sonarr/).
