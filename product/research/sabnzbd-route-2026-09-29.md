# SABnzbd first-run route research — 2026-09-29

- Status: source-supported inspect-only Compose recipe, private INI-key
  extraction, and checkpointed first-run adapter; no live image/runtime/API test performed.
- Decision: Docker Hub now lists LinuxServer's patched `version-5.1.3` tag. The catalog uses that versioned Docker Hub reference; setup and acceptance still need a verified private API/config route before promotion. Resolve the platform digest at plan time.

## Findings

- LinuxServer documents a single `sabnzbd` service with `PUID`, `PGID`, `TZ`, persistent `/config`, WebUI `8080`, and optional separate `/incomplete-downloads` and `/downloads` mounts. Those mounts are only targets; they do not prove SABnzbd's configured download paths. LinuxServer warns that split mounts can prevent hardlinks/atomic moves. The image entrypoint starts SABnzbd with `--config-file /config`; upstream resolves a directory to `/config/sabnzbd.ini`.
- A fresh profile does not generate an admin username/password: both default empty. Upstream creates separate random 32-hex `api_key` and `nzb_key` values. Initialization runs config conversions and saves the resulting config, so the API key should be present in the persisted INI after startup. There is no anonymous API endpoint that returns the key; `mode=version` and `mode=auth` are the only no-key API modes. Other API calls require the API key (the NZB key only permits limited queue operations).
- The documented API endpoint is `/api`; upstream's API reference demonstrates query parameters. SAB 5.1.3 [pins CherryPy 18.10.0](https://raw.githubusercontent.com/sabnzbd/sabnzbd/5.1.3/requirements.txt). That exact tag parses URL-encoded POST bodies into request parameters in its [body parser](https://raw.githubusercontent.com/cherrypy/cherrypy/v18.10.0/cherrypy/_cpreqbody.py) and passes them as handler keywords in its [dispatcher](https://raw.githubusercontent.com/cherrypy/cherrypy/v18.10.0/cherrypy/_cpdispatch.py). SAB's [exposed `/api` method](https://raw.githubusercontent.com/sabnzbd/sabnzbd/5.1.3/sabnzbd/interface.py) forwards `**kwargs` to `api_handler`. A form-encoded `POST /api` with `mode`, `apikey`, and operation fields is therefore source-supported, but not runtime-proven against the pinned image. Never put the key in a URL.
- Upstream default exposure is local-only (`inet_exposure=0`), but `mode=version` is access level 1 and access checks allow loopback/local client addresses. Whether the chosen Docker loopback-published port arrives as an allowed peer inside the container remains unverified. A configured `url_base`, HTTPS, custom port, hostname whitelist, or proxy can also change the deterministic origin/path; inspect the owned profile and do not guess.
- SABnzbd separates temporary `download_dir` from `complete_dir`; categories can override the completed path (relative paths are beneath the complete folder; absolute paths are used as-is). Upstream's initial category suggestions are `*`, `movies`, `tv`, `audio`, and `software`, not user requirements. Choose paths only with the owner and any Arr import layout; use one shared filesystem mount when hardlinks/atomic moves matter. The provider/server host, port, TLS, username, password, retention, and category choices remain explicit owner inputs.
- Pinned cfg.py declares the download paths with create disabled, but startup
  enables directory creation before the API runs. A failed path update may
  return the unchanged value, so exact readback and a later filesystem
  writability check remain separate gates.
- No SABnzbd-specific documented healthcheck/readiness contract was found in the LinuxServer guide or app Dockerfile. `/api` version readiness proves only the HTTP/API handler, not NNTP access, writable paths, or a successful download. The resolved image's inherited Docker health metadata was not inspected.

## Candidate setup contract

**Fresh profile:** render the documented service shape with a private loopback host bind, owner-selected persistent `/config`, and owner-selected shared download mount. Start only this Compose service. Poll the exact saved-origin `/api` with unauthenticated `mode=version`; read `/config/sabnzbd.ini` through a new narrow helper scoped to the exact owned service/project, validate the `api_key` privately, and never print it. Then, only after an approval/checkpoint, POST the owner-provided NNTP server, `misc.download_dir` / `misc.complete_dir`, and requested category values; read back only the intended fields and categories. Persist/handoff the key only through the existing private mode-0600 credential boundary. If the form POST route fails, stop rather than falling back to a URL query or browser.

**Resumed profile:** require exact applied project/service status and the same persistent `/config`; read the current INI key and current `url_base`, paths, categories, and server state. Use the current config key only for authenticated readback. Do not rotate keys or silently refresh a credential handoff. If config/API state disagree, stop for owner review. Do not change download paths on a non-empty queue: upstream rejects temporary-path changes while queue/post-processing work exists, and rejects identical or unsafe temp/complete directory relationships. Preserve queue and data; ask before recovery or migration.

Keep SABnzbd as a Compose app candidate only. The owner-selected host storage layout is setup input, not another selectable catalog prerequisite/app.

The setup transport now exposes a SABnzbd-only INI-key reader. It runs a fixed `awk` program inside the exact saved Compose service, emits only one `[misc] api_key`, validates 32 lowercase hex characters, and registers that value for private redaction. The synthetic INI fixture checks that other sections, duplicate keys, and missing keys cannot be returned. The app has an inspect-only recipe with one shared `/data` source and generated admin password. These are not provider setup or live container proof.

The per-app setup adapter now checks the pinned version and full API-key
authorization, refuses DEBUG request logging, and sets the generated admin
credential through form POSTs with pre-send checkpoints. It verifies a
nonempty masked password and a successful login redirect, then reads back
the selected shared incomplete and complete paths before saving the API key
privately. The focused fake-service fixture passed fresh setup, no-change
replay, and recovery after a lost password-update response without a second
password write. The recipe is still inspect-only: owner-provided Usenet server
configuration, Arr wiring, filesystem writability, scoped restart, and a live
image/API run remain unverified.

## Evidence boundary and risks

Checked upstream 5.1.3 source, the exact pinned CherryPy source, upstream 5.1 API/folder/category docs, LinuxServer's current image guide/package tags/run script, and the existing SAB catalog manifest and setup HTTP types. The focused synthetic recipe render and INI parser checks do not exercise Docker. No browser, Docker, image pull, secret, live API request, first-run, restart, NNTP test, or filesystem write was performed. The route, startup persistence, Compose bind behavior, POST encoding, and resumed-profile behavior are source-derived, not runtime-accepted.

Risks to resolve before shipping: the [upstream 5.1.3 release notes](https://github.com/sabnzbd/sabnzbd/releases/tag/5.1.3) list security fixes; the [LinuxServer Docker Hub tags](https://hub.docker.com/r/linuxserver/sabnzbd/tags) now include stable `5.1.3` and `version-5.1.3` for amd64 and arm64. The [version-5.1.3 layer record](https://hub.docker.com/layers/linuxserver/sabnzbd/version-5.1.3/images/sha256-233ff4920504ea316eb44b4e0b76e4f6df4db964ff0e30951a54939cda57e6ad) identifies app version 5.1.3. The API key and provider credentials are secrets; SABnzbd can log request kwargs at DEBUG when API logging is enabled; paths must agree with the actual mounts/Arr contract; and no API 200 should be described as full acceptance.

## Sources

- [LinuxServer SABnzbd guide](https://docs.linuxserver.io/images/docker-sabnzbd/) · [current Docker Hub tags](https://hub.docker.com/r/linuxserver/sabnzbd/tags) · [image startup script](https://raw.githubusercontent.com/linuxserver/docker-sabnzbd/master/root/etc/s6-overlay/s6-rc.d/svc-sabnzbd/run) · [image Dockerfile](https://github.com/linuxserver/docker-sabnzbd/blob/master/Dockerfile)
- [SABnzbd 5.1 API](https://sabnzbd.org/wiki/configuration/5.1/api) · [folders](https://sabnzbd.org/wiki/configuration/5.1/folders) · [categories](https://sabnzbd.org/wiki/configuration/5.1/categories)
- [Upstream 5.1.3 `cfg.py`](https://raw.githubusercontent.com/sabnzbd/sabnzbd/5.1.3/sabnzbd/cfg.py) · [`config.py`](https://raw.githubusercontent.com/sabnzbd/sabnzbd/5.1.3/sabnzbd/config.py) · [`interface.py`](https://raw.githubusercontent.com/sabnzbd/sabnzbd/5.1.3/sabnzbd/interface.py) · [`SABnzbd.py`](https://raw.githubusercontent.com/sabnzbd/sabnzbd/5.1.3/SABnzbd.py) · [`sabnzbd.ini` filename constant](https://raw.githubusercontent.com/sabnzbd/sabnzbd/5.1.3/sabnzbd/constants.py)
- Local evidence: `.agents/skills/self-host/workflows/selfhost/references/catalog/apps/sabnzbd/manifest.json`; `.agents/skills/self-host/workflows/selfhost/references/catalog/types/setup.ts`.
