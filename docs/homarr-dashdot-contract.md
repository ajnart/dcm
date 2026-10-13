# Dash. Homarr Link

## Scope and credentials

This peer implements issue #274 against the [shared Link contract](homarr-integration-contract.md)
at reference commit `573a206e2b4a76574fd7e8cbd1f21c5a4c2fd37d`.
The reference owner must register `dashdotTarget()` in `targets.go`; this peer
does not edit the shared registry or reconciliation.

The Catalog image remains `mauricenino/dashdot:6.3.4`. Homarr supports
`ghcr.io/homarr-labs/homarr:v2.4.1`, source
`ebbd4876d25a51151444a009ab596e1154d62880`. Dash. source v6.3.4 resolves to
`9d169fc77fefe6e50ce8a326584a8602588e6987`. These are source/schema baselines,
not tested runtime digests.

Homarr kind `dashDot` requires the exact empty credential alternative `[[]]`.
The descriptor explicitly submits `secrets: []`; it creates no peer credential
and does not read the Admin login. Its server Address is
`http://dashdot:3001`; the existing Link engine resolves the browser Address
separately. Homarr's own API calls still authenticate with its saved API key.
The shared engine owns integration/widget IDs, reruns and removal.

## App readiness

`self-host setup dashdot` first waits for `/config`, then polls actual CPU/RAM
data. `Check` and the Homarr verifier probe afresh:

- `/config` must explicitly enable exactly `cpu` and `ram`, disable Docker
  namespace setup and background collection, leave integration routes enabled,
  and disable CPU temperatures. Missing false-valued fields are not accepted.
- `/info` must contain a CPU identity, positive thread count and positive RAM
  size.
- `/load/cpu` must contain nonempty per-core measurements with explicit
  0–100 load and a nonnegative temperature field required by Homarr's schema.
  Temperature zero is not a measured-temperature claim.
- `/load/ram` must explicitly report a nonnegative byte count no greater than
  the reported RAM size.

Idle CPU or zero active RAM is a valid defined value. Empty bodies, null/missing
fields, rejected requests and unavailable inventory fail with a Setup recovery
instruction, not fabricated zero values. Failed upstream bodies are not echoed.
Existing Projects can retry `self-host setup dashdot`; unsupported configuration
requires restoring the Catalog CPU/RAM settings and restarting Dash. first.
There is no account creation or credential rotation.

## Native widgets and metric semantics

The integration is named `Dash. (kernel CPU/RAM)` to name the observed scope.
The System Resources widget enables only `visibleCharts: [cpu, memory]`, with
native `hasShadow: true` and `labelDisplayMode: textWithIcon` options. No machine,
volume or other identifier is guessed; both widgets bind Homarr's returned owned
integration ID.

The shared Stats widget adds only these upstream-defined entries:

| Key               | Unit    | Dash. / Homarr meaning                             |
| ----------------- | ------- | -------------------------------------------------- |
| `cpu`             | percent | Arithmetic mean of the returned per-core CPU loads |
| `memoryUsed`      | bytes   | Dash. `systeminformation.mem().active`             |
| `memoryAvailable` | bytes   | Reported total RAM minus that active RAM           |
| `uptime`          | seconds | Kernel-visible uptime returned by Dash.            |

These values describe the kernel visible to Dash., which may be a Docker VM or
virtualized `/proc`, not the person's physical computer or container resource
limits. Physical-host identity is not verified. Health Monitoring is not a
default: its Dash. adapter supplies unmeasured temperature and hardcoded
package/reboot values. Disk, GPU and network widgets are omitted; the current
profile has no static disk inventory and no authority for physical-host hardware.

After raw data validation, the Link queries authenticated
`widget.healthMonitoring.getSystemHealthStatus` with only its owned integration
ID. It requires exactly one matching result, no error, and explicitly defined
nonnegative CPU/RAM/uptime values with positive total memory. This is the native
data path used by System Resources, not an HTTP-200 or saved-tile check.

The descriptor's Stats callback validates the shared SDK's single sample after
catalog discovery and a forced refresh with an advancing timestamp. It requires
percent CPU in 0–100, integral nonnegative byte values, nonnegative uptime in
seconds, finite values and positive total memory. Defined zeros remain valid.
Native and Stats values are independently observed and need not be equal.

## Upstream limitation and security

Homarr v2.4.1's Dash. adapter always requests `/load/storage`, `/load/network`
and `/load/gpu` as well as CPU/RAM. Dash. v6.3.4's
`LazyObservable.getCurrentValue()` can invoke disabled collectors on an API
read; widget selection and disabled background collection do not restrict those
API-triggered reads. Hiding charts does not stop Homarr's requests. They remain
inside Dash.'s existing container access; no privileged mode, host mounts,
devices, namespaces or Docker socket are added. If a required native response
fails under this footprint, the Link fails instead of increasing authority.
Disabled storage inventory, unavailable GPU data and unmeasured temperature must
not be presented as healthy hardware or a complete host-monitoring result.

Dash. is unauthenticated: retain private Access and consider who can view its
kernel inventory. The existing read-only root filesystem and CPU/RAM Compose
settings are unchanged.

## Verification boundary

Focused tests cover explicit zero measurements, missing/unavailable data,
fresh probes, redacted rejection, unchanged Compose authority, exact empty
credential capability, native widget selections and owned-ID native results.
The shared reconciliation's existing tests cover its ownership behavior.

No Docker or browser run has been performed in this peer lane. Registration,
resolved image digests, real native data/rendering, freshness, restart, both
installation orders, late-peer readiness, removal/reinstallation and preservation
of user/shared resources still require the parent's approved disposable-Project
phase. This change is not full functional acceptance and must remain draft until
that phase passes. No physical-host, disk, GPU, network or temperature proof is
claimed.

## Sources

- [Homarr Dash. guide](https://homarr.dev/docs/integrations/dash-dot/)
- [Homarr integration definitions](https://github.com/homarr-labs/homarr/blob/ebbd4876d25a51151444a009ab596e1154d62880/packages/definitions/src/integration.ts)
- [Homarr native adapter](https://github.com/homarr-labs/homarr/blob/ebbd4876d25a51151444a009ab596e1154d62880/packages/integrations/src/dashdot/dashdot-integration.ts)
- [Homarr native query](https://github.com/homarr-labs/homarr/blob/ebbd4876d25a51151444a009ab596e1154d62880/packages/api/src/router/widgets/health-monitoring.ts)
- [Homarr System Resources options](https://github.com/homarr-labs/homarr/blob/ebbd4876d25a51151444a009ab596e1154d62880/packages/widgets/src/system-resources/index.ts)
- [Homarr Stats definitions](https://github.com/homarr-labs/homarr/blob/ebbd4876d25a51151444a009ab596e1154d62880/packages/integrations/src/stats/existing.ts)
- [Dash. API routes](https://github.com/MauriceNino/dashdot/blob/9d169fc77fefe6e50ce8a326584a8602588e6987/apps/server/src/index.ts)
- [Dash. dynamic collector behavior](https://github.com/MauriceNino/dashdot/blob/9d169fc77fefe6e50ce8a326584a8602588e6987/apps/server/src/dynamic-info.ts)
- [Dash. CPU data](https://github.com/MauriceNino/dashdot/blob/9d169fc77fefe6e50ce8a326584a8602588e6987/apps/server/src/data/cpu.ts)
- [Dash. RAM data](https://github.com/MauriceNino/dashdot/blob/9d169fc77fefe6e50ce8a326584a8602588e6987/apps/server/src/data/ram.ts)
