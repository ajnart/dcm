# Self-host

One skill to turn “replace Google Photos” or “set up a password manager” into a
working self-hosted setup, connected to **Homarr**. The agent explains the apps,
asks for your username, generates passwords, configures supported services,
and hands back access links and an optional private credentials file.

## Tell it what you want to replace

You don't need to know the software names. Start with a familiar service:

```text
/self-host I want to replace Google Photos and Google Drive
/self-host Netflix
/self-host password manager
/self-host Google Drive, Microsoft OneDrive, Dropbox
/self-host smart speaker
/self-host audio books and music
```

| Your goal | Suggested apps | What they do |
| --- | --- | --- |
| Photos and cloud storage | **Immich + Nextcloud** | Back up and browse photos; sync and share files. |
| Your own movie library | **Jellyfin** | Watch movies and shows you own on your TV, phone or browser. |
| Music and audiobooks | **Navidrome + Audiobookshelf** | Stream your own music and audiobook collection, plus podcasts. |
| A private password manager | **Vaultwarden** | Use compatible Bitwarden apps; set up HTTPS and recovery before importing passwords. |
| Household budgeting | **Actual Budget** or **Firefly III** | Track budgets, accounts and spending. |
| Smart-home control, optional voice and cameras | **Home Assistant**, optionally **Scrypted** | Connect compatible devices, automations and camera systems. |
| Files, office work or notes | **Nextcloud**, with tools chosen for your needs | Share files and add document collaboration when needed; evaluate local note apps separately. |

Every stack includes **Homarr**, a nice dashboard to open your self-hosted
apps and see useful information from connected services. Setup checks the
available integrations and widgets; a shortcut alone isn't a tested integration.
Moving existing data and setting up a separate backup are planned before switching.
We currently use `ghcr.io/homarr-labs/homarr-test:v2`.

Caddy is an optional way to give apps friendly HTTPS addresses. Setup reuses an
existing proxy where possible and keeps access private unless you choose
otherwise. Network access settings determine who can reach the apps; HTTPS
protects traffic; each app still needs appropriate login and
access controls. Voice assistants need suitable hardware, and media apps need
your own content: these apps don't include a Netflix or Spotify subscription
catalog. Savings depend on the subscriptions you can cancel and the cost of
hardware, hosting, electricity and backups.

The agent explains these choices briefly, then guides setup. See the
[service selection guide](.agents/skills/self-host/references/choosing-services.md)
for the replacement boundaries. Catalog coverage remains broader than the
seven-service tested media harness; other setups retain their stated guided
or discovery status until verified.

## Install once

Install Git and Bun 1.4.0 or newer, including `bunx`. From your project:

```bash
bunx --bun skills@latest add ajnart/selfhost-skills --skill self-host
```

Choose your agent and project/global scope in the installer. There is only
**one skill** to select. All internal workflows, catalog data, scripts, and
service recipes travel with it; installing them does not deploy their services.

To install globally for Codex, Claude Code, OpenCode, Pi, OpenClaw, and Hermes:

```bash
bunx --bun skills@latest add ajnart/selfhost-skills --skill self-host --agent codex --agent claude-code --agent opencode --agent pi --agent openclaw --agent hermes-agent --global --copy --yes
```

Use only the `--agent` flags you need. Omit `--global` for a project install;
omit `--copy` for the installer's normal symlink layout. `--all` targets every
supported agent, which is usually unnecessary. Other Agent Skills clients can
copy the whole `.agents/skills/self-host/` directory into their own skill folder.
See [installation and migration](.agents/install.md) for paths and older installs;
the [OpenCode install guide](docs/opencode-install.md) includes a discovery check.

For native package routes, the versioned release provides a Claude Code plugin
marketplace and a Codex marketplace on the `plugin-claude` and `plugin-codex`
Git refs. Pi can install the source repository as a Git package. OpenCode uses
its Agent Skills loader; it does not need a JS plugin for this workflow. See
[the install guide](.agents/install.md) for client commands and
[the release gate](docs/release.md) for publication checks.

| Agent | Start a conversation |
| --- | --- |
| Codex | `$self-host photos` |
| Claude Code | `/self-host photos` |
| Pi | `/skill:self-host photos` |
| OpenClaw | `/skill self-host photos` |
| Hermes | `/self-host photos` |
| OpenCode and other clients | Ask “use the self-host skill to set up photos” or select it in the client |

