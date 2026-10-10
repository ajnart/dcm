package catalog

import (
	"github.com/ajnart/self-host/internal/app"
	"github.com/ajnart/self-host/internal/apps/arr"
	"github.com/ajnart/self-host/internal/apps/jellyfin"
	"github.com/ajnart/self-host/internal/apps/ntfy"
	"github.com/ajnart/self-host/internal/apps/qbittorrent"
	"github.com/ajnart/self-host/internal/apps/seerr"
	"github.com/ajnart/self-host/internal/apps/vaultwarden"
)

// Default is the catalog shipped in the binary.
func Default() *Catalog {
	apps := []app.App{ntfy.App{}, vaultwarden.App{}, arr.Prowlarr(), arr.Radarr(), arr.Sonarr(), qbittorrent.App{}, jellyfin.App{}, seerr.App{}}
	apps = append(append(apps, generatedApps()...), ported...)
	return New(
		apps,
		append([]Recipe{{
			ID:          "media",
			Name:        "Media",
			Description: "Watch your movies and shows, and have new ones requested and downloaded for you",
			// Seerr comes last: its Links need Jellyfin, Sonarr and Radarr ready.
			Apps: []string{"qbittorrent", "sonarr", "radarr", "prowlarr", "jellyfin", "seerr"},
		}}, portedRecipes...),
	)
}
