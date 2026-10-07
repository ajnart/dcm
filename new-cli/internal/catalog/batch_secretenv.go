package catalog

import (
	"github.com/ajnart/self-host/internal/apps/grafana"
	"github.com/ajnart/self-host/internal/apps/kopia"
	"github.com/ajnart/self-host/internal/apps/nodered"
	"github.com/ajnart/self-host/internal/apps/nzbget"
	"github.com/ajnart/self-host/internal/apps/openwebui"
	"github.com/ajnart/self-host/internal/apps/peanut"
	"github.com/ajnart/self-host/internal/apps/photoprism"
	"github.com/ajnart/self-host/internal/apps/slskd"
	"github.com/ajnart/self-host/internal/apps/speedtesttracker"
	"github.com/ajnart/self-host/internal/apps/traefik"
)

func init() {
	register(
		grafana.App{},
		kopia.App{},
		nodered.App{},
		nzbget.App{},
		peanut.App{},
		photoprism.App{},
		slskd.App{},
		traefik.App{},
		openwebui.App{},
		speedtesttracker.App{},
	)
}
