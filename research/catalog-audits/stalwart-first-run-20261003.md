# Stalwart private first-run — 2026-10-03

Retained the existing v0.16.24 app-local compiler and JMAP helper; no guessed
`recipe.json` or discovered `setup.ts` was introduced. The official
[release page](https://github.com/stalwartlabs/stalwart/releases/tag/v0.16.24)
still marks this release latest. The pinned
[Dockerfile](https://github.com/stalwartlabs/stalwart/blob/v0.16.24/Dockerfile)
uses UID/GID 2000 and persistent `/etc/stalwart` plus `/var/lib/stalwart`.
The staged descriptor publishes only loopback management 8080. No SMTP,
mailbox provisioning, sending, DNS, ACME or public ingress was added.

## Bootstrap and durable capture

[Current bootstrap documentation](https://stalw.art/docs/configuration/bootstrap-mode/)
requires absent `config.json`, starts no mail services, and generates a
temporary password on every bootstrap start. Console extraction therefore
needs exact container/start identity, both bounded output streams, a fixed
banner profile, private synchronous capture and rejection of ambiguous blocks.
The common bootstrap-log helper currently only supports qBittorrent/Frigate.
Stalwart needs **no log-secret seam** on the existing safer deterministic path:
documented `STALWART_RECOVERY_ADMIN` suppresses that temporary password.

The existing helper generates its recovery env privately and checkpoints
`x:Bootstrap/set` on `/api`; the
[pinned handler](https://github.com/stalwartlabs/stalwart/blob/v0.16.24/crates/jmap/src/registry/mapping/bootstrap.rs)
returns a distinct permanent administrator once. It fsyncs that password
before another await. `x:ApiKey/set` similarly captures one management-only
key before readback. Missing once-returned output stops replay. Both recovery
variables must be removed under separate approval; old recovery login must
return 401 after restart, per the
[recovery contract](https://stalw.art/docs/configuration/recovery-mode/).

## Safety deepening and missing common seams

The helper now verifies all
[NetworkListener objects](https://stalw.art/docs/ref/object/network-listener/)
before recovery closure and during resumed HTTPS proof. Only a nonempty,
uniquely identified `http` listener set with nonempty bind sets passes; native
mail protocols, unknown protocols and malformed policy fail closed. Unpublished
ports are not disabled listeners. No defaults are silently deleted. Registry
readback does not replace exact-owner live socket/network isolation inspection.

Common `SetupContext` still lacks an owner-bound canonical HTTPS JMAP transport
with typed read-only POST `/get` methods and approved `/set` writes; replacement
capture of the once-returned permanent password; and a fresh-owned-volume
`config.json`-absence/start bridge. Its API-key writer and CAS checkpoints are
usable pieces, not that complete bridge. Shared private-env transition review
already exists, but lifecycle dispatch and saved reconstruction must detach
both recovery settings without reinjecting them on resume. Keep discovery-only
and the app-local staged compiler until those facilities and real isolated
fresh/replay/restart acceptance exist.

Validation: affected `stalwart-headless.test.ts` fixture and `headless.ts` Bun
build passed using explicit Bun 1.4.0 PATH. Added fixture scenarios reject native
SMTP, missing listeners and empty bind policy before cleanup. No Docker,
browser, private runtime, CI, commits or mail workload was used.
