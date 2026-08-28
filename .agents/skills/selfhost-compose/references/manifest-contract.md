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
      "environment": [{ "name": "TZ", "value": "Europe/Berlin" }],
      "ports": [{ "hostIp": "127.0.0.1", "published": 18080, "target": 8080, "protocol": "tcp", "purpose": "application", "publicApproved": false }],
      "mounts": [{ "source": "/srv/selfhost-data/private-demo", "target": "/data", "readOnly": false, "shared": false, "owner": "private-demo", "ownership": "new" }],
      "networks": ["private"],
      "secretRefs": [{ "name": "session-key", "ref": "vault/private-demo/session-key", "target": "session_key" }]
    }
  ],
  "networks": [{ "id": "private", "name": "private-demo-private", "driver": "bridge", "internal": true, "owner": "private-demo", "ownership": "new" }],
  "observed": { "checkedAt": "2026-08-28T10:00:00Z", "project": null, "ports": [], "paths": [], "networks": [] }
}
```

## Field rules

- `project.dockerContext` names the exact observed Docker context used later by preflight and lifecycle commands. `project.directory` must equal `project.root/project.id`. Both are absolute normalized paths; broad system roots are rejected. `verified-existing` requires an exactly matching `observed.project`; `new` requires no observed project.
- A service has only the shown keys. Images need an explicit non-floating tag or sha256 digest, and `user` must be a non-root numeric `uid:gid`. Environment names that imply credentials must move to `secretRefs`; interpolation and recognizable credential material are rejected.
- Port IPs are literal IP addresses or `*`. Private/loopback binds need `publicApproved: false`. Public binds are allowed only for `purpose: application` with `publicApproved: true`; administration, database, management, and Docker API purposes and protected port numbers never become public here.
- Bind sources and container targets are absolute normalized paths. A read-write source must be owned by the project. Reuse requires `verified-existing` and an exact observed owner. Exact source sharing is allowed only when every claimant is read-only and `shared: true`; other equal or nested overlaps conflict. Before lifecycle preflight, every bind source must already be a regular non-symlink file or directory so Docker cannot create it implicitly.
- Networks use the bridge driver. A new network must be project-owned and absent from observations. A verified existing network must have an exact observed owner. Host networking is unsupported.
- `secretRefs` contain only opaque IDs and external secret targets. They never contain files, environment interpolation, or payloads.
- Observed records have exact shapes: project `{id,directory,owner}`, port `{hostIp,published,protocol,owner}`, path `{path,owner}`, and network `{name,owner}`.

Planner status is `pass`, `blocked`, or `conflict`. A non-pass plan exits with status 3 and remains read-only.
