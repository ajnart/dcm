# Generation 4 - composable skill pack and UI acceptance

Status: **COMPLETE — supervisor validated 2026-08-28.**

## Hypothesis

The promoted media survivor can become one member of a larger self-hosting
skill pack without losing its exact runtime contract. A private one-command
install should preserve every nested harness asset, while the broader router
can compose host, Compose, ingress, VPN, backup, observation, operations,
research, Homarr, and verification capabilities around it.

## Original Generation 4 checkpoint

These values preserve the supervisor-validated 2026-08-28 checkpoint rather
than silently rewriting its historical evidence:

| Gate | Result |
| --- | --- |
| Canonical skill packages | PASS — 12 |
| Declarative application catalog | PASS — 107 apps, 13 stacks |
| Skill registry | PASS — 12 packages, 2 adapters |
| Homarr coverage | PASS — 54 standard integrations, 2 special surfaces |
| Static repository validator | PASS — 11/11 groups |
| Local installer smoke | PASS — symlink and copy layouts |
| Private remote installer | PASS — 12 Codex skills and 12 Claude Code links |
| Media bundle drift check | PASS — 31 packaged files |

## Post-audit source checkpoint

Focused repository-only validation on 2026-08-29 records the current source
state separately:

| Gate | Result |
| --- | --- |
| Static repository validator | PASS — 12/12 groups |
| Media bundle integrity | PASS — 34 packaged files |

This post-audit checkpoint did not rerun the installer, Docker, a browser, or
the surviving Generation 2 sessions. The original live-install and UI evidence
above remains historical rather than newly reverified.

The audited private install command was:

```bash
npx skills@latest add ajnart/selfhost-skills --skill '*' --agent codex --agent claude-code --yes
```

It cloned the private repository, discovered exactly 12 skills, installed the
canonical trees under `.agents/skills`, created exactly 12 Claude Code links,
and retained the nested media Compose file and Homarr MCP bridge. The
disposable install directory was removed after verification.

## Surviving stack verification

Root repeated the secret-safe core verifier, Homarr finalizer, and read-only MCP
verifier against both surviving Generation 2 runs. Both candidates passed
qBittorrent categories, Sonarr and Radarr roots and clients, Prowlarr apps and a
public indexer, all six Homarr links, canonical MCP authentication, the exact
Date-schema fallback, stdio bridge negotiation, linked Seerr permissions, and
the Spider-Man search. Both Homarr containers used
`ghcr.io/homarr-labs/homarr-test:v2` and resolved to the same image digest.

An independent Luna MAX agent then used a fresh isolated agent-browser session
against `luna-g2-a`. In 39 browser actions it confirmed exactly six generated
tiles and six management integrations: Jellyfin, Prowlarr, qBittorrent, Radarr,
Seerr, and Sonarr. Every tile showed a green status indicator, navigation stayed
on the expected origin, and zero-count widgets exposed explicit valid empty
states. The session was closed after the audit.

No verification in this generation created a Seerr media request, started a
download, changed Docker state, or exposed a stored credential. The installed
Homarr bridge therefore remains read-only by default.

## Promoted genome

- Keep app metadata, goal stacks, skill dependencies, and adapters declarative.
- Treat ambiguous goals such as bare `VPN` as blocking choices instead of
  silently selecting remote access or downloader privacy.
- Install only the intended agent targets; the CLI's `--all` flag fans out to
  every supported agent target.
- Preserve installed-skill portability with a manifest-backed media bundle and
  no dependency on this repository's checkout path.
- Keep the native Homarr endpoint authoritative and make compatibility or
  schema fallbacks explicit in evidence.
- Require a separate, deliberate approval boundary for any future bridge that
  can submit a media request.
