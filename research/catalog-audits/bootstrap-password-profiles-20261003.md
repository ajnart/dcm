# App-owned bootstrap password profiles — 2026-10-03

The existing qBittorrent and Frigate capture rules now live in each app's
`bootstrap-password.json`. The shared transport still owns exact container,
Compose project, current-start timestamps, bounded private logs and redaction.
This moves proven behavior; it does not deploy another app or create a new
credential-capture API.

| App | Closed format | Pinned evidence |
| --- | --- | --- |
| qBittorrent | One unique temporary-password suffix | [release-5.2.3 startup emitter](https://github.com/qbittorrent/qBittorrent/blob/release-5.2.3/src/app/application.cpp) |
| Frigate | One complete fresh-user block; refuse reset output | [v0.18.0 authentication initialization](https://github.com/blakeblackshear/frigate/blob/v0.18.0/frigate/app.py) |

Profiles are data, not caller-supplied expressions, paths or executable code.
Only these two proven formats are implemented. A capability token, enrollment
URL or key is not an administrator password; Pangolin's setup token cannot use
this route.

The loader uses the canonical source catalog or the packaged catalog exclusively.
It refuses unsafe file targets, oversized/world-writable files and changed
inodes; missing package data never falls back to a checkout. Setup review hashes
the exact profile bytes for selected and peer adapters, alongside executable
contracts. Changing a profile requires a new review.

Validation: the named profile parser, compiled loader, existing bootstrap
transport and source/compiled setup-contract fixtures passed on Bun 1.4.0.
Independent Standards and Spec reviews found no actionable issues. These are
local source/fixture results, not fresh-install, workload or restart acceptance.
No credentials, private logs, live evidence or generated package files belong
in this report.
