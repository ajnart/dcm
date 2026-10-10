# Product

## Register

product

## Users

People who want to run their own Apps and own their data, including people who have never used Docker or a terminal server. Experienced users and agents use the same Project operations through plain commands. `CONTEXT.md` defines the vocabulary.

## Product Purpose

One Go binary installs and operates Apps in one Docker Compose Project. Onboarding turns the person's choices into a reviewable plan. The Dashboard makes running Apps, their Addresses, and anything needing attention easy to find. Homarr is the preselected home for those Apps.

## Brand Personality

Plain, calm, capable. Explain what each choice does for the person. Borrow Zellij's visible keyboard affordances and predictable navigation, as recorded in ADR 0004. Preserve the existing terminal-native visual identity.

## Anti-references

Avoid jargon-heavy Docker management panels, invisible keyboard modes, and direct keys that unexpectedly change Apps. Avoid using the same visual treatment for keyboard focus and a committed answer. Do not bury the person's task in a wall of choices or transient validation messages.

## Design Principles

- Show the next useful choice and what it changes in plain words.
- Keep focus, selection, and approval distinguishable. Navigation must not apply changes.
- Make the working Address and the next recovery Action discoverable.
- Keep the shared Admin login convenient without displaying credential values in the Dashboard.
- Let newcomers proceed with clear defaults while keeping deliberate choices available.

## Accessibility & Inclusion

The Dashboard is keyboard-first and fits 80-column terminals, with 80x24 and 120x30 renderer coverage. Simple Unicode symbols are the default; Nerd Font icons are optional. Status and selection have textual or symbolic marks as well as colour. Respect light and dark terminal themes and the existing reduced-motion behavior. Keep content and key hints within the viewport.

## Sources

`CONTEXT.md`, `docs/adr/0004-tabbed-command-center-action-chords.md`, `internal/tui/theme.go`, spec #191, and the user walkthrough recorded in #242 and #243.
