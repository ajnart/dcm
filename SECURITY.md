# Security Policy

## Report a vulnerability

Use GitHub private vulnerability reporting. Do not open a public issue containing credentials, private host details, exploit payloads, or unredacted evidence.

Include the affected command or App, the smallest safe reproduction, the expected boundary, and the observed result. Replace secret values, hostnames, addresses, cookies, and session identifiers with typed placeholders.

## Supported version

Security fixes target the latest published `self-host` release and the default branch.

## Boundaries

Reports are most useful when they show a break of one of these:

- a command or path that escapes the one Compose Project the CLI owns;
- symlink, traversal, archive or generated-file attacks, including in Backup restore;
- secrets in arguments, output, logs, screenshots or error messages (they belong only in the Project's `secrets.env`);
- an App reachable from the internet without the explicit approval that names the risk;
- broad Docker operations, unsafe privilege, or casual socket mounts;
- tampering with installer or self-update downloads (archives are checked against `checksums.txt`).
