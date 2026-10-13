# Tdarr Link: source-only normalization (#349)

The original `feat/homarr-tdarr-sol` branch forward-merges shared SDK
`0bf67c3c64c229af25f19c1b93264f19cc57a910`, preserving its history. The peer owns
`tdarrTarget`, `verifyTdarr` and `verifyTdarrStats`; registry assembly and common
ownership remain with the reference custodian.

The actual Homarr image source at
`3d4150e59f600876b7e308f857b2f21572b75348` was inspected locally, read-only:
`packages/integrations/src/media-transcoding/tdarr-integration.ts`,
`packages/api/src/router/widgets/media-transcoding.ts` and
`packages/integrations/src/stats/existing.ts`. The legacy provider exposes
`totalFileCount`, `totalTranscodeCount` and `failedTranscodeCount`, all `count`.

The native verifier retains fresh App version, owned seeded-key and anonymous
rejection checks, positive server readiness, actual connected/unpaused nodes,
queue pagination, statistics/chart shapes, workers and nullable worker sizes.
A missing or paused node remains Manual with the existing recovery hints. A
connected node with no workers can verify monitoring of empty data, without
processing or hardware acceptance. The integration uses API port **8266**;
**8265** remains the browser UI port. Common ownership must preserve these
separate destinations when creating or repairing the linked App tile.

The leaf no longer transports its own Stats refresh. The shared SDK reads the
catalog and one forced, advancing successful non-stale snapshot, then passes
that same sample to `verifyTdarrStats`. The callback requires count units and
nonnegative integral values, accepts explicit zeros, preserves the integral
millisecond timestamp rule, and retains the original five-minute stale and
one-minute future limits relative to refresh completion. Native widget counts
can differ from this separately cached Stats sample; no equality or retry with
a different sample is introduced.

Focused HTTP fixtures exercise the actual descriptor `verifyData` boundary,
including valid empty monitoring data, changing native/Stats counts, one forced
refresh, missing/null/fractional/negative metrics, wrong units, no-op refreshes,
clock bounds and slow refresh completion, rejected keys, owned integration
identity and Manual node prerequisites. Affected App checks and package
build/vet are source validation only.

Native/rendered acceptance, registered lifecycle preservation, both installation
orders, credential recovery and independent review remain pending. No Docker,
browser, private files, host changes, node connection or processing was performed.
No license, GPU, media library or transcode claim follows from these fixtures.
