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

`defaults` selects catalog defaults, the recommended Homarr dashboard, `admin`
as the media administrator username, a generated password, and private-first
planning defaults. Confirm those choices in the plan; a user may change or
decline them.
Other optional roles remain off until explicitly selected. It does
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
   Offer Homarr as the standard private dashboard and read-only agent-facing
   MCP front door; ask only if the user signals they may not want it.
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
8. **Credentials.** Confirm the username and ask for a policy, never a secret
   value: generated password (recommended), an existing secret-manager
   reference, or custom credentials entered later through a supported private
   apply boundary. Accept `defaults` as `admin` plus a generated password for
   the managed media adapter.

For the managed `selfhost-media` adapter, confirm the username before the run
is created. The harness uses it across supported services and generates a
per-run password. `admin` is valid only after the user accepts defaults or
explicitly chooses it. Confirm the username in the plan; never ask the user to
invent or paste a password. When saved credentials are explicitly requested,
run the media handoff helper. It writes `.sessions/<run>/artifacts/private-handoff.json`
(mode `0600`) with the generated password, usernames, available API keys, URLs
and storage paths. Return its path only; ordinary reports contain no secrets.
The separate owner-only `connections.env` remains password-free. For other
stacks, defer custom values to the selected capability's supported private
apply boundary; block the apply when no such boundary exists.

Never request passwords, tokens, API keys, private keys, cookies, or recovery
codes in chat. If the user sends one, do not repeat it. Tell them to rotate it
and continue with only its intended purpose or secret reference. Use only the
explicitly requested private export above for saved media credentials.

## Keep prompts compact

Use this shape:

> Recommended: **private access from your home and tailnet**. It covers your TV
> and phone without opening the service to the internet. Use that, LAN-only, or
> public access?

For service choices, pair names with purposes:

> Recommended services: **Jellyfin** plays your library; **Seerr** lets your
> household search and request titles. **Homarr** is the private dashboard and
> read-only agent front door. Use these defaults or change a service?

End intake when every plan-changing choice is confirmed or visibly unresolved,
the project root is exact, no secret value was collected, and the next action
is either a redacted plan or a clearly named blocker.
