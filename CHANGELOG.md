# Changelog

All notable public changes are documented here. The project uses pack-level
semantic versioning; individual skills share the pack version.

## 1.0.0 - 2026-09-24

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
