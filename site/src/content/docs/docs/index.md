---
title: Overview
description: How to install self-host, reach your Apps from every device, drive it from an agent and fix what breaks.
---

`self-host` is one Go binary that installs, signs in, wires together and repairs self-hosted Apps with Docker Compose: a terminal Dashboard for people, plain commands with `--json` for agents. Every App lives in one Compose Project in the Home folder, `~/.self-host`. Nothing outside it is touched.

```bash
curl -fsSL https://self-host.fyi/install | bash
self-host
```

## Guides

- [Getting started](/docs/getting-started): install the binary, check the machine with `self-host doctor`, then go through Onboarding to the Dashboard.
- [Access](/docs/access): how phones, TVs and laptops open your Apps, from Home network to your own web address.
- [Agents](/docs/agents): `self-host skill`, the one-sentence prompt and the `--json` commands an agent runs.
- [Troubleshooting](/docs/troubleshooting): `doctor`, the Debug report, the Host report and Feedback.

## Recipes

A Recipe is a named, pre-wired bundle of Apps chosen together for one purpose. [Every Recipe](/docs/recipes) has its own page with its Apps and the Links between them. For single Apps, browse [the Apps](/apps).

## Words

These docs use the same words as the CLI:

- **App**: one deployable product in the Catalog, with its automatic Setup built into the binary.
- **Recipe**: a bundle of Apps; picking it picks all of its Apps.
- **Catalog**: the set of Apps and Recipes shipped inside the binary.
- **Project**: the single Docker Compose project that holds every App the CLI manages.
- **Setup**: the automatic, headless configuration of an installed App: accounts, API keys, settings.
- **Link**: Setup that wires one App to another, such as Sonarr to qBittorrent. It belongs to the consuming App.
- **Access**: how people reach the Apps, and the **Address** they type to open each one.
- **Onboarding**: the setup wizard a person goes through the first time they run `self-host`.
- **Dashboard**: the tabbed command center for an existing Project: Overview, Apps, Activity, Catalog and Settings.
