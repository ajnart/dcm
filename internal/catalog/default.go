package catalog

import (
	"github.com/ajnart/self-host/internal/app"
	"github.com/ajnart/self-host/internal/apps/arr"
	"github.com/ajnart/self-host/internal/apps/ntfy"
	"github.com/ajnart/self-host/internal/apps/qbittorrent"
	"github.com/ajnart/self-host/internal/apps/vaultwarden"
)

// Default is the catalog shipped in the binary.
func Default() *Catalog {
	apps := []app.App{ntfy.App{}, vaultwarden.App{}, arr.Prowlarr(), arr.Radarr(), arr.Sonarr(), qbittorrent.App{}}
	apps = append(apps, generatedApps()...)
	return New(
		apps,
		[]Recipe{{
			ID:          "media",
			Name:        "Media",
			Description: "Download, organize and search for TV and movies",
			Apps:        []string{"prowlarr", "radarr", "sonarr", "qbittorrent"},
		}},
	)
}
