# Gatus v5.37.0 shared recipe evidence

- The [v5.37.0 release](https://github.com/TwiN/gatus/releases/tag/v5.37.0) and [upstream image package](https://github.com/TwiN/gatus/pkgs/container/gatus) establish the pinned image tag.
- The [versioned README](https://github.com/TwiN/gatus/blob/v5.37.0/README.md#docker) mounts `config.yaml` at `/config/config.yaml` and serves port 8080. Its [configuration and storage sections](https://github.com/TwiN/gatus/blob/v5.37.0/README.md#storage) document HTTP endpoint conditions and SQLite persistence; memory is the nonpersistent default.
- The [upstream Kubernetes example](https://github.com/TwiN/gatus/blob/v5.37.0/.examples/kubernetes/gatus.yaml) probes `GET /health` for readiness. This recipe binds only loopback and verifies that exact endpoint without credentials.

The generated file contains one Gatus self-check. It does not monitor another service, set up alerts, establish a user or API key, or prove restart persistence. Adding targets, notifications, external access, or Homarr integration requires separate review and acceptance. No live container deployment was performed for this catalog change.
