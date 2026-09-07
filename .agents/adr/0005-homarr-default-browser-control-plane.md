# ADR 0005: Make Homarr the default browser-configured control plane

Status: accepted on 2026-09-07

## Context

Homarr is the intended front door for every stack: it provides private app
links, supported integration widgets, and the read-only agent MCP surface. The
previous optional-role model duplicated Homarr choices across stack records and
made plans omit the project's standard access path.

The media harness also needs service API keys during Homarr onboarding. Those
keys exist in service settings UIs, while Homarr stores Docker-internal base
URLs that the host browser cannot resolve. Copying values through chat,
clipboard files, shell arguments, or visible terminal output violates the
secret boundary.

## Decision

Inject one required Homarr control-plane role from the catalog taxonomy into
every plan. Install `selfhost-homarr` in the base profile. Keep Homarr separate
from each application's runtime dependencies so an unavailable dashboard does
not stop the underlying service.

Make agent-browser the primary setup path. Navigate to each run-scoped host URL
at the checked upstream settings suffix, capture its fresh input ref privately,
and fill the Homarr integration through a fresh ref. The media helper validates
Arr and Seerr values against managed run state, stores Homarr's one-time API key
inside the private run, suppresses browser output, and emits only fixed status
lines. Docker URLs remain base URLs inside Homarr.

Public exposure, connected-app mutation, and MCP writes remain separate and
unapproved. The shipped MCP bridge stays read-only.

## Consequences

- Every plan has one consistent private dashboard and agent access surface.
- Individual stack records no longer repeat an optional Homarr role.
- Browser setup can retrieve and apply API keys without surfacing them.
- Homarr failures do not become application runtime failures.
- Agent-browser routes require periodic upstream verification.
