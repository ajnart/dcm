# Homebridge shared-setup assessment — 2026-09-30

Decision: retain discovery support. Do not add a shared Compose recipe or first-run adapter yet.

## Source-backed facts

- The upstream `2026-09-25` release exists and lists Homebridge UI 5.29.0 and Homebridge 2.4.0: https://github.com/homebridge/docker-homebridge/releases/tag/2026-09-25
- The official Docker Compose example uses `network_mode: host` and persists `/homebridge`; its configuration reference calls host networking required for HomeKit discovery: https://github.com/homebridge/docker-homebridge/blob/latest/README.md
- The official Docker guide likewise uses host networking and identifies UI port 8581 on the server IP: https://github.com/homebridge/homebridge/wiki/Install-Homebridge-on-Docker
- The UI project says its REST API is documented at `/swagger` on a running instance, but the public API-reference page does not provide a version-pinned first-login password-rotation contract: https://github.com/homebridge/homebridge-config-ui-x/wiki/API-Reference

## Blocking boundaries

The shared recipe compiler's private loopback port publishing cannot reproduce the upstream-required host-network discovery contract. Host networking would also expose the UI on the host, requiring a separate LAN/port/security review, not an implicit private shared apply. A container that merely starts or returns HTTP 200 would not prove HomeKit pairing.

The existing manifest warns of the default UI credential. Without a pinned, source-backed route for first-login rotation and authenticated replay verification, a deterministic adapter would either leave a known credential active or guess at a mutation. No API key creation route is established here. Keep the manifest's discovery status and do not advertise a handoff or managed onboarding.

## To unblock

Add an explicitly approved host-network deployment model with exact exposure and port ownership checks, then establish the pinned UI's initial-login, password-change, authenticated readback, and lost-response replay semantics from upstream source or a version-matched API contract. Validate on a fresh instance and verify HomeKit pairing separately from service health.
