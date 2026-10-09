---
status: accepted (supersedes ADR 0002)
---

# A tabbed command center with action chords, not a fixed set of direct keys

ADR 0002's one Dashboard with direct keys grew, amendment by amendment, into five full-screen views, single keys that started, stopped or took down the Project, and a footer nobody read; it felt like a list of commands rather than a place to work. The Dashboard is now a command center in the spirit of Zellij: five tabs on `1`–`5` (Overview, Apps, Activity, Catalog, Settings), also cycled with `←`/`→`; `↑`/`↓` move within a list, `tab` moves focus between panes and `[`/`]` switch sub-tabs (App details' logs, setup, info, compose and containers; Settings' Host, Appearance, Backups, Tools and About), so no key means two things. No single key changes an App or the Project: `a` opens the Action menu for the selected App and `A` for the whole Project, the menu lists only the Actions valid now, previews what the highlighted one will do, and runs it only on `enter` (destructive ones need a second `enter`). Only read-only actions keep direct keys: `o` opens the App, `c` picks a credential to copy, `/` searches, `enter` goes into the selected App, `?` shows help. Settings' About sub-tab reuses `c` and `s` to open the donation pages (Ko-fi, GitHub Sponsors); they exist only there and on the pre-boot screen and change nothing. The pre-boot screen, which Onboarding's approved Review shows while the first install pulls its images, takes every key: `enter` skips to Activity, `c` and `s` open the donation pages, `q` quits as on the Dashboard, and no other key does anything. Settings' Backups sub-tab is the one other place an Action starts: `b` backs up the Project after an optional passphrase and `enter` on an archive opens a restore preview, which runs only after `enter` is pressed twice; both take every key while open, like the Action menu, and no key deletes an archive. An always-visible bottom bar shows the global keys on the left and the focused pane's keys as chips on the right; there are no Zellij-style modes, because tabs plus a context bar keep the budget small without hidden state.

## Considered options

- **Keep direct keys per Action** (ADR 0002): fastest for experts, but a stray key started, stopped or took down Apps, and every new Action needed a new letter.
- **Zellij-style modes** (`ctrl+p` pane mode and so on): powerful, but the mode a person is in is invisible state, and it is the part of Zellij people find hardest.

## Consequences

Stack's `1`/`2`/`3` Project controls move into the `A` menu. Starting an Action focuses the Activity tab, and the Overview mirrors it in a small "Now" strip. The keybind audit test checks this ADR instead of ADR 0002.
