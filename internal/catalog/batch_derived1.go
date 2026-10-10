package catalog

import (
	"github.com/ajnart/self-host/internal/apps/archiveteamwarrior"
	"github.com/ajnart/self-host/internal/apps/authelia"
	"github.com/ajnart/self-host/internal/apps/cloudflaretunnel"
	"github.com/ajnart/self-host/internal/apps/dockge"
	"github.com/ajnart/self-host/internal/apps/gluetun"
	"github.com/ajnart/self-host/internal/apps/haproxy"
	"github.com/ajnart/self-host/internal/apps/headscale"
)

func init() {
	register(
		archiveteamwarrior.App{},
		authelia.App{},
		cloudflaretunnel.App{},
		dockge.App{},
		gluetun.App{},
		haproxy.App{},
		headscale.App{},
	)
}
