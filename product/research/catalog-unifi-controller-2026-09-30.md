# UniFi controller shared-Compose assessment

- Checked: 2026-09-30
- Decision: remove the app-picker manifest; do not add `recipe.json` or `setup.ts`. The catalog offers only Docker Compose apps, while the supported vendor server is installed on the host.
- Scope: official documentation review only. No installation, device adoption, or live API check.

## Primary evidence

| Topic | Official source | Finding |
| --- | --- | --- |
| Replacement and lifecycle | [Self-Hosting UniFi](https://help.ui.com/hc/en-us/articles/34210126298775-Self-Hosting-UniFi) | UniFi OS Server is the new self-hosting standard, replacing the legacy UniFi Network Server. The older Linux APT install remains documented as legacy. |
| Linux packaging | [Self-Hosting UniFi](https://help.ui.com/hc/en-us/articles/34210126298775-Self-Hosting-UniFi) | The vendor supplies a downloaded installer requiring systemd, Podman 4.9.3+, pasta networking, and slirp4netns. It is not a published, pinned vendor Compose image/topology. |
| First setup | [Self-Hosting UniFi](https://help.ui.com/hc/en-us/articles/34210126298775-Self-Hosting-UniFi) | Optional remote management needs a UI Account; device adoption follows installation. No supported headless first-administrator creation, cloud-account binding, or API-key export contract is given. |
| Network access | [Required Ports Reference](https://help.ui.com/hc/en-us/articles/218506997-Required-Ports-Reference) | Network device communication uses TCP 8080; STUN uses UDP 3478; same-VLAN discovery uses UDP 10001; administration/API uses a separate HTTPS port. Other features need additional ports. |
| Adoption | [Device Adoption](https://help.ui.com/hc/en-us/articles/360012622613-UniFi-Device-Adoption) and [Remote Adoption](https://help.ui.com/hc/en-us/articles/204909754-Remote-Adoption-Layer-3) | Same-VLAN discovery and routed adoption have different requirements. Routed adoption may require an inform URL and deliberate TCP 8080 reachability. HTTP health alone does not prove adoption. |

## Exact shared-recipe gap

The catalog's shared route requires a pinned Compose topology, a private default bind, and replay-safe headless setup and credential verification. Ubiquiti's current supported server path instead installs host services with Podman. The official guidance does not provide a vendor Compose image, image digest, mounts, runtime user, or an API contract for creating and verifying the first administrator or binding a cloud account. A legacy or community container would silently select a different lifecycle/support boundary. Publishing all adoption and administration ports by default would also change LAN authority without a scoped exposure decision.

Do not invent default credentials, treat a reachable login page as an accepted controller, or claim UniFi device adoption. A future catalog recipe needs a vendor-supported pinned Compose topology, exact administrator and optional cloud onboarding semantics, version-pinned replay behavior, and a reviewed network-access model for the actual adoption topology. A host-install workflow is outside this Compose-only product. Acceptance must separately check authenticated administration, a selected device's adoption state, and restart persistence. Homarr's independent integration catalog may still represent externally managed UniFi installations.
