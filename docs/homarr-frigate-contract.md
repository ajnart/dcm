# Frigate Homarr Link

This peer follows the [shared Link contract](homarr-integration-contract.md).
The descriptor is `frigateTarget()` in
`internal/apps/homarr/target_frigate.go`; registration and common reconciliation
belong to the reference lane.

## Source contract

Homarr image tag `v2.4.1`, source
`ebbd4876d25a51151444a009ab596e1154d62880`, declares kind `frigate` with only
`["username", "password"]`. Its adapter requires HTTPS and uses
`POST /api/login`, exactly one default `frigate_token` JWT cookie, then a
Bearer-authenticated `/api/profile` for the same username, role `admin`, and
an `allowed_cameras` array. An empty credential array and viewer credentials
are unsupported. The shared Admin login is reused; no durable API key or
additional account is created.

Frigate image tag `0.18.0` resolves in source to
`77a66e75c61862b048a07c1295877f4b31343504`. Setup and Check freshly reject
anonymous profile success, verify the exact administrator, and validate
`/api/stats` camera keys plus `service.uptime` and `service.version`.
Missing fields, redirects, rejected credentials and other API versions fail.
Zero cameras and zero uptime remain valid. Known-good credentials are reused.
A password-write checkpoint prevents repeating an uncertain first-user
rotation; retrying with a verified saved Admin login clears that checkpoint.
Existing or ambiguous accounts require private recovery and another
`self-host setup frigate`; no reset is triggered.

## HTTPS prerequisite

The internal integration Address is `https://frigate:8971`, separately from
the person's browser Address. The current read-only camera-free bootstrap
serves authenticated HTTP on 8971 and is intentionally unchanged. Its Homarr
preflight must remain an actionable Manual step before creating resources.
The descriptor wires the reference-owned preflight seam from commit
`dce263ef822dc056558a648f8f59ea795a3e56d9`. Both the existing-Link check and
creation probe afresh before Homarr requests or mutations; removal and absence
are ungated. Registry registration is still reference-owned and pending.
Without registration and live proof, this is not an enabled or accepted Link.

Approve a Project-scoped TLS configuration and certificate trust separately.
Certificates must cover the internal Compose service name for Homarr and the
CLI's verification Address. The CLI can recognize an already-enabled TLS
listener after its plain-HTTP rejection, but never changes the listener,
disables certificate verification, follows a credential redirect, publishes
port 5000 or switches to that unauthenticated port. Do not edit a shadow
configuration that is overridden by the current read-only Compose mount.

## Native data and widgets

Only one shared native `stats` widget binding is supplied, with metric keys
`cameras`, `uptime`, and `version`. They mean the number of camera keys returned
by `/api/stats`, service uptime in seconds, and the returned version text.
No dedicated Frigate widget exists in this contract. No camera identifier is
invented, and no feed, image, detector or hardware-dependent widget is added.

Verification reads `widget.stats.snapshot`, forces `widget.stats.refresh`,
requires a newer update time with `error=false` and `stale=false`, and checks
the resulting camera count, nonnegative uptime and matching version. It does
not accept a preserved snapshot after a failed or skipped refresh. The shared
ownership policy preserves user resources and other Apps' Stats entries.
The upstream Stats options permit 100 entries; this descriptor contributes
three, with deterministic IDs supplied by the shared implementation.

## Acceptance remaining

The existing focused Frigate and Homarr tests cover the revised API fixture
and reference behavior; no new test files or dependencies were added.
The full local gate passed: `gofmt -l .` was empty, `go build ./...`,
`go vet ./...`, `go vet -tags e2e ./e2e/`, `go test ./...`, the TUI/Activity
and Frigate/Homarr race checks, and `bash -n install.sh` all succeeded with
`GOFLAGS=-buildvcs=false`.
Source verification is not live acceptance. Registration, both installation
orders, restart/retry, credential changes, removal and
reinstallation need the parent-scheduled disposable Project runtime.
Record actual image digests and rendered native Stats results there.
No Docker, browser, installer, personal Project, private footage, new camera
input or GPU/TPU access was used for this implementation. Camera recording,
detection and hardware acceptance remain unavailable and are not required for
these service-level statistics. First-user runtime proof must also establish
the private bootstrap log's current-start provenance without publishing it.

