package catalog

import (
	"github.com/ajnart/self-host/internal/app"
	"github.com/ajnart/self-host/internal/apps/arr"
	"github.com/ajnart/self-host/internal/apps/ntfy"
	"github.com/ajnart/self-host/internal/apps/qbittorrent"
)

// Default is the catalog shipped in the binary.
func Default() *Catalog {
	return New(
		[]app.App{ntfy.App{}, arr.Prowlarr(), arr.Radarr(), arr.Sonarr(), qbittorrent.App{}},
		[]Recipe{{
			ID:          "media",
			Name:        "Media",
			Description: "Download, organize and search for TV and movies",
			Apps:        []string{"prowlarr", "radarr", "sonarr", "qbittorrent"},
		}},
	)
}