Use the same entry point to plan, install, resume, add services, update, or
repair. `/self-host full` selects the supported household recipe; it does not
install every catalog app. The agent loads only the workflow and app references
needed for your request. Actual command/picker support varies by client.

## What setup does

1. Explain the apps and ask only for missing choices: host, storage, access,
   username, and any required email.
2. Inspect the host and show a concrete plan before making changes.
3. Check prerequisites and install the official `agent-browser` tooling when
   needed. Apply only the approved Compose projects.
4. Configure apps using supported APIs or browser paths, capture keys privately,
   and connect Homarr integrations and widgets where supported.
5. Verify the selected services and return links, locations, and remaining gaps.

Homarr runs with `ghcr.io/homarr-labs/homarr-test:v2` for now. App shortcuts,
working integrations, and working widgets are checked separately. The default
MCP bridge is read-only; explicitly approved `integration_request` policies can
allow bounded actions for selected integrations, paths, and methods.

The catalog contains 111 apps across 20 goal stacks. Catalog presence is not a
promise of automatic setup: each app keeps its managed, guided, or discovery
support level. Household recipes and Caddy configuration still require real
application and access verification before a run can claim completion.

## Open it from the right device

Setup asks whether you want access on this computer, on your home network, or
away from home. A localhost link on your laptop cannot open a remote server.

`127.0.0.1` in Compose keeps a published port on the server itself. It is useful
for local automation and host-based proxies. For normal home-network use, the
agent plans a reachable LAN or private-tailnet entry point. With containerized
Caddy, upstream traffic uses Docker service names on a shared network; backend
ports need not be published for proxy traffic. Removing the bind address makes
Docker publish on all host interfaces, so it is an access choice, not a cleanup.

Caddy can provide friendly HTTPS names, but DNS, certificate trust, and app
logins must also work on your device. Read [access choices](.agents/skills/self-host/references/access.md)
or the [media headless guide](docs/headless-access.md).

## Credentials and resuming

The agent asks for a username and generates passwords through the owning helper.
Existing passwords and API keys stay out of chat, commands, screenshots, and
ordinary reports. When requested, the private handoff is a mode-0600
`private-handoff.json` containing available credentials, URLs, and storage paths.
The separate report contains no credentials. A partial export remains marked
partial; generating a password does not mean its account has been created.

Return to the same project and invoke `self-host` again. Non-secret choices and
progress live in `.selfhost/preferences.json`, `.selfhost/project.json`, and
`.selfhost/stack.json`. The media adapter retains wiring keys in its private,
password-free `connections.env`. Upkeep checks real host state before resuming
and re-exports credentials only when requested.

## One skill, on-demand workflows

```text
.agents/skills/self-host/
├── SKILL.md             # Small public entry point
├── references/          # Service and access explanations
└── workflows/
    ├── selfhost/        # Planning and searchable catalog
    ├── selfhost-setup/  # New installations and continuation metadata
    ├── selfhost-upkeep/ # Maintenance and recovery
    └── selfhost-*/      # GUIDE.md, scripts, references, optional assets
```

Internal `GUIDE.md` files are documentation, not separately discoverable skills.
Their stable IDs remain in plans and saved records so existing stacks can
resume. Scope and approval boundaries still apply when all files are in one
package. No runtime helper depends on a later repository checkout.

The release ZIP follows [Agent Plugins 1.0](https://agent-plugins.org/specification)
with one `skills/self-host/SKILL.md`, plus Claude Code compatibility metadata.
The source repository's `CLAUDE.md` symlink points to `AGENTS.md` for
contributors. That alias is not part of the release ZIP or needed by the
installed skill.

## Develop and inspect

```bash
bun run stack profiles
bun run selfhost catalog search photos
bun scripts/validate-repo.ts --json
bun scripts/skillpack.ts validate --scope all
```

Root `PROMPT.md`, `docker-compose.yml`, `prompts/`, and harness scripts are the
canonical media harness. After changing them, regenerate the bundled copy with
`bun scripts/refresh-media-bundle.ts`. Never edit only the generated bundle.

- [Workflow index](SKILL_INDEX.md)
- [Invocation](.agents/invocation.md) and [installation](.agents/install.md)
- [Domain and safety boundaries](.agents/CONTEXT.md)
- [Contribution rules](CONTRIBUTING.md) and [release checks](docs/release.md)

Public exposure, destructive work, backup restores, and downloader VPN routing
have their own plans and evidence requirements. No broad Docker cleanup or
unowned resource changes are part of setup.
