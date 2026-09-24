---
name: self-host
description: Set up or maintain self-hosted apps from names or replacement goals, with Homarr, service wiring, and private credential handoff.
license: Apache-2.0; see LICENSE.txt
compatibility: Requires Git and Bun 1.4.0 or newer; deployment also needs Docker and agent-browser.
---

# Self-host

Explain the proposed apps in plain language. Include Homarr as the dashboard
for opening apps and seeing connected services. A named app selects that app,
its dependencies, and Homarr; optional services need a user choice.

Confirm the target host and project directory. Check only that directory for
`.selfhost/stack.json`, then read **one** workflow:

| Request | Read |
| --- | --- |
| New install, `/self-host SERVICE`, or replacement goal | [Setup](workflows/selfhost-setup/GUIDE.md) |
| Status, extend, update, repair, or verify an existing stack | [Upkeep](workflows/selfhost-upkeep/GUIDE.md) |
| Plan only, compare, or undecided | [Planning](workflows/selfhost/GUIDE.md) |

Read [service choices](references/choosing-services.md) when explaining replacements,
and [access choices](references/access.md) when choosing local, LAN, or remote access.

Internal names such as `selfhost-compose` mean bundled workflows:
`workflows/<name>/GUIDE.md`. Read their linked references only when needed;
run helpers by absolute path. They are ordinary files, not additional skills
to install or ask the user to invoke. Search the selected workflow or query
the catalog CLI instead of loading every guide or catalog record.

Follow inspect → plan → approval → apply → verify. Ask for the username;
generate passwords through the owning helper. Keep credentials out of chat
and normal reports; provide the private handoff path when requested.

Continue through the selected workflow's completion criteria. End with what
changed, verified access links, saved artifact paths, and any concrete blockers.
