# Changelog

All notable public changes are documented here. The project uses pack-level
semantic versioning; individual skills share the pack version.

## 1.1.1 - 2026-10-04

- Add a shared Compose control panel with app selection, scoped lifecycle,
  saved credentials, deterministic setup and optional Homarr publication.
- Check private GitHub releases on interactive launch and offer a verified
  global CLI update with Enter accepting the confirmation.
- Ship the standalone CLI tarball and its matching checksum privately on GitHub.
- Keep unverified integrations, external prerequisites and live acceptance
  gaps explicit; Frigate is omitted from the current acceptance run.

## 1.1.0 - 2026-09-25

- Add a standalone `self-host` CLI with catalog planning, resumable household
  bundles, private credential handoff, exact approvals, and scoped lifecycle.
- Add bounded media, Immich, Docmost, Vaultwarden, Homarr attachment, and
  private Caddy routes with explicit direct-acceptance checkpoints.
- Clarify composite planning and prepare the first npm CLI publication.

## 1.0.0 - 2026-09-24

- Make `self-host` explicitly invoked, with a single command route for Pi and
  OpenCode, native `$self-host` for Codex, and an optional Codex prompt bridge.
- Add a one-step installer that registers owned command files with copied
  skills and works from an extracted release ZIP.
- Establish the first public compatibility contract under Apache-2.0.
- Add an Agent Plugins 1.0 release manifest, Agent Skills-conformant flat
  discovery, Claude compatibility metadata, and checked installation for the
  common coding-agent set.
- Add registry schema v4 with skill kind, risk, activation, delegation, install
  groups, and checked sibling requirements.
- Add explicit setup and upkeep workflows with selectable Base, Pack, and
  Extension profiles plus resumable private stack metadata.
- Make the agent-browser skill, Bun CLI, and browser an agent-managed setup
  prerequisite.
- Add generated human and machine skill indexes.
- Add the `skillpack` inspect, validation, scenario, benchmark, and reproducible
  packaging interface.
- Add native Pi package metadata, Claude and Codex marketplace export, durable
  GitHub Release assets, and generated client-specific distribution branches.
- Run repository tooling as native TypeScript on Bun 1.4 with a typed,
  human-friendly `skillpack` CLI.
- Replace the pre-v1 media harness default with generated credentials and
  document the preserved-history rotation requirement.
- Keep media API keys, URLs, and usernames in private `connections.env`, never
  persist the initial admin password there, and display that password in the
  explicit final setup handoff.
- Preserve schema-v1 project and preference documents.
