package catalog

func init() {
	registerRecipes(
		Recipe{
			ID:          "audio-library",
			Name:        "Audiobooks and music",
			Description: "Stream an owned audiobook and music library through focused private services.",
			Apps:        []string{"audiobookshelf", "navidrome"},
		},
		Recipe{
			ID:          "backups",
			Name:        "Backups and restore",
			Description: "Capture app-consistent state into an off-host repository and prove recovery.",
			Apps:        []string{"restic"},
		},
		Recipe{
			ID:          "dns",
			Name:        "DNS and network filtering",
			Description: "Own LAN DNS deliberately with filtering, fallback, and port-conflict checks.",
			// adguard-home forwards to unbound, so the resolver comes first.
			Apps: []string{"unbound", "adguard-home"},
		},
		Recipe{
			ID:          "documents",
			Name:        "Documents, PDF, and OCR",
			Description: "Ingest, OCR, search, transform, and recover private documents.",
			Apps:        []string{"paperless-ngx", "stirling-pdf"},
		},
		Recipe{
			ID:          "download-privacy",
			Name:        "Downloader privacy",
			Description: "Route only an approved downloader through a VPN namespace and prove fail-closed egress.",
			// qbittorrent runs inside gluetun's namespace, so the gateway comes first.
			Apps: []string{"gluetun", "qbittorrent"},
		},
		Recipe{
			ID:          "files",
			Name:        "Files and synchronization",
			Description: "Replace Google Drive, Microsoft OneDrive, and Dropbox with one file service and explicit recovery.",
			Apps:        []string{"nextcloud"},
		},
		Recipe{
			ID:          "full",
			Name:        "Full private home server",
			Description: "Set up one bounded household stack for owned media, photos, files, music, audiobooks, and passwords, with Homarr as the recommended dashboard and home automation available only when selected.",
			// Downloaders and media sources first, then the Apps that consume
			// them in turn, then the remaining independent services.
			Apps: []string{"qbittorrent", "prowlarr", "sonarr", "radarr", "jellyfin", "seerr", "immich", "nextcloud", "navidrome", "audiobookshelf", "vaultwarden", "home-assistant"},
		},
		Recipe{
			ID:          "homarr-control-plane",
			Name:        "Homarr control plane",
			Description: "Add Homarr as a private dashboard and agent-facing control plane for selected self-hosted services.",
			Apps:        []string{"homarr"},
		},
		Recipe{
			ID:          "home-automation",
			Name:        "Home automation",
			Description: "Run a private automation hub with deliberate LAN discovery, voice hardware, and device privileges.",
			Apps:        []string{"home-assistant", "node-red", "frigate"},
		},
		Recipe{
			ID:          "local-ai",
			Name:        "Local AI",
			Description: "Serve selected local models through a private chat interface with hardware-aware storage.",
			// The model server precedes the chat UI; monitoring comes last.
			Apps: []string{"ollama", "open-webui", "beszel"},
		},
		Recipe{
			ID:          "monitoring",
			Name:        "Monitoring and observability",
			Description: "Cover process, application, and edge health with bounded retention and alerts.",
			// Metrics and logs are the backends; grafana is the dashboard last.
			Apps: []string{"prometheus", "loki", "beszel", "uptime-kuma", "grafana"},
		},
		Recipe{
			ID:          "owned-video-library",
			Name:        "Owned movie and TV library",
			Description: "Stream movies and shows you already own through Jellyfin, with Homarr as the recommended dashboard and no implied content subscription.",
			Apps:        []string{"jellyfin"},
		},
		Recipe{
			ID:          "passwords",
			Name:        "Passwords",
			Description: "Host a recovery-sensitive password vault behind private, authenticated TLS.",
			Apps:        []string{"vaultwarden"},
		},
		Recipe{
			ID:          "personal-finance",
			Name:        "Personal finance",
			Description: "Choose a private budget or finance tracker with explicit import, export, and recovery boundaries.",
			Apps:        []string{"actual-budget"},
		},
		Recipe{
			ID:          "personal-media",
			Name:        "Personal media",
			Description: "Request, organize, and play an authorized private movie and TV library.",
			// gluetun namespaces qbittorrent; seerr last, its Links need
			// Jellyfin, Sonarr and Radarr ready.
			Apps: []string{"qbittorrent", "gluetun", "sonarr", "radarr", "prowlarr", "bazarr", "jellyfin", "seerr"},
		},
		Recipe{
			ID:          "photos",
			Name:        "Photos and mobile backup",
			Description: "Keep original photos private while providing mobile backup, search, and recovery.",
			Apps:        []string{"immich"},
		},
		Recipe{
			ID:          "photos-and-files",
			Name:        "Photos and cloud files",
			Description: "Replace photo backup with Immich and general cloud files with one Nextcloud service.",
			Apps:        []string{"immich", "nextcloud"},
		},
		Recipe{
			ID:          "private-notes",
			Name:        "Private notes and knowledge",
			Description: "Choose a private collaborative notes workspace and make its feature, secret, and backup boundaries explicit.",
			Apps:        []string{"docmost"},
		},
		Recipe{
			ID:          "remote-access",
			Name:        "Remote access",
			Description: "Expose selected services through a private overlay or separately approved public edge.",
			Apps:        []string{"tailscale", "cloudflare-tunnel", "caddy"},
		},
	)
}
