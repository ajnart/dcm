# Home Assistant Container: bounded shared recipe

Checked 2026-09-29. The official Container image is `ghcr.io/home-assistant/home-assistant`; the official container update guide currently shows the specific `2026.9.3` tag. The Linux installation guide documents `/config`, `TZ`, port 8123, and `restart: unless-stopped`, but its full-feature example also uses host networking, privilege, and optional D-Bus. This recipe intentionally does not request those broad capabilities. It publishes only the web UI on 127.0.0.1 and persists `/config` in a project-owned volume. LAN discovery, USB radios, Bluetooth, speakers, and LAN/browser reachability from other devices require separate design and approval. Container mode also lacks Home Assistant OS apps.

The pinned 2026.9.3 source exposes unauthenticated `GET /api/onboarding` and one-time `POST /api/onboarding/users` with `name`, `username`, `password`, `client_id`, and `language`. It creates an administrator and returns an authorization code, which this adapter does not retain. The same tag exposes `/auth/login_flow` and `/auth/login_flow/{flow_id}` for verifying the saved username/password; the adapter uses the exact selected private origin as `client_id` and discards the returned code. It checkpoints before the one-time owner write, refuses to adopt an unrelated existing owner, and never sends another owner-creation write after an ambiguous response. Every setup replay verifies the saved password again; restart persistence remains a separate acceptance check.

Sources:

- [Official Linux Container installation](https://www.home-assistant.io/installation/linux/)
- [Official Container update guide and version tag](https://www.home-assistant.io/common-tasks/container/)
- [Pinned onboarding HTTP source](https://raw.githubusercontent.com/home-assistant/core/2026.9.3/homeassistant/components/onboarding/views.py)
- [Pinned authentication flow HTTP source](https://raw.githubusercontent.com/home-assistant/core/2026.9.3/homeassistant/components/auth/login_flow.py)
- [Official authentication API](https://developers.home-assistant.io/docs/auth_api/)

No live Docker or browser acceptance was run. The bridge-network recipe's compatibility with the image and the API flow on a fresh instance remain live-verification gaps.
