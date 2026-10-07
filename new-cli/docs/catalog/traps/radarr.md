# Radarr traps

## Pitfalls

- Mismatched downloader and library paths break imports and hardlinks.

## Security

- Treat API keys as secrets and keep the management UI private.

## From docs/radarr.md

### Traps

- Override the default qBittorrent category; do not leave it as `radarr`.
- Never use host ports or `localhost` on the Compose network.
- Re-snapshot after every modal change and test before save.

Sources: [Servarr Radarr docs](https://wiki.servarr.com/radarr),
[hotio image docs](https://hotio.dev/containers/radarr/).
