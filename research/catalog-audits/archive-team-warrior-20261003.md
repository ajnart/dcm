# ArchiveTeam Warrior catalog audit — 2026-10-03

Outcome: keep discovery-only. No recipe or setup adapter was added. No container,
archival project, HQ registration, or telemetry was started.

## Container and startup evidence

- The [official pinned Compose](https://github.com/ArchiveTeam/warrior-dockerfile/blob/7682e0a0f35266fd1d31d4efe172f495c4ce10f3/docker-compose.yml)
  uses an unversioned image, port 8001, `restart: always`, and a Watchtower
  Docker-socket mount. The socket/update authority is not an ordinary shared
  application dependency and must not be copied into a recipe.
- The [pinned Dockerfile](https://github.com/ArchiveTeam/warrior-dockerfile/blob/7682e0a0f35266fd1d31d4efe172f495c4ce10f3/Dockerfile)
  runs as UID 1000, creates `/home/warrior/projects` and `/home/warrior/data`,
  and starts `tini -- python start.py`. Its shell-form healthcheck fetches
  `http://localhost:8001/index.html`; do not silently replace it with a
  supposedly equivalent Compose argv healthcheck. The [official installation
  guide](https://wiki.archiveteam.org/index.php/ArchiveTeam_Warrior) also documents
  a projects volume in its Podman example.
- [Pinned startup](https://github.com/ArchiveTeam/warrior-dockerfile/blob/7682e0a0f35266fd1d31d4efe172f495c4ce10f3/start.py)
  seeds `projects/config.json` only when it cannot load existing JSON and then
  executes `run-warrior3` with `https://warriorhq.archiveteam.org`, port 8001,
  and the projects/data directories. Restarting with changed environment values
  is not credential rotation or reliable reconfiguration.
- The [documented environment variables](https://wiki.archiveteam.org/index.php/ArchiveTeam_Warrior/Docker_environment_variables)
  include downloader nickname, selected project, concurrency and optional HTTP
  UI username/password. Those are not an administrator account or API key.
  A private unauthenticated UI can have no credentials, but must not be exposed
  publicly or represented as account creation.

## Current registry observations

Read-only HTTPS metadata requests (no image pull or layer extraction) returned:

| Request | Observation |
| --- | --- |
| HEAD `manifests/latest` | HTTP 200; digest `sha256:19337aa9157e04f6cdb8f7c6f8c98e27d14efb0d9525334995fbdb036b95e1ca` |
| GET [immutable manifest](https://atdr.meo.ws/v2/archiveteam/warrior-dockerfile/manifests/sha256:19337aa9157e04f6cdb8f7c6f8c98e27d14efb0d9525334995fbdb036b95e1ca) | Docker schema 2; config digest below |
| GET [image configuration](https://atdr.meo.ws/v2/archiveteam/warrior-dockerfile/blobs/sha256:257eecbae05ceedd514feb0a71ffc29681f451f618595db11428361e5fb20d96) | Linux amd64, user 1000, version label `20260917.01`, source revision `7682e0a0f35266fd1d31d4efe172f495c4ce10f3`, matching startup and shell healthcheck |
| GET `tags/list` | HTTP 403; tag enumeration unavailable |
| GET `manifests/20260917.01` | HTTP 404; version label is not evidence of an existing tag |

The immutable digest and publisher revision are verified metadata, not live
acceptance or a reproducible runner build. Image history shows an unpinned
`pip install -r requirements.txt` and unpinned warrior-code2 clone; the reviewed
metadata does not identify the installed seesaw-kit revision. The catalog
currently requires a fixed non-latest tag, so neither the untagged image nor
`latest@sha256:...` can be represented as a validated app-only recipe.

## Side effects and approval boundary

The [reviewed runner source](https://github.com/ArchiveTeam/seesaw-kit/blob/699b0d215768c2208b5b48844c9f0f75bd6a1cbc/seesaw/warrior.py)
starts its HQ updater on startup. Its update path POSTs registration when needed
and sends instance/nickname/project metadata to HQ. `selected_project=none`
prevents selecting an archival project in that source, but does not make startup
offline or suppress HQ writes. This runner revision is source evidence, not a
claim that it is the revision installed in the registry image.

Before any start, obtain explicit approval for HQ registration/updates and the
associated outbound traffic. Before selecting work, separately approve the exact
volunteer project, downloads/uploads, CPU, temporary disk, bandwidth/concurrency,
and destination/use policy. `auto` permits the HQ-selected project and cannot be
treated as approval for one fixed project. Preserve this scope on restart;
persisted project selection can resume work automatically.

## Integration hooks and remaining gap

- Once fixed-tag/digest representation and runner provenance are established,
  use one app-owned recipe with private port 8001 and reviewed projects/data
  storage. Do not add a second Compose owner or Watchtower.
- An inert bootstrap must have verified fail-closed egress, or the shared
  lifecycle must review and bind the specific startup external writes before
  starting the process. Ordinary no-account setup approval is insufficient.
- For no-account UI observation, reuse `createNoAccountGetAdapter` with the
  publisher `/index.html` endpoint only after the above lifecycle boundary exists.
  Report UI readiness narrowly; no admin identity or API key is created.
- Retain native Homarr `archiveTeamWarrior` integration metadata. A reachable
  frontend does not prove widget compatibility, selected-project execution,
  uploaded archival data, or restart persistence.
- Existing manual-job execution permits only pinned version probes for Restic,
  Borgmatic and Renovate. An arbitrary sleeping/no-op entrypoint would bypass
  Warrior startup without configuring or verifying the advertised workload.

Documentation lookup: Context7 resolved `/archiveteam/warrior-dockerfile` and
returned the publisher README startup/environment contract. Registry and pinned
source evidence above refine those docs. No tests, Docker, browser, CI, deployment,
or archival tasks were run; validation is limited to changed-file JSON and diff
hygiene.
