# self-host CLI

A single binary that installs and configures self-hosted apps with Docker
Compose, for humans through a TUI and for agents through plain commands.

## Language

**App**:
One deployable product in the catalog, with its install definition and its
automatic setup built into the binary.
_Avoid_: service, recipe (for a single app)

**Unmanaged app**:
An app an agent or user added to the Project by writing its own Compose file.
The CLI starts, stops, updates and backs it up but runs no Setup for it.
_Avoid_: custom app

**Host settings**:
Values detected once and shared by every App: time zone, user and group IDs,
umask, media and downloads folders, LAN address and Exposure. They can drift
from the host (a laptop changes network); a review re-confirms them on an
existing Project without touching installed Apps.

**Recipe**:
A named, pre-wired bundle of Apps chosen together for one purpose
(e.g. a media server). In the pickers, picking it picks all of its Apps at
once, and its mark (✓ all, ◐ some, ○ none) follows the Apps picked.
_Avoid_: stack, goal, profile

**Catalog**:
The set of Apps and Recipes shipped inside the binary.

**Setup**:
The automatic, headless configuration of an installed App (accounts, API
keys, settings, links to other Apps), done without a browser.
_Avoid_: onboarding (that is the person's first run), wizard

**Onboarding**:
The setup wizard a person goes through the first time they run self-host,
before any Project exists: what they want to run, why, where it lives and who
administers it. It ends at an approved plan; Pre-boot plays while the first
install pulls its images, then Onboarding hands over to the Dashboard, where
the first Action comes to life.
_Avoid_: setup (that is an App's automatic configuration), first run

**Pre-boot**:
The full-screen scene between approving Onboarding's Review and the Dashboard,
shown for the first install only and never for a Catalog install. It plays
while the install pulls images, following the same pull as Activity: one bar,
"N of M images" and the narrative line, over a parallax starfield, with a
friendly line comparing the time left to something small ("This should take
about as long as a song on the radio"), which warms up until the pull has
moved enough to estimate and never shows a number. When the pull ends it plays
its exit and lands on Activity; a failed pull lands there at once, and with
nothing to pull it plays about four seconds. It is the one screen allowed
several colours and 24 frames a second.
_Avoid_: splash screen, loading screen

**Manual step**:
A Setup step that needs a person to finish or verify it in a browser. It keeps
its hint and remains retryable, but is not a failed step. Setup is **manual**
while only Manual steps remain; a failed step takes precedence as **incomplete**.
_Avoid_: failure (for a browser-only boundary)

**Link**:
Setup that wires one App to another (e.g. Sonarr to qBittorrent). It belongs
to the consuming App: it runs once both Apps have finished their own Setup,
and when it fails it is the consuming App whose Setup is incomplete, never
the target's.
_Avoid_: integration (reserved for Homarr's own feature)

**Project**:
The single Docker Compose project on a host that holds every App the CLI
manages. Nothing outside it is touched.
_Avoid_: stack, deployment

**Exposure**:
Who can reach the Apps: **Other devices on your network** (default, stored as
`lan`) or **Only this computer** (stored as `local`). Always shown in the
recap, since it explains most "can't reach it from my TV" reports. Other
devices on your network publishes the Apps' ports on `0.0.0.0`; Only this
computer publishes them on `127.0.0.1`. The choice also lists coming-soon
entries (Tailscale, Cloudflare Tunnel, HTTPS with a reverse proxy) that cannot
be picked yet; the Apps stay where they are. Onboarding's Where and Settings
explain the highlighted choice live, with a diagram and a help page on `?`.

**LAN address**:
The address of this machine on the local network, such as `192.168.1.20`,
detected when the Project is made and kept as a Host setting. It only builds
the Links and URLs people open; Exposure alone decides who can connect.

**Admin login**:
The one username and password shared by every App's administrator account.
API keys stay per App. An App that reserves the shared username upstream
(Forgejo refuses `admin`) gets an App-local login alias, which Setup, the
credential picker and `self-host credentials` name for that App.
_Avoid_: per-App password

**Backup**:
One compressed archive of App configuration and database files plus the
secrets, made only on request. Media libraries are not included.

**Restore**:
Putting one App, or every App, back from a Backup.

**Dashboard**:
The tabbed command center a person sees for an existing Project: Overview
(every App with its Status, what Needs attention, and the Action running now),
Apps, Activity, Catalog and Settings. Onboarding hands over to it.
_Avoid_: screens, pages, control panel

**Status**:
An App's health at a glance: **ok** (green), **attention** (yellow) or
**broken** (red), combined from its container, its health check and its Setup.
_Avoid_: state (the container's state is one input to Status)

**Needs attention**:
The things a person must deal with: a failed Setup step, a Manual step, an
available update, a failing or warning host check. Each item names the one Action that resolves
it, or the command to run when no Action exists.
_Avoid_: needs action

**Action**:
A change a person triggers on one App or on the whole Project: install, start
or stop, restart, update, retry Setup, backup, restore, remove. In the Dashboard
every Action goes through the Action menu, except restore and config, which run
from Settings (Backups and Host); each shows in Activity like the others.

**Action menu**:
The menu that `a` opens for the selected App (`A` for the Project). It lists
only the Actions valid in the current state, previews what the highlighted one
will do, and runs it only on `enter`; destructive ones need a second `enter`.
_Avoid_: context menu, shortcut

**App details**:
The read-only view of the selected App on the Apps tab, in sub-tabs: logs,
Setup, info, its Compose file, and its containers and images.
_Avoid_: sidebar

**Activity**:
The Dashboard tab that shows the running or most recent Action as it unfolds
(pull, start, Setup steps, credentials, Links, check), then every App's
remembered steps with their state. It takes focus when an Action starts.
_Avoid_: workflow view, task overlay

**Appearance**:
The non-secret choice of glyph set saved with the Project: **Nerd Font**
icons, or **Simple** Unicode symbols (the default). Icons appear only where
they carry meaning (an App's category, the Docker, key and link stages, the
brand mark); bars, spinners and state dots are the same in both.
_Avoid_: theme (that is the colours), Host setting (Appearance is not one)

**Keybind**:
A key that switches tabs, moves the selection or focus, opens a read-only view
(open in browser, copy a credential, search), or opens the Action menu. No
single key changes an App or the Project.

## Relationships

- A **Recipe** selects one or more **Apps**; an **App** can belong to many **Recipes**
- A **Backup** covers one or more **Apps**; a **Restore** can target any single **App** inside it
- The **Dashboard** shows every **App** with one **Status**; each **Needs attention** item points at one **App** (or the host) and one **Action**
- A failing **Link** makes its consuming **App** need attention, not its target

## Flagged ambiguities

- "recipe" in the previous CLI meant one app's compose definition; here it
  means a bundle of **Apps**.