## Official sources

- [Homarr Frigate guide](https://homarr.dev/docs/integrations/frigate/)
- [Pinned kinds and credentials](https://github.com/homarr-labs/homarr/blob/ebbd4876d25a51151444a009ab596e1154d62880/packages/definitions/src/integration.ts)
- [Pinned authenticated Frigate Stats provider](https://github.com/homarr-labs/homarr/blob/ebbd4876d25a51151444a009ab596e1154d62880/packages/integrations/src/stats/providers/frigate.ts)
- [Pinned Stats API](https://github.com/homarr-labs/homarr/blob/ebbd4876d25a51151444a009ab596e1154d62880/packages/api/src/router/widgets/stats.ts)
- [Pinned Stats refresh behavior](https://github.com/homarr-labs/homarr/blob/ebbd4876d25a51151444a009ab596e1154d62880/packages/request-handler/src/stats.ts)
- [Pinned Stats entry schema](https://github.com/homarr-labs/homarr/blob/ebbd4876d25a51151444a009ab596e1154d62880/packages/widgets/src/stats/config.ts)
- [Frigate 0.18 authentication API](https://github.com/blakeblackshear/frigate/blob/77a66e75c61862b048a07c1295877f4b31343504/frigate/api/auth.py)
- [Frigate 0.18 statistics API](https://github.com/blakeblackshear/frigate/blob/77a66e75c61862b048a07c1295877f4b31343504/frigate/api/app.py)


## Shared Stats SDK normalization, source and focused HTTP evidence

The original branch history is preserved by forward merges of shared SDK
`0bf67c3c64c229af25f19c1b93264f19cc57a910` and additive metadata SDK
`d069339add5924f942ea6536f77d68e64b165df0`. No registry or common verification
implementation is changed by this peer.

The descriptor now uses a pure `statsSample` callback for `cameras`, `uptime`, `version`.
One common catalog/snapshot/forced-refresh sequence supplies the same values
validated by the leaf. Exact catalog units and value types are checked: camera count, seconds and text.
Missing/null fields, invalid counts/units and no-op refreshes fail; legitimate
zeros remain valid. Common timestamp validation remains finite, positive and
advancing; this peer adds no invented clock policy.

Authenticated Frigate profile and native statistics verification remain in the leaf verifier. The duplicated leaf snapshot/refresh was removed. The Stats callback checks a finite nonnegative integer camera count, finite nonnegative uptime, and the owner-supported 0.18.0 version family; it does not equate independently acquired camera counts/version strings.

Units and selected provider keys were checked in immutable Homarr OCI source
`3d4150e59f600876b7e308f857b2f21572b75348`, using
`packages/integrations/src/stats/existing.ts` and, for Frigate,
`packages/integrations/src/stats/providers/frigate.ts`. This is source provenance,
not new image attestation.

Focused HTTP scenarios use the shared `statsFixture` through `verifyData`, with
the native verifier explicitly isolated, and assert one forced refresh for the
owned integration. They cover valid empty/populated samples, invalid selected
values/units and refresh no-op rejection. App and Homarr affected-package tests,
affected-package build/vet, changed-file gofmt and `git diff --check` passed.
No Docker, browser, installer or broad suite was run. These fixtures verify the
source interface; they do not claim real native/rendered acceptance.

#331 remains draft and #277 remains on Manual hold. Trusted HTTPS, certificate trust and separately approved genuine camera/configuration prerequisites remain unmet for acceptance. Camera-free statistics are structurally valid source data, not useful camera acceptance. Diagnostic #355 is not acceptance; no fake camera or bypass is introduced.
