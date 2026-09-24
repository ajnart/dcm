# Project manifest contract

The input is UTF-8 JSON, at most 256 KiB, with `schemaVersion: 1`. Every object uses the exact keys below; unknown or missing keys fail validation. Collections, nesting, labels, text, and paths are bounded.

```json
{
  "schemaVersion": 1,
  "project": {
    "dockerContext": "default",
    "id": "private-demo",
    "owner": "private-demo",
    "root": "/srv/selfhost-projects",
    "directory": "/srv/selfhost-projects/private-demo",
    "ownership": "new"
  },
  "services": [
    {
      "id": "web",
      "image": "docker.io/library/nginx:1.27.4",
      "restart": "unless-stopped",
      "readOnly": true,
      "user": "1000:1000",
      "environment": [{ "name": "SESSION_KEY_FILE", "value": "/run/secrets/session_key" }],
      "ports": [{ "hostIp": "127.0.0.1", "published": 18080, "target": 8080, "protocol": "tcp", "purpose": "application", "publicApproved": false }],
      "mounts": [{ "source": "/srv/selfhost-data/private-demo", "target": "/data", "readOnly": false, "shared": false, "owner": "private-demo", "ownership": "new" }],
      "networks": ["private"],
      "secretRefs": [{ "name": "session-key", "ref": "local/private-demo/session-key", "target": "session_key", "filePath": "/srv/selfhost-projects/private-demo/secrets/session-key" }]
    }
  ],
  "networks": [{ "id": "private", "name": "private-demo-private", "driver": "bridge", "internal": true, "owner": "private-demo", "ownership": "new" }],
  "observed": { "checkedAt": "2026-08-28T10:00:00Z", "project": null, "ports": [], "paths": [], "networks": [] }
}
```

## Field rules

- `project.dockerContext` names the exact observed Docker context used later by preflight and lifecycle commands. `project.directory` must equal `project.root/project.id`. Both are absolute normalized paths; broad system roots are rejected. `verified-existing` requires an exactly matching `observed.project`; `new` requires no observed project.
- A service has only the shown keys. Images need an explicit non-floating tag or sha256 digest, and `user` must be a non-root numeric `uid:gid`. Environment names that imply credentials must move to `secretRefs`; interpolation and recognizable credential material are rejected. A `*_FILE` variable is the narrow exception: its value must be exactly `/run/secrets/<target>` for a declared service secret.
- Services may add `command` and `entrypoint` as non-empty argv arrays of at most 32 bounded strings. Shell strings, interpolation, and secret-bearing arguments are rejected. They may add `healthcheck` with exact fields `{test,intervalSeconds,timeoutSeconds,startPeriodSeconds,retries}`. `test` must be an argv array beginning with `CMD`; intervals are 1–3600 seconds, timeout 1–300 seconds, start period 0–3600 seconds, and retries 1–20.
- `shmSizeBytes` is an optional integer from 1 MiB through 1 GiB. Rendering writes the exact byte count as numeric Compose `shm_size`; omission preserves the image/runtime default.
- `dependsOn` is an optional array of exact `{service,condition}` records. Conditions are `service_started`, `service_healthy`, or `service_completed_successfully`. Every named service must exist, the graph must be acyclic, and `service_healthy` requires the dependency to declare a healthcheck.
- Numeric non-root `user` remains the default policy. `user: "image-default"` is allowed only with `imageUserEvidence: {"officialUrl":"https://...","reason":"..."}`. The URL must be an HTTPS publisher source without credentials or a fragment; reason must be `upstream-init-requires-default-user`, `image-declares-nonroot-user`, or `official-image-runtime-contract`. This exception is surfaced in the plan for review. Rendering then omits `user`, leaving the image's declared user or default container root in effect. Container root does not grant host control without separately forbidden privileges or host resources.
- Port IPs are literal IP addresses or `*`. Private/loopback binds need `publicApproved: false`. Public binds are allowed only for `purpose: application` with `publicApproved: true`; administration, database, management, and Docker API purposes and protected port numbers never become public here.
- Bind sources and container targets are absolute normalized paths. A read-write source must be owned by the project. Reuse requires `verified-existing` and an exact observed owner. Exact source sharing is allowed when every claimant is read-only with `shared: true`. Two services in this same project may instead share an exact read-write source only when both mounts set `shared: true`, use the same explicit `shareGroup`, and retain identical project ownership. A `shareGroup` is invalid on read-only or unshared mounts. Other equal or nested overlaps conflict. Before lifecycle preflight, every bind source must already be a regular non-symlink file or directory so Docker cannot create it implicitly.
- Networks use the bridge driver. A new network must be project-owned and absent from observations. A verified existing network must have an exact observed owner. Host networking is unsupported.
- Each `secretRefs` entry contains the opaque `name`, provenance `ref`, and container `target`. Omitting `filePath` preserves an external, planning-only reference. Supplying `filePath` binds a local source and must use an absolute normalized path strictly below `<project.directory>/secrets/`. The manifest references that path only; it never contains or reads the payload.
- Local lifecycle preflight supports only file-bound secrets. Every source must be a current-user-owned, mode-0600, non-empty regular file of at most 64 KiB with no symlink traversal and one hard link. External references remain valid for portable planning and rendering, but this local lifecycle rejects them with an actionable error because it does not provision an external secret platform.
- Observed records have exact shapes: project `{id,directory,owner}`, port `{hostIp,published,protocol,owner}`, path `{path,owner}`, and network `{name,owner}`.

Planner status is `pass`, `blocked`, or `conflict`. A non-pass plan exits with status 3 and remains read-only.
