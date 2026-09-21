# Headless and remote access

The media harness keeps every published port on `127.0.0.1` by default. Its
local browser URLs and Docker URLs describe different routes:

- Local browser: `http://127.0.0.1:<assigned-port>`
- Docker network: `http://<service>:<container-port>`
- User-reachable: present only after choosing a private route and naming the
  host that the user's client can reach

`0.0.0.0` is a listener address, never a link. When wildcard binding is
explicitly selected, advertise a real private hostname or address such as
`media.home.arpa` or `192.168.20.5`. Do not label `localhost` as remotely
reachable: it names the device opening the link.

## Private access choices

Keep loopback binding for a headless server reached over SSH. One SSH process
can forward every selected service. Replace each local-port placeholder and the
SSH destination:

```bash
ssh -N \
  -L <prowlarr-local-port>:127.0.0.1:<prowlarr-port> \
  -L <radarr-local-port>:127.0.0.1:<radarr-port> \
  -L <sonarr-local-port>:127.0.0.1:<sonarr-port> \
  -L <qbittorrent-local-port>:127.0.0.1:<qbittorrent-port> \
  -L <jellyfin-local-port>:127.0.0.1:<jellyfin-port> \
  -L <seerr-local-port>:127.0.0.1:<seerr-port> \
  -L <homarr-local-port>:127.0.0.1:<homarr-port> \
  <ssh-user>@<server>
```

Then open each service at its matching `http://localhost:<service-local-port>`.
Each selected local port must be unused and does not need to equal the server
port. `session.sh handoff RUN_ID` records the exact server ports in one command
template without claiming that the tunnel has been established.

For direct LAN access, select either a specific private host address or
`0.0.0.0` and separately record the private hostname/address clients use. A
specific-address setup must retain a loopback mapping for the harness browser.
A wildcard listener already accepts loopback traffic, but firewall scope still
determines which clients can connect. Directly expose only services the user
selected; keep Arr applications and qBittorrent private administration
surfaces off public networks.

The harness's bounded wildcard command exposes only Homarr:

```bash
scripts/session.sh create RUN_ID USERNAME \
  --homarr-bind 0.0.0.0 \
  --homarr-host media.home.arpa
```

This makes the dashboard reachable at its reported private host and port. It
does not expose the six linked service interfaces, so their Homarr app tiles
still need SSH forwards or explicit private proxy origins.

For friendly private HTTPS, use the private Caddy ingress plan. Keep the
service backend on loopback, map each approved service to its proxy origin, and
report that origin as its user-reachable URL. The intended clients must resolve
the private name and trust Caddy's local CA. TLS alone does not add user
authentication.

Record an approved private proxy origin per service after its Caddy route has
been planned and applied:

```bash
scripts/session.sh access-proxy set RUN_ID homarr https://homarr.home.arpa \
  --private-dns-confirmed
scripts/session.sh access-proxy set RUN_ID jellyfin http://192.168.20.5:8096
scripts/session.sh access-proxy clear RUN_ID jellyfin
```

RFC1918 and private ULA origins are accepted directly. A hostname requires the
explicit `--private-dns-confirmed` fact. Origins cannot contain credentials,
paths, queries, or fragments. The command only stores a secret-free URL map; it
does not configure Caddy, DNS, TLS, authentication, or a firewall. Run
`homarr-finalize`, `connections`, and `handoff` again after changing the map so
the app links and artifacts use it.

## URL reporting rules

Always return Homarr's local browser URL. Add a user-reachable Homarr URL only
when one of these is explicit:

- an advertised private host paired with a non-loopback listener;
- an approved private reverse-proxy origin;
- an SSH tunnel that the user has established.

An advertised host is a configuration assertion, not proof of reachability.
Verification still needs a request from an intended client. Never emit
`http://0.0.0.0:<port>` or claim that a private Caddy plan has been applied.

The pure resolver in `scripts/lib/session-access.ts` validates these classes
without reading a session or network state. Future session integration should
store only secret-free access settings, render Compose bindings from its
`composeBindings`, keep browser automation on `browserUrl`, use `dockerUrl` for
container integrations, and use `reachableUrl` in the final recap and Homarr
app links.
