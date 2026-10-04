# Valkey private shared Compose candidate (2026-09-29)

Official image: `valkey/valkey:9.1.2`, with `/data` for persistence and port 6379. The image documents `valkey-server` flags. Valkey documents `valkey-cli PING` returning `PONG` as a basic functioning check.

The recipe binds the host port to loopback. It sets `--protected-mode no` so trusted peers on the reviewed shared Compose network can reach it; without authentication, the default protected mode rejects non-loopback peers. This is a network-isolated, **unauthenticated** recipe, not a secure general-purpose database endpoint. Do not attach untrusted apps or expose the port. ACL/requirepass and TLS require a separately reviewed configuration and client handoff; the official image does not document a generated password-file bootstrap suitable for this catalog contract.

The headless route checks PING only inside the exact owned container. It creates no account or API key and does not claim peer connectivity. Actual consumer compatibility, peer reachability, persistence across restart, isolated restore for durable queues, image behavior, and live fresh-instance acceptance remain unverified.

Sources: [official image](https://hub.docker.com/r/valkey/valkey/), [tag list](https://hub.docker.com/r/valkey/valkey/tags?name=9.1.2), [installation and PING](https://valkey.io/topics/installation/), [network security and protected mode](https://valkey.io/topics/security/), [persistence](https://valkey.io/topics/persistence/).
