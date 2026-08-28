# Generation 1 - manual baseline

Two isolated Luna MAX candidates ran the original modular prompt while a
supervisor trace completed the same stack and verified Homarr end to end.

| Run | Meaningful actions | Last complete gate | Result |
| --- | ---: | --- | --- |
| `luna-g1-a` | 80 | Seerr Radarr | Disqualified: Sonarr not saved; Homarr unverified |
| `luna-g1-b` | 92 | Seerr Jellyfin libraries | Disqualified: Arr services and Homarr not run |
| `root-smoke` | diagnostic trace | Homarr generated board | Complete reference path |

The complete reference proved six Homarr connection tests, six persisted
integrations, six generated app tiles, and successful generated widget calls
for Seerr, Jellyfin, qBittorrent, Sonarr, Radarr, and Prowlarr.

## Shared survival failures

1. Rootless UID mapping made Seerr config and the shared `/data` tree
   unwritable until only those nested run directories were opened.
2. Pre-generated Arr environment keys were ignored. The actual config keys had
   to be captured after startup without printing them.
3. qBittorrent returned HTTP 204 and a port-suffixed `QBT_SID_<port>` cookie.
4. Internet Archive returned 429 and several indexers hit Cloudflare. A source
   must pass live and expose both Movies and TV categories; Nyaa.si did.
5. Jellyfin and Seerr sometimes acknowledged clicks without advancing. Focusing
   the current control and pressing Enter was reliable.
6. Seerr required its email field, plus standard and anime Sonarr profile/root
   selections, even for the baseline non-anime server.
7. Homarr correctly treated the absent Docker socket as non-blocking. Its manual
   Connect step tested all six services and generated the expected board.

## Promoted genome

- `scripts/session.sh` owns unique ports, project/network names, state roots,
  browser sessions, secret-safe key synchronization, and exact teardown.
- `scripts/session.sh bootstrap RUN_ID` replaces qBittorrent and Arr UI work
  with idempotent, live-tested configuration.
- `scripts/session.sh verify RUN_ID` independently checks the stored core graph.
- Browser work is reduced to Jellyfin, Seerr, and Homarr onboarding.
- Service-specific findings live in replaceable `docs/<service>.md` and
  `prompts/<stage>.md` modules.

This promoted path becomes Generation 2. Completion remains the first fitness
criterion; neither incomplete Generation 1 candidate is called a winner.
