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
umask, media and downloads folders, LAN address and Exposure.

**Recipe**:
A named, pre-wired bundle of Apps chosen together for one purpose
(e.g. a media server).
_Avoid_: stack, goal, profile

**Catalog**:
The set of Apps and Recipes shipped inside the binary.

**Setup**:
The automatic, headless configuration of an installed App (accounts, API
keys, settings, links to other Apps), done without a browser.
_Avoid_: onboarding, wizard

**Link**:
Setup that wires one App to another (e.g. Sonarr to qBittorrent). It belongs
to the consuming App and runs only once both Apps have completed Setup.
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
API keys stay per App.

**Backup**:
One compressed archive of App configuration and database files plus the
secrets, made only on request. Media libraries are not included.

**Restore**:
Putting one App, or every App, back from a Backup.

## Relationships

- A **Recipe** selects one or more **Apps**; an **App** can belong to many **Recipes**
- A **Backup** covers one or more **Apps**; a **Restore** can target any single **App** inside it

## Flagged ambiguities

- "recipe" in the previous CLI meant one app's compose definition; here it
  means a bundle of **Apps**.
