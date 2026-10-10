# Sonarr traps

## Pitfalls

- Mismatched downloader and library paths break imports and hardlinks.

## Security

- Treat API keys as secrets and keep the management UI private.

## From docs/sonarr.md

### Traps

- Never use `localhost` for container-to-container links.
- Browser refs are ephemeral. Snapshot after opening every modal/dropdown.
- The download-client chooser can be unlabeled or reorder tiles. Confirm the
  opened dialog title includes `qBittorrent`; a wrong tile can produce a
  misleading connection-test failure.
- A saved form is not proof; run its connection test and inspect the list view.

Sources: [Servarr Sonarr docs](https://wiki.servarr.com/sonarr),
[hotio image docs](https://hotio.dev/containers/sonarr/).
