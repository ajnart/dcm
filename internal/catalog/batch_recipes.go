package catalog

func init() {
	registerRecipes(
		Recipe{
			ID:          "audio-library",
			Name:        "Audiobooks and music",
			Description: "Listen to your audiobooks and music on your phone or computer",
			Apps:        []string{"audiobookshelf", "navidrome"},
		},
		Recipe{
			ID:          "backups",
			Name:        "Backups and restore",
			Description: "Back up your important files safely, and check you can get them back",
			Apps:        []string{"restic"},
		},
		Recipe{
			ID:          "dns",
			Name:        "DNS and network filtering",
			Description: "Block ads across your whole home network, with a backup in case one stops",
			// adguard-home forwards to unbound, so the resolver comes first.
			Apps: []string{"unbound", "adguard-home"},
		},
		Recipe{
			ID:          "documents",
			Name:        "Documents, PDF, and OCR",
			Description: "Scan paper into a searchable archive, and edit PDFs without uploading them",
			Apps:        []string{"paperless-ngx", "stirling-pdf"},
		},
		Recipe{
			ID:          "download-privacy",
			Name:        "Downloader privacy",
			Description: "Download torrents through a VPN, and stop if the VPN drops",
			// qbittorrent runs inside gluetun's namespace, so the gateway comes first.
			Apps: []string{"gluetun", "qbittorrent"},
		},
		Recipe{
			ID:          "files",
			Name:        "Files and synchronization",
			Description: "Your own cloud drive, replacing Google Drive, OneDrive and Dropbox",
			Apps:        []string{"nextcloud"},
		},
		Recipe{
			ID:          "full",
			Name:        "Full private home server",
			Description: "Everything for a household: movies, photos, files, music, passwords and smart home",
			// Downloaders and media sources first, then the Apps that consume
			// them in turn, then the remaining independent services.
			Apps: []string{"qbittorrent", "prowlarr", "sonarr", "radarr", "jellyfin", "seerr", "immich", "nextcloud", "navidrome", "audiobookshelf", "vaultwarden", "home-assistant"},
		},
		Recipe{
			ID:          "homarr-control-plane",
			Name:        "Homarr control plane",
			Description: "One home page for all your apps, that your AI assistant can use too",
			Apps:        []string{"homarr"},
		},
		Recipe{
			ID:          "home-automation",
			Name:        "Home automation",
			Description: "Automate your smart home, with cameras that spot people and cars",
			Apps:        []string{"home-assistant", "node-red", "frigate"},
		},
		Recipe{
			ID:          "local-ai",
			Name:        "Local AI",
			Description: "Chat with AI on your own computer, so your questions stay private",
			// The model server precedes the chat UI; monitoring comes last.
			Apps: []string{"ollama", "open-webui", "beszel"},
		},
		Recipe{
			ID:          "monitoring",
			Name:        "Monitoring and observability",
			Description: "Watch your computers and apps and get alerts when something goes wrong",
			// Metrics and logs are the backends; grafana is the dashboard last.
			Apps: []string{"prometheus", "loki", "beszel", "uptime-kuma", "grafana"},
		},
		Recipe{
			ID:          "owned-video-library",
			Name:        "Owned movie and TV library",
			Description: "Stream the movies and shows you already own to every screen",
			Apps:        []string{"jellyfin"},
		},
		Recipe{
			ID:          "passwords",
			Name:        "Passwords",
			Description: "Set up a password manager for the whole household",
			Apps:        []string{"vaultwarden"},
		},
		Recipe{
			ID:          "personal-finance",
			Name:        "Personal finance",
			Description: "Track your spending and budget privately",
			Apps:        []string{"actual-budget"},
		},
		Recipe{
			ID:          "personal-media",
			Name:        "Personal media",
			Description: "Watch movies and shows, with downloads, subtitles and requests handled for you",
			// gluetun namespaces qbittorrent; seerr last, its Links need
			// Jellyfin, Sonarr and Radarr ready.
			Apps: []string{"qbittorrent", "gluetun", "sonarr", "radarr", "prowlarr", "bazarr", "jellyfin", "seerr"},
		},
		Recipe{
			ID:          "photos",
			Name:        "Photos and mobile backup",
			Description: "Back up your family photos automatically from every phone",
			Apps:        []string{"immich"},
		},
		Recipe{
			ID:          "photos-and-files",
			Name:        "Photos and cloud files",
			Description: "Back up your photos and keep your files in sync, replacing cloud drives",
			Apps:        []string{"immich", "nextcloud"},
		},
		Recipe{
			ID:          "private-notes",
			Name:        "Private notes and knowledge",
			Description: "A private place for your family or team to write and share notes",
			Apps:        []string{"docmost"},
		},
		Recipe{
			ID:          "remote-access",
			Name:        "Remote access",
			Description: "Reach your apps from outside your home, privately or through your own web address",
			Apps:        []string{"tailscale", "cloudflare-tunnel", "caddy"},
		},
	)
}
