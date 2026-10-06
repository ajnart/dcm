# Prowlarr traps

## Pitfalls

- Indexer availability and acceptable use are external constraints.

## Security

- Protect indexer credentials and API keys as secrets.

## From docs/prowlarr.md

### Traps

- An entry that merely saved is not a working indexer.
- Bootstrap never chooses a provider based on availability. Without an explicit
  authorized source, indexer sync and acquisition acceptance remain pending.
- Use Docker DNS and internal ports for all application links.

Sources: [Servarr Prowlarr docs](https://wiki.servarr.com/prowlarr),
[hotio image docs](https://hotio.dev/containers/prowlarr/).
