// Package archiveteamwarrior is ArchiveTeam Warrior: a private web control
// interface that runs externally assigned archival work, prepared in idle mode.
package archiveteamwarrior

import (
	"context"
	"fmt"
	"net/http"
	"strconv"
	"time"

	"github.com/ajnart/self-host/internal/app"
	"github.com/ajnart/self-host/internal/helpers"
)

// App is ArchiveTeam Warrior. Traps: docs/catalog/traps/archive-team-warrior.md.
type App struct{}

func (App) Info() app.Info {
	return app.Info{
		ID: "archive-team-warrior", Name: "ArchiveTeam Warrior", Category: "Downloads",
		Description:   "Contributes idle capacity to ArchiveTeam's web archiving projects through a private control interface",
		Image:         "atdr.meo.ws/archiveteam/warrior-dockerfile@sha256:19337aa9157e04f6cdb8f7c6f8c98e27d14efb0d9525334995fbdb036b95e1ca",
		Docs:          "https://wiki.archiveteam.org/index.php/ArchiveTeam_Warrior",
		Port:          8001,
		ContainerPort: 8001,
		Service:       "archive-team-warrior",
	}
}

func (App) Inputs() []app.Input {
	return []app.Input{{
		Key:      "nickname",
		Prompt:   "Warrior contribution nickname",
		Help:     "A 3-30 character public nickname shown on the ArchiveTeam HQ leaderboard",
		Required: true,
	}}
}

func (App) Compose(rc app.RenderContext) string {
	nickname := rc.Inputs["nickname"]
	if nickname == "" {
		nickname = "selfhost"
	}
	port := strconv.Itoa(rc.Port)
	// The pinned image runs as UID/GID 1000 and seeds config before opening
	// its UI. Docker creates fresh binds as root; restore the hidden image
	// helpers and prepare only these App directories without replacing data.
	return `services:
  archive-team-warrior-init:
    image: atdr.meo.ws/archiveteam/warrior-dockerfile@sha256:19337aa9157e04f6cdb8f7c6f8c98e27d14efb0d9525334995fbdb036b95e1ca
    user: "0:0"
    network_mode: none
    read_only: true
    entrypoint: ["/bin/sh", "-ec"]
    command:
      - cp -an /home/warrior/data/. /owned/data/ && chown -Rh 1000:1000 /owned/projects /owned/data
    volumes:
      - ./projects:/owned/projects
      - ./data:/owned/data
  archive-team-warrior:
    image: atdr.meo.ws/archiveteam/warrior-dockerfile@sha256:19337aa9157e04f6cdb8f7c6f8c98e27d14efb0d9525334995fbdb036b95e1ca
    restart: unless-stopped
    user: "1000:1000"
    depends_on:
      archive-team-warrior-init:
        condition: service_completed_successfully
    environment:
      TZ: ${TZ}
      DOWNLOADER: ` + nickname + `
      SELECTED_PROJECT: "none"
      CONCURRENT_ITEMS: "1"
      HTTP_USERNAME: ${ADMIN_USER}
      HTTP_PASSWORD: ${ADMIN_PASSWORD}
    volumes:
      - ./projects:/home/warrior/projects
      - ./data:/home/warrior/data
    ports:
      - ${BIND_IP}:` + port + `:8001
`
}

// basicWorks reads the control interface with the shared Admin login.
func basicWorks(ctx context.Context, h *helpers.H) (bool, error) {
	resp, err := h.HTTP(ctx, helpers.Request{Path: "/index.html", User: h.AdminUser(), Password: h.AdminPassword()})
	if err != nil {
		return false, err
	}
	return resp.Status == http.StatusOK, nil
}

func (App) Setup(ctx context.Context, h *helpers.H) error {
	return h.Step(ctx, "ready", "the Warrior control interface accepts the Admin login", helpers.StepSpec{
		Check: func(ctx context.Context) (bool, error) { return basicWorks(ctx, h) },
		Do: func(ctx context.Context) error {
			return h.Poll(ctx, 2*time.Minute, func(ctx context.Context) (bool, error) { return basicWorks(ctx, h) })
		},
		Hint: "Open " + h.URL + "/index.html and sign in with the Admin login " +
			"(self-host credentials), or read the logs with: self-host logs archive-team-warrior",
		Credential: "admin",
	})
}

func (App) Check(ctx context.Context, h *helpers.H) error {
	anon, err := h.HTTP(ctx, helpers.Request{Path: "/"})
	if err != nil {
		return err
	}
	if anon.Status != http.StatusUnauthorized && anon.Status != http.StatusForbidden {
		return fmt.Errorf("anonymous visitors can reach the control interface (HTTP %d); set HTTP_USERNAME and HTTP_PASSWORD", anon.Status)
	}
	if ok, err := basicWorks(ctx, h); !ok {
		return fmt.Errorf("the Admin login cannot sign in to the control interface: %v", err)
	}
	return nil
}

func (App) Links() []app.Link { return nil }
