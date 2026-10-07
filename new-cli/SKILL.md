---
name: self-host
description: Install, configure, back up and repair self-hosted apps with the `self-host` CLI. Use when the user wants to self-host apps such as Jellyfin, Sonarr or Vaultwarden on their machine.
---

Run `self-host skill` and follow it. It prints the usage guide that matches the
installed binary.

If `self-host` is missing, install it:

```bash
curl -fsSL https://raw.githubusercontent.com/ajnart/selfhost-skills/main/new-cli/install.sh | bash
```

Releases use `new-cli-vX.Y.Z` tags in `ajnart/selfhost-skills`; plugin/npm
releases are separate. Linux amd64/arm64 and macOS arm64 are the build targets.
Use the Linux binary inside WSL. Native Windows and Intel macOS are unsupported.
Native platform and published-asset validation must be recorded before release.

For private repository access, set `SELF_HOST_GITHUB_TOKEN` in the environment
through your credential provider. The installer and `self-update` use it for
GitHub API downloads. Do not put the token in commands or reports. Fetching
this install script from a private repository also requires authenticated
access; save it with your authenticated GitHub client and run `bash install.sh`.
`SELF_HOST_VERSION=1.2.0` selects one stable CLI version.
