// Package archiveteamwarrior is ArchiveTeam Warrior: a private web control
// interface that runs externally assigned archival work, prepared in idle mode.
package archiveteamwarrior

import (
	"context"
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
		Description:   "Lend your spare internet time to help save websites before they disappear",
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
	// helpers as regular executables and prepare only these App directories.
	// Only the pinned image's known absolute helper link is migrated; custom
	// paths and saved config are retained, and backup containment stays strict.
	return `services:
  archive-team-warrior-init:
    image: atdr.meo.ws/archiveteam/warrior-dockerfile@sha256:19337aa9157e04f6cdb8f7c6f8c98e27d14efb0d9525334995fbdb036b95e1ca
    user: "0:0"
    network_mode: none
    read_only: true
    entrypoint: ["/bin/sh", "-ec"]
    command:
      - |
        if [ -L /owned/data/wget-at ] && [ "$(readlink /owned/data/wget-at)" = /usr/local/bin/wget-lua ]; then
          rm -- /owned/data/wget-at
        fi
        cp -aLn /home/warrior/data/. /owned/data/
        chown -Rh 1000:1000 /owned/projects /owned/data
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

func basicWorks(ctx context.Context, h *helpers.H) (bool, error) {
	err := Verify(ctx, h)
	return err == nil, err
}

func (App) Setup(ctx context.Context, h *helpers.H) error {
	return h.Step(ctx, "ready", "verify the Warrior Admin login and worker status", helpers.StepSpec{
		Check: func(ctx context.Context) (bool, error) { return basicWorks(ctx, h) },
		Do: func(ctx context.Context) error {
			return h.Poll(ctx, 2*time.Minute, func(ctx context.Context) (bool, error) { return basicWorks(ctx, h) })
		},
		Hint: "Open " + h.URL + "/index.html with the Admin login (self-host credentials). " +
			"Check the nickname and Warrior HQ connection, then retry self-host setup archive-team-warrior. " +
			"Keep no project selected until its outbound archival work is explicitly approved. " +
			"Existing saved settings may ignore changed Admin login values; repair them in the control interface without deleting configuration.",
		Credential: "admin",
	})
}

func (App) Check(ctx context.Context, h *helpers.H) error {
	return Verify(ctx, h)
}

func (App) Links() []app.Link { return nil }
