package catalog

import (
	"github.com/ajnart/self-host/internal/apps/adguard"
	"github.com/ajnart/self-host/internal/apps/audiobookshelf"
	"github.com/ajnart/self-host/internal/apps/bazarr"
	"github.com/ajnart/self-host/internal/apps/emby"
	"github.com/ajnart/self-host/internal/apps/forgejo"
	"github.com/ajnart/self-host/internal/apps/freshrss"
	"github.com/ajnart/self-host/internal/apps/frigate"
	"github.com/ajnart/self-host/internal/apps/homeassistant"
	"github.com/ajnart/self-host/internal/apps/homebridge"
)

func init() {
	register(
		adguard.App{},
		audiobookshelf.App{},
		bazarr.App{},
		emby.App{},
		forgejo.App{},
		freshrss.App{},
		frigate.App{},
		homeassistant.App{},
		homebridge.App{},
	)
}
