---
title: Access
description: Every way to reach your Apps with self-host, from the Home network Address to Easy names, Tailscale, Cloudflare and your own reverse proxy.
sidebar:
  order: 2
---

Access is how people reach the Apps and what they type to open them. It decides each App's Address. Choose it in Onboarding's Access step or later in the Dashboard under Settings → Access, where each option has a diagram and a help page. Review always needs your approval, and anything reachable from the internet needs its own explicit yes that names the risk.

| Access                   | What you type                                                                  | Status                                                                                                                                                                                                                        |
| ------------------------ | ------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Home network (default)   | `http://192.168.1.20:8096`                                                     | Verified 2026-10-14 on Linux ([#499](https://github.com/ajnart/self-host/issues/499)) and 2026-10-17 on macOS with OrbStack ([#502](https://github.com/ajnart/self-host/issues/502)). Another device was not tried on macOS.  |
| This computer only       | `http://127.0.0.1:8096`                                                        | Verified 2026-10-26 on WSL2, opened from Windows through localhost forwarding ([#502](https://github.com/ajnart/self-host/issues/502)).                                                                                       |
| Easy names at home       | `http://jellyfin.192-168-1-20.sslip.io`, through one managed Caddy             | Verified 2026-10-14 on Linux with rootless Docker, from a second machine ([#500](https://github.com/ajnart/self-host/issues/500)). Not yet verified on macOS ([#502](https://github.com/ajnart/self-host/issues/502)).        |
| From anywhere, privately | A Tailscale HTTPS Address, one node per App                                    | Verified 2026-10-26 from another tailnet device, with the fix in v0.6.3 ([#502](https://github.com/ajnart/self-host/issues/502)).                                                                                             |
| Your own web address     | `https://movies.example.com`, through Cloudflare Tunnel with a login page      | Verified 2026-10-26 with a real domain: from outside, the App answered with the Cloudflare login page, and `self-host cloudflare remove` took it down again (v0.6.2, [#502](https://github.com/ajnart/self-host/issues/502)). |
| Bring your own           | Whatever your own proxy serves; `self-host access export` prints the upstreams | Not yet verified on a real host.                                                                                                                                                                                              |

Options combine: Easy names at home and Tailscale can both be on. The `IP:port` Address is always kept as a fallback. `self-host status` and Homarr tiles show the friendliest Address that works, in this order: Tailscale HTTPS, verified Cloudflare HTTPS, working Easy names, then `IP:port`.

In the Dashboard, an App's Action menu can show its Address as a QR code to scan with a phone. It is unavailable under This computer only, since a phone cannot reach `127.0.0.1`.

## Home network

The default. Every App's port is published on all host interfaces, so other devices on your network can connect: review your firewall scope. The Address uses the LAN address, the address of this machine on the local network, detected when the Project is made.

```bash
self-host config set EXPOSURE=lan
```

## This computer only

Apps are published on `127.0.0.1`, so only this machine can open them. Pick it in Onboarding, or for a new Project:

```bash
self-host install ntfy --exposure local
self-host config set EXPOSURE=local   # an existing Project
```

`config set` recreates the affected Apps.

## Easy names at home

One Caddy in the Project routes each App with a web page to `http://<app>.<lan-ip-with-dashes>.sslip.io`. Verified on Linux; not yet verified on macOS.

```bash
self-host install jellyfin --easy-names   # a new Project
self-host config set EASY_NAMES=on        # an existing Project
self-host config set EASY_NAMES=off       # removes only the managed Caddy
```

- Needs an active private home-network IPv4 address, free port 80 and rootful Docker. IPv6 is not supported. Conflicts are refused without changes.
- Names are checked from this computer, not your phone or TV; a router may hide them. `self-host status --json` reports them under `names`.
- The name embeds the LAN address. After a DHCP change, run `self-host config review` and update bookmarks; a DHCP reservation on your router avoids this. sslip.io sees the LAN address in name queries.
- HTTP only: Apps that require HTTPS, such as Vaultwarden's web vault, will not work. Do not forward port 80 on your router.

## From anywhere, privately (Tailscale)

Install Tailscale on your phone, TV or laptop and sign in to the same account. Only your signed-in devices can open your Apps.

1. On the [Tailscale DNS page](https://login.tailscale.com/admin/dns), keep MagicDNS on and enable HTTPS. App names appear in a public certificate log; the Apps stay private.
2. At [Settings, Keys](https://login.tailscale.com/admin/settings/keys), make an auth key with **Reusable** and **Pre-approved** on and **Ephemeral** off. Save it in a private file on the host, never in chat.
3. Install Tailscale with the key file:

```bash
self-host install tailscale --set-file tailscale.auth_key=/path/to/key
```

Each App with a web page gets its own persistent node and HTTPS Address. Nothing enables Funnel. The key lasts up to 90 days, so new Apps may need a new one; `self-host doctor` warns about expiry and signed-out nodes. An OAuth client secret works too, when it owns `tag:self-host`.

## Your own web address (Cloudflare)

Publishes chosen Apps at `https://<app>.<your web address>` through a Cloudflare Tunnel, with an emailed-PIN login page in front.

You need a domain already **active** on Cloudflare, Zero Trust onboarding done (a team name, the **Free plan**, and a payment method that is **not charged**), and a custom API token limited to one account and zone with these permissions: Account **Cloudflare Tunnel: Edit**, **Access: Apps and Policies: Edit**, **Access: Organizations, Identity Providers, and Groups: Edit**; Zone **DNS: Edit**, **Zone: Read**. Keep the token in an owner-only file, never in chat.

Settings → Access guides the domain, the allowed emails and the per-App choices. Nothing is selected by default, and Apps without a web page cannot be published. From the command line, plan first; it makes no network calls:

```bash
self-host cloudflare plan --domain example.com --email alice@example.org --app paperless-ngx
```

After a separate yes to the public risk (strangers reach the login page, a flaw could let them into an App, and Cloudflare sees the traffic):

```bash
self-host cloudflare publish --domain example.com --email alice@example.org --app paperless-ngx \
  --set-file cloudflare.api_token=/private/token --accept-public
```

`--app` is repeatable and is the full desired list. To take the Addresses down:

```bash
self-host cloudflare remove --set-file cloudflare.api_token=/private/token --yes
```

:::caution
Cloudflare's terms restrict video streaming, and phone and TV apps cannot pass the PIN login. Use Tailscale for streaming and native clients.
:::

HTTPS Addresses appear only after an outside check gets redirected to the login page; a failed check deletes the DNS record. Run `self-host skill` for the full procedure and its warnings.

## Bring your own

For people who already run SWAG, Pangolin, Nginx Proxy Manager, Traefik or their own Caddy. Choosing it changes nothing.

```bash
self-host access export --format caddy   # or nginx, traefik, json (the default)
```

It prints every App's upstream, an `example.com` hostname to replace, and whether the App needs WebSockets or long timeouts when known. You run the proxy, its certificates and its login; the `IP:port` Address keeps working.

## When the network changes :badge[New]

The LAN address is stored when the Project is made. When the machine moves to another network, every Address points at the old one: `self-host status --json` reports `lan_ip_stale` and `self-host doctor` warns on `lan-ip`. Fix it with:

```bash
self-host config set LAN_IP=auto
# or review every Host setting:
self-host config review --yes
```

Only Apps that use the address are recreated. If an App works on the host but not on your phone or TV, see [Troubleshooting](/docs/troubleshooting#cannot-reach-an-app-from-another-device).
