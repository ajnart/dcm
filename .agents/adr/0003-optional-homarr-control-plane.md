# ADR 0003: Position Homarr as an optional control plane

Status: accepted on 2026-08-29

## Context

Homarr can unify navigation, widgets, integrations, and an agent-facing MCP
endpoint for many self-hosted services. That makes it a strong product
differentiator and a useful front door. Requiring it would undermine the
composable architecture and make otherwise independent services depend on one
dashboard.

The current packaged MCP bridge exposes a deliberately read-only projection.
It can inspect integrations and search Seerr, but it cannot submit requests or
change connected applications.

## Decision

Recommend Homarr prominently as an optional control plane when a curated stack
defines that role. Label dedicated integrations separately from app-links-only
coverage. Never auto-select it as an enhancement, make it a
dependency of another base stack, or treat its selection as approval for
public access. An explicit `homarr-control-plane` goal selects Homarr because
Homarr itself is the requested outcome.

Allow plans to expose Homarr's dashboard and consumer-facing applications such
as Jellyfin while keeping administrative services and native `/api/mcp` access
private. Any public route still belongs to the ingress capability and requires
explicit DNS, TLS, ports 80/443, and authentication decisions.

Keep the shipped MCP bridge read-only. A future write capability must define a
narrow tool allowlist, explicit confirmation and authorization, secret
handling, failure behavior, and acceptance evidence as a separate contract.
The managed seven-service media harness remains an explicitly
Homarr-enhanced adapter rather than the generic definition of a media stack.

## Consequences

- Homarr remains prominent without constraining app selection.
- Users can choose one private dashboard and agent endpoint instead of exposing
  every administrative UI.
- Declining Homarr does not block the underlying stack.
- Dashboard access, MCP access, public exposure, and mutation authority remain
  separate decisions and acceptance claims.
