# Node-RED shared setup boundary

Decision: keep Node-RED guided without a v2 Compose recipe or headless adapter. This review is of sources and the shared compiler, not a live image or login check.

The [official Docker guide](https://nodered.org/docs/getting-started/docker) names `nodered/node-red`, port 1880, `/data` persistence, `/data/settings.js`, and default container UID 1000. Its Compose example uses a floating `latest` tag; an exact published version/tag still needs selection and image provenance before a recipe.

The [official security guide](https://nodered.org/docs/user-guide/runtime/securing-node-red) says the editor is unsecured by default. The editor and Admin API require `adminAuth` in `settings.js` with a bcrypt-hashed user password; it documents `node-red admin hash-pw` for generation. Authentication of HTTP In nodes is a separate setting. A private host bind does not protect the editor from other members of a shared Docker network.

The current shared compiler's `configFiles` are literal, non-secret strings written mode 0600 and mounted read-only. It rejects secret-bearing settings content and cannot derive a per-owner bcrypt hash into `settings.js` before first boot. The official image's UID 1000 also cannot be assumed able to read a host-owned 0600 generated mount. A password environment variable without a proven settings binding, an unsecured boot followed by HTTP mutation, or a fixed hash would not close the gap. No documented first-admin HTTP route was found that could safely establish `adminAuth` after boot.

A future route needs a pinned official image, reviewed secret-derived settings generation with UID-safe read access and replay-safe ownership, then a private Admin API authentication probe plus anonymous-denial proof. Flow credentials and HTTP-node auth require separate treatment; do not infer them from editor login.
