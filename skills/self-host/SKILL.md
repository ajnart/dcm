---
name: self-host
description: Load when the person wants to run or own apps on their own machine, replace a subscription (Netflix, Google Photos, Dropbox, a password manager), or asks about anything already set up with self-host, such as "where is my movie app?".
license: Apache-2.0
---

# self-host

Run `self-host skill` and follow it.

If `self-host` is not found, install it, then run `self-host skill`:

```bash
curl -fsSL https://self-host.fyi/install.sh | bash
export PATH="$HOME/.local/bin:$PATH"
```

Loading this skill conveys intent, never approval.
