# Dashdot shared-Compose research

- Checked at: 2026-09-29
- Status: blocked for a shared recipe
- Browser session: not used; public official pages checked through web search
- Domain allowlist: `getdashdot.com`, `github.com/MauriceNino/dashdot`, `hub.docker.com/r/mauricenino/dashdot`

## Question and evidence

Can Dashdot have a truthful v2 shared-Compose recipe and deterministic no-account setup?

| Role | Source | Finding |
| --- | --- | --- |
| Official install | https://getdashdot.com/docs/installation/docker-compose | The documented service uses `mauricenino/dashdot:latest`, `privileged: true`, port 3001, and a read-only host-root mount at `/mnt/host`. |
| Official configuration | https://getdashdot.com/docs/configuration/basic | The Express server and frontend share default port 3001. |
| Official release | https://github.com/MauriceNino/dashdot/releases | v6.3.4 is the latest listed release (2026-03-03). |
| Upstream-publisher image | https://hub.docker.com/r/mauricenino/dashdot/tags | The `6.3.4` tag exists for amd64 and arm64. This confirms the tag, not a digest or runtime behavior. |

## Compose contract and decision

The safe candidate would need a pinned `mauricenino/dashdot:6.3.4` image, private loopback publication of container port 3001, a read-only bind of the exact host root to `/mnt/host`, and `privileged: true`. The current v2 recipe schema and compiler cannot encode `privileged: true`. Publishing a recipe without it would misrepresent host-monitoring capability. No `recipe.json` or `setup.ts` was added. A no-account endpoint probe is premature until the deployment contract is expressible; a successful page request alone would not validate host metrics.

## Safety and limitations

- Privileged mode and host-root visibility need an explicit review and approval boundary, not an implicit shared-app default.
- The official example uses a floating tag and a publicly bound host port; neither should be copied as a safe default.
- No Docker, browser, endpoint, fresh-instance, restart, or host-metric verification was performed. No browser state or credentials were used or retained; redaction count: 0.
- Official URLs were discoverable and their content inspected via public search, but no status-aware browser link-envelope validation was performed.

## Next step

If privileged host monitoring is accepted as a product capability, extend the v2 schema, compiler, approval summary, and privilege gate in their owning modules, then revisit a Dashdot recipe and a metrics-specific acceptance adapter. Until then Dashdot remains guided, without shared apply support.
