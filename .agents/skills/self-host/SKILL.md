---
name: self-host
description: Base public self-hosting entry point. Use for `/self-host [service]`, setup, planning, maintenance, recovery, or verification of private services. Route to the installed selfhost workflow and keep Homarr as the standard private control plane.
license: Apache-2.0; see LICENSE.txt
compatibility: Requires the basic selfhost skill profile; setup and upkeep require Bun 1.4.0 or newer.
---

# Self-host

Give the user one command for the complete lifecycle. A subscription name or
plain-language need is enough; the user does not need to know app names.
Read [choosing-services.md](references/choosing-services.md) when explaining
replacements, combining needs, introducing Homarr, or discussing access/costs.

## Route the request

1. Explain the proposed apps and Homarr in one short recommendation. Reuse the
   known target host and project directory; if missing, ask which computer or
   NAS should run the apps and propose an owned directory. Check only the
   selected directory for `.selfhost/stack.json`.
2. Resolve installed sibling skills by name. Read only the workflow selected
   below and the references it directs you to:
   - Explicit planning, comparison, or an undecided request: follow
     `selfhost/SKILL.md`.
   - `/self-host SERVICE`, a replacement goal, or a new install without a
     stack record: follow `selfhost-setup/SKILL.md`, which plans before apply.
     A named app selects that app, required dependencies and Homarr; it does
     not imply a larger stack. Continue toward setup after required choices
     and the concrete apply approval; do not end at a catalog recommendation.
   - Status, extension, update, repair, recovery, or verification of a recorded
     stack: follow `selfhost-upkeep/SKILL.md`.
3. Keep the user's original `/self-host` invocation as authorization to enter
   the selected workflow. Ask for unresolved choices and exact mutation
   approval where that workflow requires it; never ask them to invoke another
   skill.
4. Continue until that workflow's completion criterion is met or a concrete
   blocker prevents the next safe action.

Lead with service purposes and user choices. Keep skill names, capability
boundaries, and internal status labels out of the conversation unless they
explain a blocker or help an advanced user inspect the plan.

Completion means the selected workflow completed its own plan, setup, or
upkeep contract and the user received one plain-language handoff with what was
planned, changed, verified, saved, and still blocked.
