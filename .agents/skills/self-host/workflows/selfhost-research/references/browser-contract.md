# Browser research contract

Use this reference only when a research task needs public web navigation or UI proof.

## Preflight and session

1. Run `agent-browser skills get core` before the first browser command. Use `--full` when command details or troubleshooting are needed.
2. Generate a worktree-scoped session name with `agent-browser session id --scope worktree --prefix selfhost-research`.
3. Build an explicit comma-separated allowlist from the approved source domains. Include required first-party subdomains deliberately; never use a wildcard for the public internet.
4. Pass `--session <id>` and `--allowed-domains <list>` on every command.
5. Arrange unconditional cleanup with the same named session and `close`. Record whether closure succeeded.

Use no restore key, browser profile, auth vault, cookie import, recording, video, trace, HAR capture, or shared default session. Do not log local daemon identifiers. If the browser daemon cannot run with its normal sandbox, return `browser_environment_blocked`; disclose any proposed `--no-sandbox` use as a separate security prerequisite.

## Navigation and reads

- Discover structure with `read <url> --outline`, then narrow with `read <url> --filter <section>`.
- Use `read <url> --json` for the status-bearing source result. Preserve its JSON only in ephemeral working state.
- After `open` or a click, run an explicit load or content wait before reading title, URL, or content.
- Record the requested source URL, the intended canonical URL, and the observed final URL separately.
- Treat navigation success as insufficient: a browser can open a 404 document.
- Record a redirect chain. A changed final URL without a recorded redirect is ambiguous.
- Record Markdown negotiation. A reader-generated `.md` URL is not a replacement canonical URL.
- Capture a title and a stable content marker, then perform a soft-404 check.

## UI proof

Use `snapshot -i`, act on one current accessibility ref, verify the resulting URL, wait, then take a fresh snapshot. Store only the relevant visible labels, URL, timestamp, and optional secret-safe screenshot path. Never reuse an old ref after page change.

Raw DOM and `eval` output can contain generated credentials embedded by documentation pages. Prefer outline/filter reads. If DOM extraction is unavoidable, send it directly to `redact.ts` before any display or persistence.
