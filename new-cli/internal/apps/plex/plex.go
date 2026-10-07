// Package plex is the Plex Media Server.
// Traps: docs/catalog/traps/plex.md.
package plex

import (
	"context"
	"errors"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/ajnart/self-host/internal/app"
	"github.com/ajnart/self-host/internal/helpers"
)

type App struct{}

func (App) Info() app.Info {
	return app.Info{
		ID: "plex", Name: "Plex", Category: "Media",
		Description:   "Streams your read-only media library through a Plex server claimed with your own account.",
		Image:         "plexinc/pms-docker:1.43.4.10903-e5521bd8c",
		Docs:          "https://support.plex.tv/articles/200288586-installation/",
		Port:          32400,
		ContainerPort: 32400,
		Service:       "plex",
	}
}

// Inputs requires the owner's Plex claim token; there is no generated local login.
func (App) Inputs() []app.Input {
	return []app.Input{{
		Key:      "claim_token",
		Prompt:   "Plex claim token",
		Help:     "Create a claim token at https://www.plex.tv/claim and paste it here.",
		Required: true,
	}}
}

// Files writes the claim token for PLEX_CLAIM_FILE, never into Compose or argv.
func (App) Files(rc app.RenderContext, secret func(string) string) []app.File {
	return []app.File{{Path: "claim-token", Content: rc.Inputs["claim_token"], Mode: 0o600}}
}

func (App) Compose(rc app.RenderContext) string {
	port := strconv.Itoa(rc.Port)
	return `services:
  plex:
    image: plexinc/pms-docker:1.43.4.10903-e5521bd8c
    restart: unless-stopped
    environment:
      DEBUG: "false"
      TZ: ${TZ}
      ADVERTISE_IP: http://${LAN_IP}:` + port + `
      PLEX_CLAIM_FILE: /run/secrets/claim-token
    volumes:
      - ./config:/config
      - ./transcode:/transcode
      - ./media-library:/data:ro
      - ./claim-token:/run/secrets/claim-token:ro
    ports:
      - ${BIND_IP}:` + port + `:32400
`
}

const prefs = "/config/Library/Application Support/Plex Media Server/Preferences.xml"

// serverToken extracts only the owned server token and machine identifier from
// the container's Preferences.xml.
func serverToken(ctx context.Context, h *helpers.H) (string, error) {
	result, err := h.Exec(ctx, nil, "xmlstarlet", "sel", "-T", "-t", "-m", "/Preferences",
		"-v", "@PlexOnlineToken", "-n", "-v", "@ProcessedMachineIdentifier", "-n", prefs)
	if err != nil {
		return "", err
	}
	lines := strings.Fields(strings.TrimSpace(string(result.Stdout)))
	if len(lines) != 2 {
		return "", errors.New("Plex server-token extraction returned an unexpected format")
	}
	return lines[0], nil
}

func claimed(ctx context.Context, h *helpers.H) (bool, error) {
	identity, err := h.HTTP(ctx, helpers.Request{Path: "/identity",
		Header: map[string]string{"Accept": "application/json"}})
	if err != nil {
		return false, err
	}
	if identity.Status != http.StatusOK {
		return false, nil
	}
	var info struct {
		MediaContainer struct {
			MachineIdentifier string `json:"machineIdentifier"`
			Claimed           bool   `json:"claimed"`
		} `json:"MediaContainer"`
	}
	if err := identity.Decode(&info); err != nil {
		return false, err
	}
	if !info.MediaContainer.Claimed || info.MediaContainer.MachineIdentifier == "" {
		return false, nil
	}
	anonymous, err := h.HTTP(ctx, helpers.Request{Path: "/library/sections"})
	if err != nil {
		return false, err
	}
	if anonymous.Status != http.StatusUnauthorized && anonymous.Status != http.StatusForbidden {
		return false, nil
	}
	token, err := serverToken(ctx, h)
	if err != nil {
		return false, err
	}
	authorized, err := h.HTTP(ctx, helpers.Request{Path: "/library/sections",
		Header: map[string]string{"X-Plex-Token": token, "Accept": "application/json"}})
	if err != nil {
		return false, err
	}
	return authorized.Status == http.StatusOK, nil
}

func ready(ctx context.Context, h *helpers.H, path string) error {
	probe := func(ctx context.Context) (bool, error) {
		resp, err := h.HTTP(ctx, helpers.Request{Path: path})
		if err != nil {
			return false, err
		}
		return resp.Status < 500, nil
	}
	return h.Step(ctx, "ready", "wait for the web server on "+path, helpers.StepSpec{
		Check: probe,
		Do:    func(ctx context.Context) error { return h.Poll(ctx, 2*time.Minute, probe) },
		Hint:  "Check the App's logs: self-host logs " + h.App,
	})
}

func (App) Setup(ctx context.Context, h *helpers.H) error {
	if err := h.Step(ctx, "claim-token", "read the Plex claim token", helpers.StepSpec{
		Check: func(context.Context) (bool, error) { return h.Inputs["claim_token"] != "", nil },
		Do:    func(context.Context) error { return errors.New("no Plex claim token was supplied") },
		Hint: "Create a claim token at https://www.plex.tv/claim and pass it with " +
			"--set plex.claim_token=TOKEN, then run: self-host install plex",
		Credential: "admin",
	}); err != nil {
		return err
	}
	if err := ready(ctx, h, "/identity"); err != nil {
		return err
	}
	return h.Step(ctx, "claimed", "verify the claimed server and its private token", helpers.StepSpec{
		Check: func(ctx context.Context) (bool, error) { return claimed(ctx, h) },
		Hint: "Complete the first-run claim, then verify this server in your Plex account at https://app.plex.tv; " +
			"if the claim expired, inspect before reclaiming",
		Credential: "admin",
	})
}

func (App) Check(ctx context.Context, h *helpers.H) error {
	ok, err := claimed(ctx, h)
	if err != nil {
		return err
	}
	if !ok {
		return errors.New("the Plex server is not claimed or its private token cannot read the library sections")
	}
	return nil
}

func (App) Links() []app.Link { return nil }
