# Ollama install-contract candidate (2026-09-29)

Status: conditional GO for a CPU-only, private standalone recipe; remain
discovery/guided until implemented and proved on a fresh instance.

- Pin `ollama/ollama:0.34.4` (the [latest GitHub release at review](https://github.com/ollama/ollama/releases/latest)); [Docker Hub tags](https://hub.docker.com/r/ollama/ollama/tags) list both linux/amd64 and linux/arm64. Resolve a per-platform digest at apply rather than assuming the tag is immutable.
- [Official Docker setup](https://docs.ollama.com/docker) uses port 11434 and persistent `/root/.ollama`. A bounded CPU-only recipe can publish only `127.0.0.1:<chosen-port>`, omit GPU devices, and keep model data project-owned. The [versioned Dockerfile](https://github.com/ollama/ollama/blob/v0.34.4/Dockerfile) sets the container listener to `0.0.0.0:11434`; host exposure must stay private.
- [GET `/api/tags`](https://docs.ollama.com/api/tags) returns a JSON `models` array and can be a direct first-run readiness probe. The [local API has no authentication](https://docs.ollama.com/api/authentication); there is no admin account/password/API key to extract. Do not call an empty model list a usable inference setup.
- Model choice, license, download, inference round-trip, memory/disk capacity, persistence, and optional GPU routing are separate user choices and acceptance gates. The [FAQ](https://docs.ollama.com/faq) documents model-dependent RAM/VRAM and disabling cloud features with `OLLAMA_NO_CLOUD=1`; the current single-service recipe cannot express that environment choice. No dedicated upstream health endpoint was identified in this check.
- The existing catalog manifest is guided/T0 but has no native Homarr integration/widget mapping. A raw API endpoint is not a useful Homarr app tile; Open WebUI is a separate app. Do not advertise native Homarr support.

Recommendation: add a declarative CPU recipe and first-run `/api/tags` adapter
only after the shared recipe can express the privacy environment and resource
gate; label it “API ready, no model installed” until model-specific acceptance.
