# Explain the outcome before the software

Read this when the user names a subscription, describes a household need, or
asks what an app does. Resolve actual selections through the sibling selfhost
catalog; this guide explains choices and does not promote support levels.

## A short recommendation

Start with the user's goal, then one sentence per selected app: what it does,
which familiar service or task it can replace, and the one material difference.
Show only relevant rows; keep databases and other supporting components out of
the introduction unless they affect cost, storage, hardware, or a decision.

| Familiar task or subscription | Suggested software | What the user gets |
| --- | --- | --- |
| Google Photos or iCloud Photos | Immich | A private photo and video library with phone backup and browsing. A separate backup protects against server failure. |
| Google Drive, OneDrive or Dropbox | Nextcloud | Your files in one place, with device sync and sharing. Moving existing files is a separate step. |
| Netflix, Disney+ or Prime Video | Jellyfin; Plex when chosen | A TV-style interface for movies and shows you own. It does not supply a subscription catalog. |
| Spotify or Apple Music | Navidrome | Stream your own music collection to compatible apps. No commercial music catalog is included. |
| Audible or an audiobook library | Audiobookshelf | Listen to your own audiobooks and podcasts from a private library. |
| 1Password, LastPass or Dashlane | Vaultwarden | A private password vault used through compatible Bitwarden apps. Plan HTTPS, recovery and backups before migration. |
| YNAB or Monarch-style budgeting | Actual Budget; Firefly III when chosen | Budgeting or personal-finance records on your server. Bank connections and import compatibility need checking. |
| Alexa/Google-style home control | Home Assistant | Control compatible lights, sensors and automations in one place. Voice needs a microphone/speaker device and an Assist setup. |
| Ring/Nest/Arlo-style camera use | Home Assistant with compatible cameras; Scrypted when chosen | Connect and view supported cameras. Hardware compatibility, recording storage and paid NVR features need checking. |
| Microsoft 365, Google Workspace or Notion-style work | Nextcloud for files; Docmost or BookStack for collaborative pages | Files and notes are distinct. Docmost Community does not include commercial Bases/Kanban. This catalog offers only Compose-hosted apps. |

For “smart speaker,” ask whether the user wants device control, voice, or both
if the request does not already say. For music and audiobooks preserve both needs. For three file-storage
brands, recommend one Nextcloud instance. A brand name is a goal hint, not
permission to cancel a subscription, import data, or expose services publicly.

## What “full” means

When the user asks for “full,” “full homelab,” or “everything for my homelab,”
recommend the bounded full preset: Jellyfin, Seerr, Sonarr, Radarr, Prowlarr,
qBittorrent, Immich, Nextcloud, Navidrome, Audiobookshelf, Vaultwarden, and one
Homarr dashboard. It does not mean every application in the catalog. Home
Assistant remains off unless the user selects it after hardware and network
review.

Explain the stages before apply. The seven-service media stage has a supported
hybrid setup that uses APIs for repeatable configuration and the browser for
onboarding, credential capture, and proof. Immich, Nextcloud, Navidrome,
Audiobookshelf, and Vaultwarden remain guided setups owned by their application
and Compose workflows. No indexer, public route, migration, subscription
cancellation, or client installation is selected merely by choosing “full.”
Let the user customize this list before approving any apply step.

An explicit combination such as “Netflix, Google Photos, Notion, Passwords”
is a composite request, not the `full` preset. Keep media, Immich, Docmost,
and Vaultwarden in its plan; follow every generated `setupStages` entry and
attach each ready app to the one Homarr board.

## Homarr in every chosen stack

Respect an explicit Homarr opt-out. When Homarr is already installed, reuse its
verified saved owner, board, and private API-key references; refresh verification
instead of repeating setup or asking for credentials. Introduce Homarr only when
it is newly selected:

> We'll also set up Homarr: a nice dashboard where you can open all your
> self-hosted apps and see useful information from the services you connect.

Create the selected app links, configure available integrations, and check
actual widgets. Explain a missing integration as “a shortcut is available;
live information isn't supported for this app yet.” Do not promise a widget
for every app. For a full media stack, explain additional services only when
selected: Seerr handles requests, Sonarr organizes shows, Radarr organizes
movies, Prowlarr shares indexer configuration, and qBittorrent downloads
approved files. They are not all needed just to play existing movies.

Use `ghcr.io/homarr-labs/homarr:dev` by default. Pull through the owning
project workflow; never substitute stable or
create a second Homarr instance for the same stack.

## Ask about access in everyday terms

Ask “Will you use this only at home, or on your phone while away?” only when an
unresolved access choice changes the plan. Otherwise retain the saved access
scope or safe private defaults and show the actual bind addresses in the plan.
Reuse an answer already given. Explain private remote access as “only your approved
devices can connect.” Recommend Caddy when friendly HTTPS addresses help and
there is no existing proxy to reuse; load the sibling selfhost-ingress skill
for the route and ownership plan.

Caddy directs each address to the right app and manages HTTPS. It does not
create application accounts, prevent every attack, or make publishing an app
safe by itself. Private HTTPS can need a one-time certificate-trust step on
each device. Keep direct service ports private and test the chosen access route.
For Vaultwarden, HTTPS is part of usable setup, not optional cosmetic polish.

## Costs without sales promises

Use the user's actual subscription spend if supplied. Otherwise explain the
possible saving without fixed dollar claims. Subtract recurring hosting,
electricity, backups and paid features; disclose hardware purchases separately.
Count a saving only if the user can replace the features they use and chooses
to cancel that subscription. Existing free plans do not create a saving.

## Example opening

For “replace Google Photos and Google Drive”:

> I'd use Immich for your photos and phone backup, and Nextcloud for files,
> syncing and sharing. Homarr will give you one dashboard to open both.
> We’ll plan moving your existing files and a separate backup before switching.
> Do you already have a computer or NAS you'd like to run them on?

Continue toward setup after the choices are clear. Avoid asking users to choose
internal skill names, database engines, container networks or certificate
issuers. Inspect and propose those details yourself, explaining only decisions
that affect how they use, pay for, or recover their services.

## Primary references

- [Immich](https://docs.immich.app/)
- [Nextcloud Files](https://nextcloud.com/files/)
- [Jellyfin](https://jellyfin.org/)
- [Navidrome](https://www.navidrome.org/)
- [Audiobookshelf](https://audiobookshelf.org/)
- [Vaultwarden](https://github.com/dani-garcia/vaultwarden)
- [Actual Budget](https://actualbudget.org/)
- [Home Assistant Assist](https://www.home-assistant.io/voice_control/)
- [Scrypted](https://www.scrypted.app/)
- [BookStack](https://www.bookstackapp.com/)
- [Caddy automatic HTTPS](https://caddyserver.com/docs/automatic-https)
