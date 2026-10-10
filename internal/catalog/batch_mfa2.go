package catalog

import (
	"github.com/ajnart/self-host/internal/apps/lidarr"
	"github.com/ajnart/self-host/internal/apps/navidrome"
	"github.com/ajnart/self-host/internal/apps/portainer"
	"github.com/ajnart/self-host/internal/apps/sabnzbd"
	"github.com/ajnart/self-host/internal/apps/scrypted"
	"github.com/ajnart/self-host/internal/apps/syncthing"
	"github.com/ajnart/self-host/internal/apps/tdarr"
	"github.com/ajnart/self-host/internal/apps/transmission"
	"github.com/ajnart/self-host/internal/apps/uptimekuma"
)

func init() {
	register(
		lidarr.App{},
		navidrome.App{},
		portainer.App{},
		sabnzbd.App{},
		scrypted.App{},
		syncthing.App{},
		tdarr.App{},
		transmission.App{},
		uptimekuma.App{},
	)
}
