# ADR 0002: Separate discovery, guidance, and managed automation

Status: accepted on 2026-08-28

## Context

Self-hosted applications differ widely in lifecycle, licensing, hardware,
storage, and deployment quality. A popular app or a Homarr integration does
not prove that this repository can deploy, upgrade, back up, and restore it.
The router also needs to reuse existing infrastructure without silently taking
ownership of it.

## Decision

Every app and stack declares one automation support level: `managed`,
`guided`, `discovery`, or `retired`. Managed support requires a versioned
adapter, deterministic rendering, focused preflight, idempotent apply,
acceptance checks, and rollback. Guided support requires current primary
sources and explicit safety gates. Discovery support makes no deployment
promise. Retired records route only to migration or alternatives.

All mutations follow inspect -> plan -> approval -> apply -> verify. Public
exposure, destructive work, VPN routing, privilege expansion, and forward-only
schema migration are separate approval gates. Secrets are represented only by
references until the narrow apply step.

## Consequences

- Catalog breadth can grow without overstating automation quality.
- A failed or ambiguous gate returns `blocked` or `conflict`, never a guessed
  success.
- Existing proxies, networks, paths, and services remain external until their
  ownership contract is confirmed.
- Support promotion is evidence-based and reversible.
