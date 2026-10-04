# Node-RED shared Compose assessment (2026-09-29)

Decision: retain guided catalog support. Do not add `apps/node-red/recipe.json` or `setup.ts` yet. A private Compose start would leave the editor and Admin API without a configured administrator, and a fake `no-account` adapter would misrepresent that exposure.

## Official contract

- The [Docker guide](https://nodered.org/docs/getting-started/docker) uses the upstream `nodered/node-red` image, port 1880, and persistent `/data`; it supports a named volume and documents the image's default UID 1000 for bind-mount ownership. It shows a Compose example and documents `TZ`.
- The [upstream image repository](https://github.com/node-red/node-red-docker) confirms `/data` is the user directory and also publishes `ghcr.io/node-red/node-red` images. No image version or digest was selected for a recipe in this pass.
- [Securing Node-RED](https://nodered.org/docs/user-guide/runtime/securing-node-red) requires `adminAuth` in the settings file for editor and Admin API authentication, with a bcrypt password hash. Its documented `node-red admin hash-pw` command produces the hash. The older `httpAdminAuth` is deprecated.
- The [settings-file guide](https://nodered.org/docs/user-guide/runtime/settings-file) says Node-RED copies a default `settings.js` into its user directory if absent and loads that JavaScript file as a module. A startup flag can select a different settings file. Thus an environment variable containing a password or hash is not, by itself, a documented admin bootstrap contract.

## Exact gap and safe implementation path

The shared v2 recipe can request generated private files and mount persistent storage, but cannot currently generate a source-backed JavaScript `settings.js` from a generated administrator password and bcrypt hash before the first service start, with ownership and restart behavior bound to the same Compose project. A generated-config-file primitive (or an equally bounded image-supported bootstrap) is needed. It should write a private, syntactically valid settings module before startup, preserve or explicitly own existing `/data/settings.js`, never log plaintext or hash material, and avoid overwriting user configuration on resume. An adapter could then verify the protected Admin API using the generated credential and checkpoint the private handoff path. These are design requirements, not implemented claims.

Until then, a shared-plan recipe would be a deployable unauthenticated editor even if published only on loopback. There is no recipe, setup adapter, fresh-instance acceptance, flow round-trip, or restart-persistence proof from this research. A later candidate should pin a verified image tag/digest and require separate approval for any device access, contributed nodes, external integrations, or wider network exposure.
