# Unbound shared-catalog review — 2026-09-29

## Decision

Add an inspect-only v2 Compose candidate using the existing community `madnuttah/unbound:1.26.0-0` catalog pin. Keep automation at discovery. The recipe binds TCP 5335 and required UDP 5335 to loopback by default, uses the image's built-in configuration, and invokes its documented healthcheck. A no-account setup adapter runs fixed UDP and TCP `drill` queries from inside the exact owned container. This proves only local resolver responses; it does **not** establish host or peer reachability or authorize LAN/public DNS publication.

## Primary-source findings

- The [image maintainer's instructions](https://github.com/madnuttah/unbound-docker/blob/main/doc/README.md) identify TCP and UDP 5335, an image-default unprivileged runtime, `TZ`, and `/usr/local/unbound/sbin/healthcheck.sh` with a 60-second interval, 15-second timeout, five-second start period, and three retries. The default healthcheck checks an open port; its extended query mode is opt-in.
- The same instructions list `drill` as an available in-image command and describe an opt-in extended healthcheck that queries `nlnetlabs.nl`. [NLnet Labs' drill usage](https://lists.nlnetlabs.nl/pipermail/unbound-users/2021-July/007476.html) documents `-p` for the port, UDP by default, and `-t` for TCP. The [image registry](https://hub.docker.com/r/madnuttah/unbound/tags) lists the pinned `1.26.0-0` tag. The adapter uses fixed argv, a fixed query, and the exact saved Compose service; the image was not pulled here to verify its bundled binary.
- The [published default configuration](https://raw.githubusercontent.com/madnuttah/unbound-docker/main/unbound/root/usr/local/unbound/unbound.conf) listens on `0.0.0.0@5335`, enables both transports, and has `access-control: 0.0.0.0/0 allow`. This is acceptable only inside a reviewed private network with loopback-only host bindings; it is **not** a safe LAN/public resolver policy. This URL is the current `main` configuration, not proof of the exact pinned image's contents.
- The [Unbound configuration reference](https://unbound.docs.nlnetlabs.nl/en/latest/manpages/unbound.conf.html) documents access control and interfaces. A deployment that publishes DNS beyond loopback needs an operator-selected client ACL, exact bind/firewall scope, TCP and UDP collision checks, a fallback DNS plan, and a separate DNS-owner approval.

## Boundaries and gaps

- `SetupContext.container.exec(effect: "read")` can run the publisher-listed `drill` command in the exact owned container. The adapter checks successful UDP and TCP A answers and `NOERROR` for one fixed name. It does not prove the host-published sockets, another container's access, DNSSEC behavior, or a public/LAN client. Inspection without a setup run still lacks this command surface.
- A secure custom ACL cannot be encoded as an operator-specific generated config without additional primitives: catalog `configFiles` are fixed content and mounted mode 0600, while the image's non-root config-read behavior for that mount has not been verified. Do not hard-code a LAN CIDR or assume the image can read the generated file.
- The generic Compose approval can review a non-loopback application port, but there is no DNS-specific approval gate or client-ACL coupling. A future LAN/public recipe must enforce both before apply; this loopback recipe must not be used as that shortcut.
- No Docker deployment, DNS query, image digest verification, or restart-persistence check was performed.

## Focused validation

`catalog recipe unbound --json`, the focused Bun build of `setup.ts`, and strict `catalog validate --json` passed. No container execution or live DNS check was run.
