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
(e.g. a media server).
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
administers it. It ends at an approved plan and hands over to the Dashboard,
where the first Action comes to life.
_Avoid_: setup (that is an App's automatic configuration), first run

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
Who can reach the Apps: **local network** (default) or **this machine only**.
Always shown in the recap, since it explains most "can't reach it from my TV"
reports.

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
The one screen a person sees for an existing Project: every App with its
Status, what Needs action, and the selected App's details. There are no other
screens; first run is the install flow, not a screen.
_Avoid_: screens, pages, control panel

**Status**:
An App's health at a glance: **ok** (green), **attention** (yellow) or
**broken** (red), combined from its container, its health check and its Setup.
_Avoid_: state (the container's state is one input to Status)

**Needs action**:
The things a person must deal with: a failed Setup step, a Manual step, an
available update, a failing or warning host check. Each item names the one Action that resolves
it, or the command to run when no Action exists.

**Action**:
Something a person triggers often enough to deserve a key: install, start or
stop, update, retry Setup, backup, copy a password or API key, open an App.
Everything else (remove, restore, config, credentials listing…) is only a
command.

**App details**:
The read-only view of the selected App, in tabs: logs, Setup, info and its
Compose file.
_Avoid_: sidebar

**Workflow view**:
The step tracker opened with `w`: every App's remembered steps from render,
pull and start (when recorded), through Setup and Links to check, with each
step's state. It counts Apps fully set up and failed steps; `esc` returns to
the Dashboard.

**Keybind**:
One key that triggers one Action or moves the selection. The Dashboard has a
small fixed set; a key with no frequent Action behind it does not exist.

## Relationships

- A **Recipe** selects one or more **Apps**; an **App** can belong to many **Recipes**
- A **Backup** covers one or more **Apps**; a **Restore** can target any single **App** inside it
- The **Dashboard** shows every **App** with one **Status**; each **Needs action** item points at one **App** (or the host) and one **Action**
- A failing **Link** makes its consuming **App** need action, not its target

## Flagged ambiguities

- "recipe" in the previous CLI meant one app's compose definition; here it
  means a bundle of **Apps**.
