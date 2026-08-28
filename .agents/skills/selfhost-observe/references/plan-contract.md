# Observability planner contract

`plan-observability.mjs` accepts bounded, exact-key JSON and emits a deterministic redacted plan. It does not inspect a runtime, call an API, resolve DNS, open a socket, read logs, send an alert, or write a file.

## Layers

Every input includes exactly one record for each layer:

1. `container-process`
2. `api-readiness`
3. `dependency`
4. `edge`
5. `storage-capacity`
6. `backup-freshness`
7. `logs`
8. `metrics`
9. `alerts`

Container/process, API readiness, storage/capacity, logs, metrics, and alerts are always required. Dependency, edge, and backup freshness become required from `scope.hasDependencies`, `scope.publicIngress`, and `scope.backupsExpected`. This supports a minimal stack without pretending optional dependencies or public ingress exist.

Required layers also require their named probe classes: container/process, readiness, dependency readiness, capacity, backup freshness, log collection, metrics collection, and alert delivery. Public edge requires separate DNS resolution, TLS certificate, authentication enforcement, and direct-port privacy probes.

Each layer declares `planned`, `configured`, or `observed`. Planned/configured checks carry no actual value or evidence. Observed checks require a timestamp, expected/actual classification, `pass|fail|blocked`, and evidence references plus SHA-256 hashes for pass/fail results. Process liveness never substitutes for API readiness.

## Safe targets and reuse

Probe targets use `scheme`, `hostClass`, and port plus an optional HTTP(S) URL. Only `http` and `https` URLs without credentials, query, or fragment are accepted. Output drops the full URL and preserves only `loopback`, `private-dns`, `service-dns`, `public-dns`, or `redacted` host class.

Existing monitors can be reused only with owner, lifecycle owner, explicit acceptance, and visibility. Protected administrative resources and protected reused monitors must remain private. Reuse never upgrades configured state to observed state.

## Collection and alerting

`runtimeMethod` may be an application API, runtime CLI, agent, existing monitor, Docker socket, or mixed. Direct read-only Docker socket access remains privileged and requires explicit approval and an owner; a socket proxy also needs an owner. No mode is allowed to make the socket a casual prerequisite.

Logs declare owner, retention, and `redact`, `drop`, or `allow-reviewed` PII policy. Metrics declare owner and retention. Alerts declare an owner and at least one route with its own owner and opaque destination reference.
An alerts layer classified as configured requires a configured/observed route; an observed alerts layer requires timestamped route evidence in addition to its alert-delivery check.

Inputs are capped at 256 KiB, nesting at 12 levels, collections at 100 entries, and strings at 2048 characters. Unknown keys and secret material are rejected without echo. Results never repeat raw URLs, hostnames, IPs, or input evidence payloads.
