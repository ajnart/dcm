# Coolify administration-only candidate

The publisher's v4.3.23 Compose combines Coolify, PostgreSQL 15, Redis 7 and
Coolify Realtime 1.0.19. This candidate retains that topology but publishes only
the loopback dashboard. It grants no Docker socket, SSH key, host-gateway entry,
host-root mount, public proxy or server-management authority. It is not a useful
deployment platform until those separate boundaries are reviewed and verified.

The pinned Horizon and scheduler service scripts **grep the physical `.env`**;
environment variables alone do not disable them. The reviewed non-secret,
read-only `.env` policy disables both workers. Container-readable mode 0644 is
required for the image's UID 9999; its containing host directory remains 0700.
The same environment settings also configure Laravel. Production seeding still
creates its default server row and queues proxy/Sentinel work. Those rows are
not evidence that SSH, Docker, proxy or realtime browser access works. The
adapter refuses any saved private keys, additional servers or enabled workers.
Do not add host keys or enable workers through this candidate.

ROOT_USER_EMAIL/ROOT_USER_PASSWORD seeding is deliberately not used: the
publisher's root seeder validates DNS, password character classes and breach
checks and skips existing roots. The real CSRF-protected Fortify `/register`
route accepts the synthetic private login identity without DNS validation,
creates ID 0 only when there are no users, attaches the root-team owner and
disables registration. Production passwords still require uppercase, lowercase,
number and symbol plus the publisher's uncompromised check. The generated
48-byte `base64:`-prefixed password supplies symbols; the adapter checks the
other classes without regenerating a saved file. Publisher rejection or a lost
registration response requires inspection, not another account-creation POST.

Fixed, read-only PHP model inspection proves the exact root/password, closed
registration and dormant worker policy. HTTP login additionally proves the
profile's root ID/email/name. The publisher's `skipBoarding` action dismisses
its host wizard without choosing or provisioning a server. API enablement uses
the actual `settings.advanced.instantSave` component, and token creation uses
`security.api-tokens.addNewToken` with read-only permissions and no expiry.
The adapter consumes signed snapshots from those exact pages, using the
Livewire 3.8.7 protocol pinned by Coolify's composer.lock, not synthesized
component state. Snapshots/CSRF/cookies persist privately across deferred
approvals; checkpoint-before-send prevents blind replay of one-time actions.

The once-visible Sanctum token retains its numeric prefix. It is saved before
another request, then verified against the root team and sole root member.
These token-authenticated GETs require approval because pinned Sanctum 4.3.3
updates last-used metadata. Read-only inspection reports saved preparation only,
not freshly verified login/key evidence, and never exercises the token.
A missing token after an attempted creation is unresolved, never permission to
issue another. Restart/resume reuses the same password, key and account. Setup
returns `host-authority-required`, never ready or functional PaaS acceptance.
No live Docker, first-run, deferred approval, key readback or restart trial was
performed for this source-only candidate.

Primary evidence is linked in manifest.json: v4.3.23 production/base Compose,
Dockerfile, worker scripts, root seeder, Fortify action/provider, password policy,
boarding/profile/settings/token components, token view/copy input, API routes
and pinned Livewire request/commit serialization. Redis uses a private generated
password config and the established host-selected user contract so its 0600
configuration is readable without exposing password bytes in command argv.
