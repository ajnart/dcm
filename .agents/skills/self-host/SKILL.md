---
name: self-host
description: User-invoked command to plan, install, or maintain self-hosted apps from names or replacement goals, with Homarr and private credential handoff.
disable-model-invocation: true
license: Apache-2.0; see LICENSE.txt
compatibility: Requires Git and Bun 1.4.0 or newer; deployment needs the selected runtime, and browser fallback needs agent-browser.
metadata:
  selfhost-activation: explicit
  opencode/autoinvoke: "false"
  opencode/slash: "false"
---

# Self-host

Route the command's arguments before loading a workflow:

| Input | Route |
| --- | --- |
| No app or goal | Ask what the user wants to do or replace; offer a few examples |
| `plan <goal>` or `compare <goal>` | Planning |
| `install <app or goal>` or a named app/replacement goal | Setup |
| `status`, `verify`, `add`, `update`, or `repair` | Upkeep |

The command expresses intent, not approval to change a host. Recommend only
services that serve the stated goal, explaining each in plain language. For a
new setup, preserve the requested goal and ask whether the user wants the
**New** or **Advanced** path when `onboarding.experience` is not already saved.
Read the [conversation contract](workflows/selfhost/references/conversation.md)
for the resulting Homarr and follow-up behavior. Ask one compact question at a
time, skip answers already supplied, and accept `defaults` for the recommended
non-secret choices.

Use the fixed `$HOME/.selfhostedskills` project root without asking for a
directory. Check only its `.selfhost/stack.json`, then read **one** workflow:

| Request | Read |
| --- | --- |
| New install or replacement goal | [Setup](workflows/selfhost-setup/GUIDE.md) |
| Existing stack request | [Upkeep](workflows/selfhost-upkeep/GUIDE.md) |
| Plan or compare | [Planning](workflows/selfhost/GUIDE.md) |

Read [service choices](references/choosing-services.md) when explaining replacements,
and [access choices](references/access.md) when choosing local, LAN, or remote access.

Internal names such as `selfhost-compose` mean bundled workflows:
`workflows/<name>/GUIDE.md`. Read their linked references only when needed;
run helpers by absolute path. They are ordinary files, not additional skills
to install or ask the user to invoke. Search the selected workflow or query
the catalog CLI instead of loading every guide or catalog record.

Follow inspect → plan → approval → apply → verify. Confirm the username
(`admin` for managed media when the user accepts defaults) and whether to generate a password
(recommended) or use a supported private credential source. Never collect
password values in chat. Generate and save credentials through the owning
helper; provide only the private handoff path in normal reports. `defaults`
never approves deployment, public access, or destructive work.

Continue through the selected workflow's completion criteria. End with what
changed, verified access links, saved artifact paths, and any concrete blockers.
