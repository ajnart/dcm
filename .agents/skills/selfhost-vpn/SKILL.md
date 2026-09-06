---
name: selfhost-vpn
description: Optional downloader VPN extension. Plan and assess downloader-only VPN isolation. Use for Gluetun or WireGuard gateway topology, keeping management services outside the namespace, LAN control allowlists, opaque secret references, DNS or egress leak evidence, and a hard tunnel-break test. Produce a provider-neutral read-only plan for authorized content only.
license: Apache-2.0; see LICENSE.txt
compatibility: Requires Bun 1.4.0 or newer for the bundled planner; live tunnel testing is a separate approved verification step.
---

# Self-host VPN

Isolate the downloader's egress without moving the control plane. Treat tunnel health, leak resistance, and legal use as separate evidence.

## Workflow

1. Establish the downloader, selected Gluetun or WireGuard gateway mode, and the exact VPN scope. Keep Arr, Seerr, media servers, reverse proxies, dashboards, and host administration on their normal private network.
2. Invoke `selfhost-host` when the host, TUN support, existing gateway, bind addresses, or port ownership are unknown. Accept only bounded, redacted facts.
3. Read [topology.md](references/topology.md) before designing the namespace, WebUI publication, LAN allowlist, DNS, or secret boundaries.
4. Read [evidence-contract.md](references/evidence-contract.md) before recording or interpreting tunnel-health, tunnel-break, restoration, route, firewall, DNS, or optional legal peer evidence.
5. Run `scripts/plan-vpn.ts` with explicit JSON. Resolve every `conflict` and `blocked` gate. The planner performs no network request and cannot create evidence.
6. Present the provider-neutral plan. Obtain approval before an apply capability changes container namespaces, capabilities, devices, firewall rules, or service availability.
7. After apply, collect the evidence contract from the downloader namespace. Break the tunnel while leaving the downloader running; require external IP and DNS requests to fail closed; restore the tunnel; then rerun the planner with the recorded evidence.

## Run the planner

Resolve the script relative to this `SKILL.md`.

```bash
bun <skill-directory>/scripts/plan-vpn.ts --input vpn-input.json
bun <skill-directory>/scripts/plan-vpn.ts --json '{"schemaVersion":1,"service":{"id":"qbittorrent","class":"downloader","webUiPort":8080},"facts":{},"preferences":{"mode":"gluetun","scope":["qbittorrent"],"lanControlCidrs":["192.168.1.0/24"],"webUiBind":"127.0.0.1","secretRefs":["vpn.credentials"],"legalContentOnly":true}}'
```

Use `--json` only for non-secret input safe in a process argument. Supply opaque reference identifiers through `secretRefs`; resolve their payloads only at a later, private apply boundary.

## Hard boundaries

- Place only the downloader in the gateway network namespace. Publish the downloader WebUI on the gateway service, on a private bind, and allow only chosen LAN or loopback CIDRs.
- Give the gateway the minimum TUN and network-administration access required by its chosen implementation. Keep the downloader free of direct published ports and direct default egress.
- Keep the gateway firewall and kill switch enabled. Use a tunnel resolver and prove that DNS cannot fall back to the host when the tunnel is broken.
- Store WireGuard private keys, provider credentials, tunnel tokens, and forwarded-port values as secret references. Keep payloads out of input, output, Compose plans, logs, and screenshots.
- Keep provider selection user-chosen or pre-existing. Compare technical compatibility without affiliate or ranking bias.
- Limit any peer-level test to a user-approved, controlled, legal fixture. Network-level checks neither authorize nor require downloading media.

## Result contract

Return the planner JSON plus a concise explanation of topology, gates, conflicts, and evidence gaps. `verification.state: network-verified` is allowed only when the observed namespace and firewall topology, healthy baseline, recorded tunnel-break fail-closed result, restored tunnel, and route audit all pass. The claim covers the recorded downloader egress boundary, not anonymity, provider trustworthiness, legal advice, or future behavior.

## Completion criteria

Planning is complete when the VPN scope contains only the downloader; WebUI control has an explicit private bind and allowlist; secret purposes have references without values; the desired namespace has no direct downloader ports or fallback route; legal-content scope is explicit; leak evidence is either fully recorded or visibly blocked; and no safe or verified claim appears without a timestamped tunnel-break result proving external IP and DNS failure while the downloader stayed running.
