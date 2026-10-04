# Plex bootstrap boundary

The owner supplies a real Plex claim token from [Plex claim](https://www.plex.tv/claim).
There is no generated local username or password. Import that token using the
shared owner's private-file input immediately before approved apply; never put
it in Compose data, argv, preferences, or reports.

The [vendor bootstrap](https://github.com/plexinc/pms-docker/blob/master/root/etc/cont-init.d/40-plex-first-run)
supports `PLEX_CLAIM_FILE`, exchanges a claim only when `PlexOnlineToken` is
absent, and writes the returned token into its private `Preferences.xml`.
The [vendor Dockerfile](https://github.com/plexinc/pms-docker/blob/master/Dockerfile)
installs `xmlstarlet`; setup uses a fixed read-only selector to extract only
`PlexOnlineToken` and `ProcessedMachineIdentifier` from the exact owned server.
The private key is saved before authenticated HTTP requests.

On 2026-09-30, read-only registry inspection verified image tag
`1.43.4.10903-e5521bd8c`, index digest
`sha256:e0ab27395614a8e1a4fdf84c6bc60ac664915cfdde70c52d030c7728a1c48e14`.
The amd64, arm64, and arm/v7 bootstrap layers were individually SHA-256 checked;
all contained the same first-run script, SHA-256
`acfa3948cceba9d858e85c498298aeb3e6b5d44296b0c45d265fc9f936cfe63a`,
including the `PLEX_CLAIM_FILE` read. This verifies shipped bootstrap source,
not a live first-run claim or application acceptance. Apply still uses its
reviewed digest selection rather than assuming the mutable tag cannot change.

The [official PMS API](https://developer.plex.tv/pms/) documents `/identity`
and authenticated `/library/sections`. Setup matches the saved server identity,
requires anonymous library access to be denied, and verifies a saved-token
library read. The `local-token-verified` checkpoint proves bootstrap and token
capture only; account ownership deliberately remains unverified:
`claimed=true` and local token access do not prove the intended Plex account.
The owner must verify that exact server in their account. Media mapping,
authorized playback, discovery/remote-access ports, and scoped restart
persistence remain separate checks. No Docker or live account claim was run.

Do not set `ALLOWED_NETWORKS` or enable `DEBUG`. The former bypasses local
authentication; upstream debug shell tracing may expose token values. Only
private TCP 32400 is published by this recipe; remote access and discovery
need separate review. The loopback `ADVERTISE_IP` is not a remote-access claim.

The bootstrap creates `/.firstRunComplete` even after an unsuccessful token
exchange. Ordinary restarts therefore do not retry an expired claim. Stop at
inspection and explicitly review recovery; never delete configuration, reclaim
an existing server, or substitute another account token automatically.
