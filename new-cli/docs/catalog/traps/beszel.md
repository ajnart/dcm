# Beszel traps

## Pitfalls

- The pinned first-run HTTP route creates separate Hub admin and PocketBase superuser accounts. Shared setup uses fixed admin@example.test; change that identity through a separately reviewed workflow, not an unbound runtime input.
- Beszel's universal token is an agent enrollment credential, not a general REST API key. Setup reads or creates the Admin login's permanent universal token only to enroll this machine's agent, and stores it with the Hub's public key in `secrets.env` as `BESZEL_AGENT_TOKEN` and `BESZEL_AGENT_KEY`.
- `GET /api/beszel/universal-token?enable=1&permanent=1` replaces the user's existing permanent token. Setup first reads the current state (the same route without parameters) and keeps an existing permanent token, so it never disconnects other agents enrolled with it. The route refuses superusers: it needs the Admin login, a regular Hub user.
- The Hub's public key comes from `GET /api/beszel/info` (`getkey` is its deprecated alias). Both routes need a signed-in user; PocketBase takes the session token as the whole `Authorization` header.
- The agent runs the Hub's version (`henrygd/beszel-agent:0.20.0`) and connects over WebSocket (`HUB_URL`, `TOKEN`, `KEY`). It needs host networking to read the host's interfaces, so it listens on `127.0.0.1:45876`, reaches the Hub on `127.0.0.1` and publishes nothing.
- The agent's first start precedes Setup, so its key and token are still blank: the agent exits and restarts until Setup stores them. Setup then recreates it with `docker compose up -d` (a plain restart does not reread the secrets). A system stays listed in the Hub when its agent stops, so the `agent` step waits for status `up`, not only for the listing.
- This machine appears in the Hub as `This machine` (`SYSTEM_NAME`), so Setup and later Links can find it without guessing the hostname.
- Under Docker Desktop the "host" is the VM, so loopback publishing and host networking monitor the VM, not the laptop.

## Security

- Treat Docker socket or host-agent access as explicit privilege.
- **Named exception: `beszel-socket-proxy` is the only service that mounts the Docker socket**, as `/var/run/docker.sock:/var/run/docker.sock:ro`. It runs LinuxServer's socket proxy with `CONTAINERS=1` and `POST=0`, so only reads of container details and stats pass; logs, exec, images, volumes, networks and every write stay denied (a read-only bind mount alone would not stop API writes). The agent reads Docker through `DOCKER_HOST=tcp://127.0.0.1:45877` and mounts nothing.
- The exception is enforced in three places and nowhere else: `tools/appgen` (`socketProxyException`), `e2e/isolation.go` (`validateComposeIsolation`) and the fragment test. Each rejects the same mount on any other service, a writable mount, or another socket path. The e2e check also allows `network_mode: host` for `beszel-agent` only.
- The proxy is published on `127.0.0.1:45877` whatever the Exposure, never on `${BIND_IP}`. It has to be published: the host-network agent cannot resolve Compose service names or reach the Project network, and the proxy offers no Unix socket. Loopback keeps it unreachable from other machines, though any local process can still read container metadata through it, as it could through the Docker CLI on a group-accessible socket.
- The proxy and the agent are fixed on host ports 45877 and 45876. A second Project on the same machine, or another program on those ports, needs one of them changed.
