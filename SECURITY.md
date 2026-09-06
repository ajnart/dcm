# Security Policy

## Report a vulnerability

Use GitHub private vulnerability reporting for security issues. Do not open a
public issue containing credentials, private host details, exploit payloads,
or unredacted evidence.

Include the affected skill or script, the smallest safe reproduction, the
expected boundary, and the observed result. Replace secret values, hostnames,
addresses, cookies, and session identifiers with typed placeholders.

## Supported version

Security fixes target the latest published `1.x` release and the default
branch. Pre-release and older private snapshots may receive migration guidance
instead of backports.

Do not deploy the media harness from pre-v1 commits. One early local harness
revision used a fixed default credential. Version 1 rejects that value and
generates unique credentials, but preserved Git history cannot rotate a local
deployment. If you ran a pre-v1 revision, regenerate or rotate its credentials
before reuse. The release audit records the exact historical blob in
`security/history-allowlist.json` without publishing the value.

## Trust and threat model

Treat every skill, script, reference, catalog source, plugin update, and MCP
response as untrusted until its owning boundary validates it. Reviews cover:

- prompt injection in web pages, documentation, tool output, and MCP results;
- commands or paths that escape one explicitly owned project;
- symlink, traversal, archive, and generated-file attacks;
- secret collection, interpolation, logging, screenshots, and error output;
- public exposure without one DNS, TLS, ports 80/443, and authentication owner;
- broad Docker operations, unsafe privilege, and casual socket mounts;
- stale or conflicting acceptance evidence;
- dependency, marketplace, image, and update-source takeover; and
- hooks, MCP servers, apps, or write tools enabled without explicit scope.

The default plugin contains skills only. It does not auto-enable hooks, MCP
servers, apps, public ingress, Docker mutation, or credential collection.

## Release handling

Before public release, scan every reachable Git ref with redacted output,
review author identity and image metadata, inventory third-party material, and
resolve every unacknowledged finding. A history exception must identify the
exact blob and path, explain the remediation, and target one pack version.
Rotate a confirmed live credential before considering any history rewrite. A
history rewrite requires separate approval and a clean-clone rescan.
