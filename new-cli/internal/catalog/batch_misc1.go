package catalog

import (
	"github.com/ajnart/self-host/internal/apps/borgmatic"
	"github.com/ajnart/self-host/internal/apps/caddy"
	"github.com/ajnart/self-host/internal/apps/gatus"
	"github.com/ajnart/self-host/internal/apps/gotify"
	"github.com/ajnart/self-host/internal/apps/lldap"
	"github.com/ajnart/self-host/internal/apps/postgresql"
	"github.com/ajnart/self-host/internal/apps/renovate"
	"github.com/ajnart/self-host/internal/apps/restic"
	"github.com/ajnart/self-host/internal/apps/unbound"
	"github.com/ajnart/self-host/internal/apps/valkey"
	"github.com/ajnart/self-host/internal/apps/vector"
)

func init() {
	register(
		borgmatic.App{},
		caddy.App{},
		gatus.App{},
		gotify.App{},
		lldap.App{},
		postgresql.App{},
		renovate.App{},
		restic.App{},
		unbound.App{},
		valkey.App{},
		vector.App{},
	)
}
