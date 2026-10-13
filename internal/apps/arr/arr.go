// Package arr holds Sonarr, Radarr and Prowlarr. They share one shape: a
// linuxserver.io image, an API key generated into config.xml on first start,
// forms authentication set through the host config API, and Links made
// through their v3 (Sonarr, Radarr) or v1 (Prowlarr) APIs.
package arr

import (
	"context"
	"strconv"

	"github.com/ajnart/self-host/internal/app"
	"github.com/ajnart/self-host/internal/apps/servarr"
	"github.com/ajnart/self-host/internal/helpers"
)

type App struct {
	info app.Info
	// api is the API prefix: /api/v3 or /api/v1.
	api string
	// rootFolder is the library folder Setup registers; empty for Prowlarr.
	rootFolder string
	links      []app.Link
}

// The API prefixes: Sonarr and Radarr speak v3, Prowlarr v1.
const (
	apiV3 = servarr.V3
	apiV1 = servarr.V1
)

func Sonarr() App {
	return App{
		info: app.Info{
			ID: "sonarr", Name: "Sonarr", Category: "Requests",
			Description:   "Find, download and organize TV shows automatically",
			Image:         "lscr.io/linuxserver/sonarr:latest",
			Docs:          "https://wiki.servarr.com/sonarr",
			Port:          8989,
			ContainerPort: 8989,
			Service:       "sonarr",
			UsesMedia:     true,
		},
		api:        apiV3,
		rootFolder: "/media/tv",
		links:      []app.Link{downloadClientLink("tvCategory", "tv")},
	}
}

func Radarr() App {
	return App{
		info: app.Info{
			ID: "radarr", Name: "Radarr", Category: "Requests",
			Description:   "Find, download and organize movies automatically",
			Image:         "lscr.io/linuxserver/radarr:latest",
			Docs:          "https://radarr.video/docs/",
			Port:          7878,
			ContainerPort: 7878,
			Service:       "radarr",
			UsesMedia:     true,
		},
		api:        apiV3,
		rootFolder: "/media/movies",
		links:      []app.Link{downloadClientLink("movieCategory", "movies")},
	}
}

func Prowlarr() App {
	return App{
		info: app.Info{
			ID: "prowlarr", Name: "Prowlarr", Category: "Requests",
			Description:   "Manage the search sites that Sonarr and Radarr use to find your downloads",
			Image:         "lscr.io/linuxserver/prowlarr:latest",
			Docs:          "https://wiki.servarr.com/prowlarr",
			Port:          9696,
			ContainerPort: 9696,
			Service:       "prowlarr",
		},
		api:   apiV1,
		links: []app.Link{applicationLink("sonarr"), applicationLink("radarr")},
	}
}

func (a App) Info() app.Info    { return a.info }
func (App) Inputs() []app.Input { return nil }
func (a App) Links() []app.Link { return a.links }

func (a App) Compose(rc app.RenderContext) string {
	id := a.info.ID
	inner := strconv.Itoa(a.info.ContainerPort)
	mounts := ""
	if a.rootFolder != "" {
		mounts = "      - ${MEDIA_ROOT}:/media\n      - ${DOWNLOADS_ROOT}:/downloads\n"
	}
	return `services:
  ` + id + `:
    image: ` + a.info.Image + `
    restart: unless-stopped
    environment:
      PUID: ${PUID}
      PGID: ${PGID}
      TZ: ${TZ}
      UMASK: ${UMASK}
    volumes:
      - ./config:/config
` + mounts + `    ports:
      - ${BIND_IP}:` + strconv.Itoa(rc.Port) + `:` + inner + `
    healthcheck:
      test: ["CMD-SHELL", "curl -fs -o /dev/null http://localhost:` + inner + `/ping || exit 1"]
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 30s
`
}

func (a App) servarr() servarr.Servarr {
	return servarr.Servarr{Name: a.info.Name, API: a.api}
}

func (a App) request(h *helpers.H, req helpers.Request) helpers.Request {
	return a.servarr().Request(h, req)
}

type rootFolder struct {
	Path string `json:"path"`
}

func (a App) hasRootFolder(ctx context.Context, h *helpers.H) (bool, error) {
	resp, err := h.Expect(ctx, a.request(h, helpers.Request{Path: "/rootfolder"}))
	if err != nil {
		return false, err
	}
	var folders []rootFolder
	if err := resp.Decode(&folders); err != nil {
		return false, err
	}
	for _, folder := range folders {
		if folder.Path == a.rootFolder {
			return true, nil
		}
	}
	return false, nil
}

func (a App) Setup(ctx context.Context, h *helpers.H) error {
	if err := a.servarr().Setup(ctx, h); err != nil || a.rootFolder == "" {
		return err
	}
	return h.Step(ctx, "root-folder", "add the root folder "+a.rootFolder, helpers.StepSpec{
		Check: func(ctx context.Context) (bool, error) { return a.hasRootFolder(ctx, h) },
		Do: func(ctx context.Context) error {
			if _, err := h.Exec(ctx, nil, "s6-setuidgid", "abc", "mkdir", "-p", a.rootFolder); err != nil {
				return err
			}
			_, err := h.Expect(ctx, a.request(h, helpers.Request{Method: "POST", Path: "/rootfolder", JSON: rootFolder{Path: a.rootFolder}}))
			return err
		},
		Hint:       "Open " + a.info.Name + " > Settings > Media Management > Add Root Folder and choose " + a.rootFolder + ".",
		Credential: "admin",
	})
}

func (a App) Check(ctx context.Context, h *helpers.H) error {
	return a.servarr().Check(ctx, h)
}
