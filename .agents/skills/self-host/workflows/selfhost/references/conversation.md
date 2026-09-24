# Conversation contract

Use this intake for a new project, an incomplete request, or an explicit
revision. Skip questions already answered by the request, saved project intent,
or confirmed non-secret preferences.

## Choose the setup path

After receiving the first service or replacement goal, preserve that goal and
read `onboarding.experience` from the confirmed project root. When it is
missing, ask:

> Which setup path do you want?
> **New** installs safe local defaults and includes Homarr.
> **Advanced** installs the requested service locally first, then offers optional additions.

Persist the answer as `new` or `advanced` only after the user confirms it.
Do not infer experience from root execution or other host facts; inspect those
facts independently on every run.

Both paths bind the initial installation to loopback. Do not ask an exposure or
device question before that installation completes.

- **New:** include Homarr without a separate dashboard question. Do not ask
  networking questions. After verification, add the two onboarding Notebook
  widgets defined by `selfhost-homarr`.
- **Advanced:** omit Homarr from the initial plan unless it was requested.
  After the requested service is locally installed and verified, present its
  completion summary, then ask separately whether to add Homarr and whether to
  add Vaultwarden. Each accepted addition keeps the normal plan, approval,
  apply, and verify boundary. After those choices finish, ask whether the user
  wants to reach the services from a phone while away from home. A yes starts a
  separate Tailscale plan; it does not approve that plan.

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

After a setup path is chosen, `defaults` selects its catalog defaults, `admin`
as the media administrator username, a generated password, and loopback-only
initial access. It includes Homarr for **New** and omits optional Homarr for the
initial **Advanced** installation. Confirm those choices in the plan.
Other optional roles remain off until explicitly selected. It does
not approve apply, public exposure, destructive work, privilege expansion, a
VPN change, or a migration.

## Ask only what changes the plan

Use this order, skipping settled branches:

1. **Purpose.** Ask what the user wants to do, not which products they already
   know. If the goal is vague, show the short catalog menu and recommend the
   closest outcome.
2. **People and devices.** For initial setup, do not ask. Both paths install on
   loopback first. The **Advanced** post-install phone question may start a
   separate Tailscale plan; **New** receives that option only in Homarr.
3. **Project root.** Recommend the exact current project root when appropriate;
   otherwise ask for one existing absolute directory. The router may read
   `.selfhost/project.json` only from the exact current root to detect a resume.
   Confirm the root before reading elsewhere or writing project-local state.
4. **Services.** Present the catalog default first and explain its purpose.
   Name only alternatives that change support, complexity, or capability.
   Include Homarr automatically for **New**. For **Advanced**, install the
   requested service first and offer Homarr and Vaultwarden afterward.
5. **Paths.** After fresh host inspection, propose config, data, media,
   download, and backup paths that are relevant to the selected services. Ask
   only about mappings the host facts cannot settle.
6. **Exposure.** Bind the initial installation to `127.0.0.1` or `::1` and do
   not ask for alternatives before verification. Only the **Advanced**
   post-install phone question can start a separate Tailscale plan. Keep
   administrative services private unless a later reviewed topology says
   otherwise.
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

For an **Advanced** follow-up, ask one question at a time:

> Your requested service is installed locally. Do you want to add **Homarr** as a dashboard?

> Do you want to add **Vaultwarden** as a password manager?

After those choices are complete:

> Do you want to reach your services from your phone while away from home?

End intake when every plan-changing choice is confirmed or visibly unresolved,
the project root is exact, no secret value was collected, and the next action
is either a redacted plan or a clearly named blocker.
