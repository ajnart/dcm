# TUI and cross-platform CLI options

Checked 2026-09-28. This is design research, not a runtime compatibility test.

## Recommendation

Use a command/plan engine independent of terminal rendering, with **Clack** as the initial interactive layer. Its maintained prompt package covers text, select/multiselect, confirmation, cancellation, spinners, and task progress—the controls a guided inspect → plan → approval → apply flow needs. Keep explicit flags and machine-readable output for non-interactive use; this is a product recommendation, not a feature Clack supplies. Move to **Ink** only if the product needs a persistent, live-updating dashboard: Ink renders React components with Flexbox and owns a terminal render/input loop, including raw-mode handling. That is a larger state/rendering surface for a linear setup flow. [Clack prompts](https://github.com/bombshell-dev/clack/blob/main/packages/prompts/README.md); [Ink README](https://github.com/vadimdemedes/ink/blob/master/readme.md); [Ink input API](https://github.com/vadimdemedes/ink/blob/master/_autodocs/api-reference/hooks-input.md).

## Distribution choices

| Route | What it buys | Constraint |
| --- | --- | --- |
| npm package with `bin` | One package can expose a named command; `npm exec` can run an installed or fetched package. | A JavaScript entry point needs its declared runtime on the user's machine. A Bun-specific entry point therefore still needs Bun; a Node-built entry point needs Node. [npm `bin`](https://docs.npmjs.com/cli/v11/configuring-npm/package-json/#bin); [npm exec](https://docs.npmjs.com/cli/v11/commands/npm-exec/). |
| Bun `build --compile` | Bundles TypeScript/JavaScript, imported packages, and Bun runtime into a standalone executable. Explicit targets include Linux glibc/musl x64/arm64, macOS x64/arm64, and Windows x64/arm64. | Ship the matching OS/architecture binary; Windows `.exe` and WSL Linux builds are different artifacts. Validate each target on its destination OS, especially external executables, filesystem paths, and terminal behavior. [Bun executables](https://bun.com/docs/bundler/executables). |
| Node single executable | Can distribute a Node application without a separate Node install. | Node calls this feature **active development**; it starts from a bundled script and has extra build/signing and asset handling. It is not the simplest first release path for an existing Bun/TypeScript CLI. [Node SEA](https://nodejs.org/api/single-executable-applications.html). |

For a first release, publish a runtime-backed package plus platform-specific Bun executables only after target-platform smoke checks. The binary route is an install convenience, not evidence that Docker Desktop, Compose, filesystem mounts, or the interactive terminal work on that host. [Bun executables](https://bun.com/docs/bundler/executables); [Docker Desktop networking](https://docs.docker.com/desktop/features/networking/).

## Docker Desktop boundary the CLI must model

- **macOS:** Docker Desktop supports the current and two previous major macOS releases and requires at least 4 GB RAM. It runs Linux containers in a VM; the host has no `docker0` bridge or directly routable per-container Linux IPs. Reach services through published ports and avoid assuming Linux host-network behavior. [Mac installation](https://docs.docker.com/desktop/setup/install/mac-install/); [networking how-tos](https://docs.docker.com/desktop/features/networking/networking-how-tos/).
- **Windows:** Docker Desktop's Linux-container path can use WSL 2; Docker requires WSL at least 2.1.5 and the chosen distro's integration to be enabled. Docker recommends keeping bind-mounted project data in the distro's Linux filesystem rather than `/mnt/c` for performance and file-change events. A CLI running *inside WSL* should use Linux paths and the Linux build; a native Windows CLI must handle Windows paths and its own Docker connection separately. [WSL backend](https://docs.docker.com/desktop/features/wsl/); [WSL best practices](https://docs.docker.com/desktop/features/wsl/best-practices/); [Windows installation](https://docs.docker.com/desktop/setup/install/windows-install/).
- **Exposure:** Docker Desktop forwards published ports through its backend; absent a host-IP restriction, a published port listens on all host interfaces. The CLI should show the effective bind address in the plan and preserve this repository's explicit exposure approval boundary. Host firewall/VPN observations also pass through the Docker Desktop backend, not a host `docker0` interface. [Docker Desktop networking](https://docs.docker.com/desktop/features/networking/); [networking how-tos](https://docs.docker.com/desktop/features/networking/networking-how-tos/).

## Current apply route and its unresolved gate

The current media and household adapters require a Linux process and Linux
filesystem, not merely a remote Docker daemon. A Windows user can run the
Linux CLI inside a WSL2 distribution with Docker Desktop integration; keep
the project and bind-mounted data in the distro filesystem. A macOS user can
run it inside a Lima Linux VM with its own Docker Engine. Once the CLI is
installed *inside that guest*, the entry points are `wsl -d DISTRO --
self-host --interactive` and `limactl shell INSTANCE self-host --interactive`.
These are guest invocations, not native macOS/Windows deployment claims.
[Microsoft WSL command interop](https://learn.microsoft.com/en-us/windows/dev-environment/wsl-interop);
[Docker WSL integration](https://docs.docker.com/desktop/features/wsl/);
[Lima shell](https://lima-vm.io/docs/reference/limactl_shell/).

The guest's port probe cannot prove that the Windows/macOS host's forwarded
ports are free or private. A supported launcher must check host listeners and
forwarding policy before approval, then verify access from the host. The
household initializer also requires an `x86_64`/`amd64` Linux guest; the normal
Apple Silicon ARM guest does not meet that gate. Lima documents foreign-arch
VM emulation as extremely slow. Do not advertise Apple Silicon household
apply until the pinned adapter and image architecture are ported and tested.
[Lima port forwarding](https://lima-vm.io/docs/config/port/);
[Lima architecture modes](https://lima-vm.io/docs/config/multi-arch/).

The CLI now has a deliberately narrow guest handoff: `target list` reads only
running WSL/Lima guest names, and `target launch --name` opens that guest's
already-installed CLI in its Linux home. The launcher does not install a guest,
start a stopped guest, or infer a host-visible service. Lima documents
`limactl list --quiet --filter` and `limactl shell`; Microsoft documents
`wsl --list --running --quiet` and named distribution execution.
[Lima list](https://lima-vm.io/docs/reference/limactl_list/);
[Lima shell](https://lima-vm.io/docs/reference/limactl_shell/);
[WSL commands](https://learn.microsoft.com/en-us/windows/wsl/basic-commands).

## Evidence limit

Context7 returned current Clack, Ink, Bun, and Node documentation. Its Docker Desktop lookup was blocked by the monthly quota, so Docker claims above were checked directly against current first-party Docker docs instead. To restore Context7 access, use `npx ctx7@latest login` or set `CONTEXT7_API_KEY`. No binaries, Docker flows, or terminal interactions were run.
