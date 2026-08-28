# ADR 0001: Use a flat capability skill pack with a declarative core

Status: accepted on 2026-08-28

## Context

The repository began as a deeply validated seven-service media experiment.
The product goal now spans many self-hosting outcomes, existing hosts, partial
installs, and future apps. A single huge skill would overload discovery and
couple unrelated operational risks. One skill per app would duplicate Docker,
storage, ingress, backup, and validation logic.

The current Agent Skills installer discovers `.agents/skills`, supports private
repositories, and installs each skill directory independently.

## Decision

Use flat, namespaced skill directories under `.agents/skills/selfhost-*`.
`selfhost` is the intent router and owns a declarative JSON catalog of goals,
stacks, roles, apps, sources, lifecycle, and support levels. Model-invoked
capability skills implement cross-cutting operations. App-specific adapters are
reserved for behavior that cannot be expressed safely as catalog data.

Every runtime dependency required after installation is packaged inside the
owning skill directory. Root scripts may be compatibility wrappers, not an
independent implementation.

## Consequences

- `/selfhost` can route broad goals without loading every service runbook.
- Users can install the full pack or a documented subset.
- New apps normally require catalog data, not a new skill.
- Special stacks can be managed without making generic capabilities media-
  specific.
- Shared contracts must be explicit because installed skills are independent
  directories.
- Catalog and package validators become required release gates.
