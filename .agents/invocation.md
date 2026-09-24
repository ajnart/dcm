# Invocation and context loading

Use `self-host` for planning, setup, and upkeep. The public entry reads one
selected workflow from its bundled `workflows/` directory and follows that
workflow's links only as needed. The user does not invoke internal owners. Pi users can invoke it with `/skill:self-host` or `/skill:self-host <goal>`.

The client slash-command template is a thin entry into the same skill.
Pi and OpenCode expose it as `/self-host`; Codex CLI and IDE expose it as the
deprecated `/prompts:self-host` custom prompt. Installation and reload steps
are in `.agents/install.md` (source) or `INSTALL.md` (release). The command
does not own a second workflow or relax any approval gate.

The repository installer registers Pi and OpenCode commands alongside the
skill. Codex uses its native `$self-host` entry unless the optional deprecated
global prompt bridge is requested. All three receive the same command
arguments and route through the public skill.

Skill discovery normally loads names and descriptions, not every full skill.
Invocation loads `SKILL.md`. Supporting files cost context when read; scripts
can run without loading their source. Keep these costs separate from package
size. A large catalog on disk is fine; dumping it into each conversation is not.

## Selecting a workflow

- A new app or replacement goal loads `selfhost-setup/GUIDE.md`.
- An existing stack request loads `selfhost-upkeep/GUIDE.md`.
- Plan-only, comparison, or unresolved intent loads `selfhost/GUIDE.md`.

Resolve these paths under the installed `self-host/workflows/` directory.
An internal ID such as `selfhost-compose` is a stable ownership label and
reference path, not a separately installed skill. Read its guide before using
its helpers. For app lookup use catalog `search`/`show`; read only selected
service recipes, not the whole catalog or every guide.

A separate skill is appropriate when users independently invoke a task with
its own scope and useful trigger. Split for that reason, not for every internal
step. The current workflows all participate in the same self-host lifecycle,
so one self-contained install avoids missing-sibling problems across clients.

## Intake and execution

Follow the selected workflow and its
[conversation contract](skills/self-host/workflows/selfhost/references/conversation.md).
Ask only for unresolved choices: purpose, target host and project, selected
services, relevant storage, access, username, required email, and optional
backup/VPN choices. “Defaults” accepts a recommendation, not new services or
unreviewed destructive operations. Explain what each app does and include Homarr.

Inspect → plan → approval → apply → verify. Existing `.selfhost` records describe
intent; refresh actual host and service evidence before resuming. Mutation stays
within the exact approved owner's project. Public access, destructive changes,
VPN routing, and restores retain their own gates and evidence requirements.

Ask for usernames, not passwords. Generate credentials or resolve private
references through the owning helper. Requested credential exports use the
private handoff file; report its path without printing secret values. Upkeep
re-exports only when requested.

## Access and completion

Choose access from the user's actual devices; see
[access choices](skills/self-host/references/access.md). Homarr links must resolve
from that location. Container network URLs are for integrations, and host
loopback URLs are for local automation; neither substitutes for user access.
Homarr is the dashboard, not an automatic reverse proxy for every linked app.

The default Homarr MCP profile is read-only. Bounded integration requests require
an explicit policy for integration IDs, paths, and methods. Client configuration
contains secret references rather than keys.

Finish with the selected goal, apps and purposes, actual changes, verification,
working access links, saved artifact paths, and blockers. A plan, running
container, generated password, or partial handoff does not prove completed setup.

Design references: [Agent Skills progressive disclosure](https://agentskills.io/specification#progressive-disclosure) and
[Anthropic skill-creator](https://github.com/anthropics/skills/blob/main/skills/skill-creator/SKILL.md).
