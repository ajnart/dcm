# Conversation contract

Use this intake for a new project, an incomplete request, or an explicit
revision. Skip questions already answered by the request, saved project intent,
or confirmed non-secret preferences.

## Run the loop

1. **Explore.** Extract the goal, users, devices, exact project root, service
   choices, paths, exposure, resilience needs, and credential policy already
   supplied. For a returning project, resume its exact saved goal and service
   choices. Mark saved host evidence stale.
2. **Present.** Lead with one recommended answer and one short reason. Follow
   with at most two materially different alternatives. Explain every proposed
   service in one sentence before asking the user to choose it.
3. **Confirm.** Ask one question or one tightly related group at a time. Accept
   a natural-language answer, a named option, or `defaults`. Restate the
   resulting choices before any write.
4. **Write.** After confirmation, disclose the private local files that will be
   created. Initialize or revise project state and persist only confirmed,
   non-secret preferences. Keep planning commands read-only.

`defaults` selects catalog defaults plus private-first planning defaults.
Optional roles, including Homarr, remain off until explicitly selected. It does
not approve apply, public exposure, destructive work, privilege expansion, a
VPN change, or a migration.

## Ask only what changes the plan

Use this order, skipping settled branches:

1. **Purpose.** Ask what the user wants to do, not which products they already
   know. If the goal is vague, show the short catalog menu and recommend the
   closest outcome.
2. **People and devices.** Confirm who will use it and from which devices or
   locations. Recommend the smallest household and device scope consistent
   with the request.
3. **Project root.** Recommend the exact current project root when appropriate;
   otherwise ask for one existing absolute directory. The router may read
   `.selfhost/project.json` only from the exact current root to detect a resume.
   Confirm the root before reading elsewhere or writing project-local state.
4. **Services.** Present the catalog default first and explain its purpose.
   Name only alternatives that change support, complexity, or capability.
   Present Homarr as optional and currently off; recommend it when a dashboard
   or read-only agent-facing MCP front door materially helps.
5. **Paths.** After fresh host inspection, propose config, data, media,
   download, and backup paths that are relevant to the selected services. Ask
   only about mappings the host facts cannot settle.
6. **Exposure.** Recommend local, LAN, or private-tailnet access before public
   access. Ask which people and devices need each user-facing service. Keep
   administrative services private unless the user explicitly chooses another
   reviewed topology.
7. **Recovery and VPN.** Ask about backups when the stack holds durable state.
   Ask about downloader-only VPN routing only when downloads are selected or
   the user mentions it. Treat bare `VPN` as ambiguous between private remote
   access and downloader privacy.
8. **Credentials.** Ask for a policy, never a secret value: generated defaults,
   an existing secret-manager reference, or custom credentials entered later
   through a supported private apply boundary.

For the managed `selfhost-media` adapter, state the implemented contract
directly: every service uses username `admin`, and the harness generates the
per-run password. The user receives it through the private credential handoff;
it never enters chat. The adapter does not currently offer a custom username or
password. For other stacks, defer custom values to the selected capability's
supported private apply boundary; block the apply when no such boundary exists.

Never request passwords, tokens, API keys, private keys, cookies, or recovery
codes in chat. If the user sends one, do not repeat it. Tell them to rotate it
and continue with only its intended purpose or secret reference.

## Keep prompts compact

Use this shape:

> Recommended: **private access from your home and tailnet**. It covers your TV
> and phone without opening the service to the internet. Use that, LAN-only, or
> public access?

For service choices, pair names with purposes:

> Recommended services: **Jellyfin** plays your library; **Seerr** lets your
> household search and request titles. **Homarr** is an optional dashboard and
> read-only agent front door, currently off. Use these defaults, add Homarr, or
> change a service?

End intake when every plan-changing choice is confirmed or visibly unresolved,
the project root is exact, no secret value was collected, and the next action
is either a redacted plan or a clearly named blocker.
