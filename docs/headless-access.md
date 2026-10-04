# Headless and remote access

The media harness defaults to publishing all seven assigned ports on every host
interface. Its explicit `session create RUN_ID USERNAME --bind-mode host-only`
mode publishes those ports only on 127.0.0.1 for a host-local private proxy.
Its local browser URLs and Docker URLs describe different routes:

- Local browser: `http://127.0.0.1:<assigned-port>`
- Docker network: `http://<service>:<container-port>`
- User-reachable: reported only after naming a host or private proxy origin
  that the user's client can reach; this is not a connectivity test

`0.0.0.0` is a listener address, never a link. For the default mode, set router
or Docker-aware firewall rules before starting the run: publishing a port can bypass ordinary
host firewall assumptions. Advertise a real private hostname or address such as
`media.home.arpa` or `192.168.20.5` only after checking client access.
`localhost` names the device opening the link.

## Private access choices

An SSH tunnel can give a client a convenient local URL. In the default mode,
it does not close the published host ports. Replace each local-port placeholder and the SSH
destination:

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

For direct LAN access, record the private hostname/address clients use and
verify it from an intended device. Limit Arr applications and qBittorrent to
trusted clients with a host/network firewall. The optional host declaration
reports a Homarr link without changing its port binding:

```bash
scripts/session.sh create RUN_ID USERNAME \
  --homarr-host media.home.arpa
```

This records a private dashboard URL; the default run's seven ports were
already published. It does not verify that the URL works from another device.

For friendly private HTTPS, use the private Caddy ingress plan. Keep the
service backend on its Docker network, map each approved service to its proxy origin, and
report that origin as its user-reachable URL. The intended clients must resolve
the private name and trust Caddy's local CA. TLS alone does not add user
authentication or close default all-interface backend ports. Select host-only
mode before deployment when Caddy should be the sole route from this host.

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

- an advertised private host paired with verified intended-client access;
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
