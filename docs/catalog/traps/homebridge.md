# Homebridge traps

## Pitfalls

- The official Docker Compose requires network_mode: host for HomeKit discovery and persists /homebridge. The private administration recipe deliberately omits host networking; successful login is not LAN discovery or pairing acceptance.
- The pinned first-admin adapter checkpoints before creation and never replays an ambiguous write. Its authenticated API credential is an expiring Bearer session, not a durable API key; tokens are not exported as keys.
- Fresh-instance setup, lost-response replay and restart persistence have not been verified against a live image.
- Third-party plugins have independent maintenance and privilege profiles.

## Security

- This recipe publishes administration on loopback and disables Avahi. Host networking for actual HomeKit discovery needs separate LAN exposure and port ownership approval.
- UI 5.29.0 creates its first administrator through a guarded setup wizard. Saved-password login and administrator readback must succeed before permitting LAN access or installing plugins.
