package catalog

import (
	"github.com/ajnart/self-host/internal/apps/minio"
	"github.com/ajnart/self-host/internal/apps/netbird"
	"github.com/ajnart/self-host/internal/apps/pangolin"
	"github.com/ajnart/self-host/internal/apps/passbolt"
	"github.com/ajnart/self-host/internal/apps/stalwartmail"
	"github.com/ajnart/self-host/internal/apps/wud"
)

func init() {
	register(
		minio.App{},
		netbird.App{},
		pangolin.App{},
		passbolt.App{},
		stalwartmail.App{},
		wud.App{},
	)
}
