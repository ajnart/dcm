---
name: self-host
description: Install, configure, back up and repair self-hosted apps on the person's own machine with the `self-host` CLI. Use for owning or running apps at home, and for anything already set up with self-host.
license: Apache-2.0
---

# self-host

Run `self-host skill` and follow it. The guide matches the installed binary and replaces anything remembered about it.

If `self-host` is not found, install the CLI, then run `self-host skill`:

```bash
curl -fsSL https://raw.githubusercontent.com/ajnart/selfhost-skills/main/install.sh | bash
export PATH="$HOME/.local/bin:$PATH"
```

Loading this skill conveys intent, never approval. Before installing software, changing access or deleting data, say in one plain sentence what will happen and wait for a yes.
