# Warrior idle first-run — 2026-10-03

Status: source/synthetic only; discovery support and existing native Homarr mapping
remain unchanged. No container, HQ registration, project selection, or donation ran.

## Later bounded OCI provenance inspection

The earlier unknown installed-runner revision below is resolved by in-memory,
SHA-checked public OCI blob inspection, without Docker pull/run, filesystem
extraction, or executing source. Layer18's `run-warrior3` imports
`seesaw.script.run_warrior`; final library-copy layer25's `direct_url.json` pins
seesaw 0.10.3 to `bb6673d27a8717e13efe5d7deb3628349cd08585`. Six effective
runtime sources byte-match that pinned upstream revision. All later layers were
checked for module/executable replacement, cwd shadowing and relevant whiteouts;
layer25 is the only library replacement. Clone layer36 records warrior-code2
`465aa2223a9d6d863f3e8ff173eaf8bfb5fbd0d5`. Compact exact layer/source hashes and
startup effects are app-local `runtime-provenance.json`.

The recovered runner sends HQ registration when identity is absent, then HQ
updates at startup and every ten minutes, including identity, nickname, selected
project and null lat/lng. `none` is not offline or zero external writes. It still
requires before-start exact identity/workload/budget consent, writable private
config/resume inspection, Basic-auth (not administrator/API-key) onboarding and
bounded authenticated effective-idle readback. No startable recipe is claimed.

## Verified contract

Context7 `/archiveteam/warrior-dockerfile` and the
[publisher README](https://github.com/ArchiveTeam/warrior-dockerfile/blob/7682e0a0f35266fd1d31d4efe172f495c4ce10f3/README.md)
confirm environment/config-file bootstrap and port 8001. The
[startup script](https://github.com/ArchiveTeam/warrior-dockerfile/blob/7682e0a0f35266fd1d31d4efe172f495c4ce10f3/start.py)
ignores changed environment when valid config exists. Persisted config is therefore
the resume source of truth, not environment or HTTP 200.

[Runner source](https://github.com/ArchiveTeam/seesaw-kit/blob/699b0d215768c2208b5b48844c9f0f75bd6a1cbc/seesaw/warrior.py)
defines nickname `[-_a-zA-Z0-9]{3,30}`, concurrency 1–6, and project `none`.
Its ConfigManager writes config during startup; a read-only secret-config mount
is incompatible. `none` prevents work selection but startup still registers or
updates HQ. A nickname is a public contribution label, not an account.

[Web source](https://github.com/ArchiveTeam/seesaw-kit/blob/699b0d215768c2208b5b48844c9f0f75bd6a1cbc/seesaw/web.py)
supports chosen HTTP username/password, not an administrator account/API key.
Use authenticated `/` or `/api/settings` plus unauthenticated rejection for login
proof; `/index.html` is only the publisher's static health probe. Settings HTML
contains private credential values and must never enter ordinary output.
The [HTTP handler](https://github.com/ArchiveTeam/seesaw-kit/blob/699b0d215768c2208b5b48844c9f0f75bd6a1cbc/seesaw/web_util.py)
checks Basic credentials and returns 401 on failure. SockJS `on_open` has no
equivalent explicit credential check in the reviewed connection class; do not
assume HTTP Basic protects all event traffic. Keep the complete frontend private.
SockJS opens with `project.refresh` and `warrior.status`; `NO_PROJECT` plus a null
project is the effective idle proof, not archival functionality or offline status.

Read-only registry HEAD on 2026-10-03 still resolves `latest` to
`sha256:19337aa9157e04f6cdb8f7c6f8c98e27d14efb0d9525334995fbdb036b95e1ca`.
[Image config](https://atdr.meo.ws/v2/archiveteam/warrior-dockerfile/blobs/sha256:257eecbae05ceedd514feb0a71ffc29681f451f618595db11428361e5fb20d96)
confirms amd64, UID 1000, revision `7682e0a0f35266fd1d31d4efe172f495c4ce10f3`,
label `20260917.01`; that tag still returns 404. The Dockerfile clones unpinned
warrior-code2, so installed seesaw-kit revision remains unknown. Reviewing the
pinned runner is not proof of the image's installed runner.

## Implemented app-owned building block

`idle-config.ts` deterministically derives secret-bearing JSON from an explicitly
chosen nickname/HTTP username and privately generated password. It fixes
`selected_project=none`, concurrency 1, and invents no Warrior ID. It compares
private installed config without resetting upstream-issued identity, rejects
project/credential drift, and checks a bounded single private-origin opening
snapshot for `NO_PROJECT`, null project, and no archival transitions. It performs
no I/O, returns no readiness record, and is not a discovered setup adapter.

## Exact missing shared seams

1. Allow a publisher digest-only image reference rather than a fabricated fixed
   tag; establish installed runner provenance before wiring the reviewed API.
2. Bind specific HQ registration/update traffic in pre-start approval or implement
   a verified fail-closed inert bootstrap. Normal setup approval happens too late.
3. Derive a writable UID-1000, owner-private config inside owned storage and read
   that exact file privately on resume without overwriting upstream changes.
4. The shared transport now has a narrow read-only SockJS opening facility,
   consumed by app-local `idle-readback.ts`. It derives
   `/000/auto-stack/websocket` from the exact saved loopback origin, privately
   sends Basic authorization, sends no application frames, and requires the
   pinned five-event opening sequence plus the existing idle validator. Basic
   login independently requires anonymous `/` rejection and authenticated
   `/api/settings`; credential-bearing settings HTML is not consumed. The
   facility does not establish before-start consent or mutable-config ownership.

No install recipe or discovered setup adapter was registered. Generated Basic
credential preparation, writable UID-1000 private config initialization/resume
readback, and source-bound exact outbound/workload/resource approval remain
activation blockers. The helper's fixed `warrior-admin` identity is a UI Basic
login, not an administrator account or durable API key. The opening snapshot is
an idle observation only, not offline or completed archival acceptance.

Archival execution remains a separate consent for the exact project and resource,
download/upload, bandwidth, and destination policies. Do not select `auto`.

Validation: Bun 1.4.0, only `archive-team-warrior-idle-config.test.ts` plus changed
helper syntax build; deterministic config, credential drift, invalid input,
auto/project rejection, missing/duplicate/nonidle snapshots, and work-transition
rejection passed. No Docker, browser, live login, restart, CI, or broad suite.

Follow-up validation: Bun 1.4.0 synthetic loopback
`archive-team-warrior-snapshot.test.ts` verifies the exact SockJS opening path,
private header, no sent application frames, binary/oversize/work-transition
rejection, Basic login proof and no settings-HTML consumption. Changed helper
and transport syntax builds passed. No HQ traffic, Docker or live acceptance.
