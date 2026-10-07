package netdata

import "github.com/ajnart/self-host/internal/app"

// Files wraps the unchanged official entrypoint. The tested v2.11.0 image
// copies stock config with cp-an, including orig -> //usr/lib/netdata/conf.d.
// Drop only that recreatable image shortcut before copying stock config into
// persistent storage; custom regular files and unknown links are retained.
func (App) Files(_ app.RenderContext, _ func(string) string) []app.File {
	return []app.File{{Path: "startup.sh", Mode: 0o755, Content: `#!/bin/sh
set -eu
for dir in /etc/netdata.stock /etc/netdata; do
  if [ -L "$dir/orig" ] && [ "$(readlink "$dir/orig")" = "//usr/lib/netdata/conf.d" ]; then
    rm -- "$dir/orig"
  fi
done
exec /usr/sbin/run.sh "$@"
`}}
}
