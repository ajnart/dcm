package catalog

import (
	"github.com/ajnart/self-host/internal/apps/authentik"
	"github.com/ajnart/self-host/internal/apps/bookstack"
	"github.com/ajnart/self-host/internal/apps/docmost"
	"github.com/ajnart/self-host/internal/apps/fireflyiii"
	"github.com/ajnart/self-host/internal/apps/immich"
	"github.com/ajnart/self-host/internal/apps/keycloak"
	"github.com/ajnart/self-host/internal/apps/linkwarden"
)

func init() {
	register(
		authentik.App{},
		bookstack.App{},
		docmost.App{},
		fireflyiii.App{},
		immich.App{},
		keycloak.App{},
		linkwarden.App{},
	)
}
