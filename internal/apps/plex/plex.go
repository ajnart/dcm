// Package plex is the Plex Media Server.
// Traps: docs/catalog/traps/plex.md.
package plex

import (
	"context"
	"encoding/json"
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
		Description:   "Stream your movies and shows to any TV, phone or tablet, signed in with Plex",
		Image:         "plexinc/pms-docker:1.43.4.10903-e5521bd8c",
		Docs:          "https://support.plex.tv/articles/200288586-installation/",
		Port:          32400,
		ContainerPort: 32400,
		Service:       "plex",
	}
}

func (App) Inputs() []app.Input {
	return []app.Input{{
		Key:     "claim_token",
		Prompt:  "Plex claim token",
		Help:    "For a new unclaimed server, create a claim token at https://www.plex.tv/claim. Leave empty when this server is already claimed.",
		Private: true,
	}, {
		Key:    "verified_server_id",
		Prompt: "Plex server identifier verified in your account",
		Help:   "After verifying this server in your own Plex account, enter its machine identifier from /identity. Leave empty until you have verified ownership.",
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
func serverToken(ctx context.Context, h *helpers.H) (string, string, error) {
	result, err := h.Exec(ctx, nil, "xmlstarlet", "sel", "-T", "-t", "-m", "/Preferences",
		"-v", "@PlexOnlineToken", "-n", "-v", "@ProcessedMachineIdentifier", "-n", prefs)
	if err != nil {
		return "", "", errors.New("cannot read the owned Plex server token; inspect the server claim, then retry self-host setup plex")
	}
	lines := strings.Fields(strings.TrimSpace(string(result.Stdout)))
	if len(lines) != 2 {
		return "", "", errors.New("Plex server-token extraction returned an unexpected format; inspect the server claim before retrying")
	}
	h.Log.Secret(lines[0])
	return lines[0], lines[1], nil
}

func identity(ctx context.Context, h *helpers.H) (string, bool, error) {
	identity, err := h.HTTP(ctx, helpers.Request{Path: "/identity",
		Header: map[string]string{"Accept": "application/json"}})
	if err != nil {
		return "", false, err
	}
	if identity.Status != http.StatusOK {
		return "", false, errors.New("Plex did not return its server identity; retry self-host setup plex")
	}
	var info struct {
		MediaContainer struct {
			MachineIdentifier string `json:"machineIdentifier"`
			Claimed           *bool  `json:"claimed"`
		} `json:"MediaContainer"`
	}
	if err := identity.Decode(&info); err != nil {
		return "", false, errors.New("Plex returned an invalid server identity")
	}
	if info.MediaContainer.Claimed == nil || info.MediaContainer.MachineIdentifier == "" {
		return "", false, errors.New("Plex returned an incomplete server identity")
	}
	return info.MediaContainer.MachineIdentifier, *info.MediaContainer.Claimed, nil
}

func verifyToken(ctx context.Context, h *helpers.H, token, machineID string) error {
	currentID, claimed, err := identity(ctx, h)
	if err != nil {
		return err
	}
	if !claimed {
		h.Info("Complete and verify this server's claim in your own Plex account, then retry self-host setup plex; an expired claim requires reviewed recovery.")
		return helpers.ErrManual
	}
	if currentID != machineID {
		h.Info("The Plex server identifier changed. Inspect ownership before recovering this Project's Plex credential; no token was replaced.")
		return helpers.ErrManual
	}
	anonymous, err := h.HTTP(ctx, helpers.Request{Path: "/library/sections"})
	if err != nil {
		return err
	}
	if anonymous.Status != http.StatusUnauthorized && anonymous.Status != http.StatusForbidden {
		return errors.New("Plex must reject anonymous library access; review its allowed networks without weakening authentication")
	}
	sections, err := readContainer(ctx, h, token, "/library/sections")
	if err != nil {
		return err
	}
	if *sections.Size != len(sections.Directory) {
		return errors.New("Plex returned incomplete library sections")
	}
	for _, section := range sections.Directory {
		if section.Key == "" || section.Type == "" {
			return errors.New("Plex library sections lack their native identifiers")
		}
	}
	prefs, err := h.HTTP(ctx, helpers.Request{Path: "/prefs",
		Header: map[string]string{"X-Plex-Token": token, "Accept": "application/json"}})
	if err != nil {
		return err
	}
	if prefs.Status != http.StatusOK {
		return errors.New("Plex server token cannot read /prefs as required by Homarr; inspect the server claim and retry self-host setup plex")
	}
	sessions, err := readContainer(ctx, h, token, "/status/sessions")
	if err != nil {
		return err
	}
	if *sessions.Size != len(sessions.Metadata) {
		return errors.New("Plex returned incomplete playback sessions")
	}
	for _, raw := range sessions.Metadata {
		var session struct {
			Session struct {
				ID string `json:"id"`
			} `json:"Session"`
			User struct {
				ID string `json:"id"`
			} `json:"User"`
			Player struct {
				Title string `json:"title"`
			} `json:"Player"`
		}
		if json.Unmarshal(raw, &session) != nil || session.Session.ID == "" || session.User.ID == "" || session.Player.Title == "" {
			return errors.New("Plex playback sessions lack supported session, user or player identifiers")
		}
	}
	releases, err := readContainer(ctx, h, token, "/library/recentlyAdded")
	if err != nil {
		return err
	}
	if *releases.Size != len(releases.Metadata) {
		return errors.New("Plex returned incomplete recently added media")
	}
	for _, raw := range releases.Metadata {
		var release struct {
			Key     string `json:"key"`
			Title   string `json:"title"`
			Type    string `json:"type"`
			AddedAt *int64 `json:"addedAt"`
		}
		if json.Unmarshal(raw, &release) != nil || release.Key == "" || release.Title == "" || release.Type == "" || release.AddedAt == nil {
			return errors.New("Plex recently added media lack supported native metadata")
		}
	}
	return nil
}

type mediaContainer struct {
	Size      *int `json:"size"`
	Directory []struct {
		Key  string `json:"key"`
		Type string `json:"type"`
	} `json:"Directory"`
	Metadata []json.RawMessage `json:"Metadata"`
}

func readContainer(ctx context.Context, h *helpers.H, token, path string) (mediaContainer, error) {
	resp, err := h.HTTP(ctx, helpers.Request{Path: path, Header: map[string]string{"X-Plex-Token": token}})
	if err != nil {
		return mediaContainer{}, err
	}
	if resp.Status != http.StatusOK {
		return mediaContainer{}, errors.New("Plex rejected authenticated data on " + path + "; inspect its claim and retry self-host setup plex")
	}
	var data struct {
		MediaContainer mediaContainer `json:"MediaContainer"`
	}
	if resp.Decode(&data) != nil || data.MediaContainer.Size == nil || *data.MediaContainer.Size < 0 {
		return mediaContainer{}, errors.New("Plex returned invalid or incomplete data on " + path)
	}
	return data.MediaContainer, nil
}

func verifySavedToken(ctx context.Context, h *helpers.H) error {
	token, machineID := h.Secret(h.Key("api_key")), h.Secret(h.Key("server_id"))
	if token == "" || machineID == "" || strings.HasPrefix(token, "claim-") {
		h.Info("The verified Plex server token is missing. Run self-host setup plex; a temporary claim token cannot connect Homarr.")
		return helpers.ErrManual
	}
	h.Log.Secret(token)
	return verifyToken(ctx, h, token, machineID)
}

func saveServerToken(ctx context.Context, h *helpers.H) error {
	machineID, claimed, err := identity(ctx, h)
	if err != nil {
		return err
	}
	if !claimed {
		h.Info("Complete and verify the server claim in your own Plex account before retrying self-host setup plex; no account login or reclaim is automated.")
		return helpers.ErrManual
	}
	if savedID := h.Secret(h.Key("server_id")); savedID != "" && savedID != machineID {
		h.Info("The Plex server identifier changed; review ownership before recovering this Project's saved credential.")
		return helpers.ErrManual
	}
	token, extractedID, err := serverToken(ctx, h)
	if err != nil {
		return err
	}
	if strings.HasPrefix(token, "claim-") {
		return errors.New("Plex has not exchanged its temporary claim for a server token")
	}
	if err := verifyToken(ctx, h, token, extractedID); err != nil {
		return err
	}
	if extractedID != machineID {
		return errors.New("Plex server identity changed during credential discovery; inspect ownership before retrying")
	}
	if err := h.SetSecret(h.Key("server_id"), machineID); err != nil {
		return err
	}
	return h.SetSecret(h.Key("api_key"), token)
}

func VerifyHomarr(ctx context.Context, h *helpers.H) error {
	if h.Inputs["verified_server_id"] == "" || h.Inputs["verified_server_id"] != h.Secret(h.Key("server_id")) {
		h.Info("Verify this server in your own Plex account, then record its machine identifier with self-host install plex --set plex.verified_server_id=<identifier> and retry self-host setup plex homarr. Account ownership is not proved by /identity alone.")
		return helpers.ErrManual
	}
	return verifySavedToken(ctx, h)
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
		Check: func(ctx context.Context) (bool, error) {
			if h.Inputs["claim_token"] != "" {
				return true, nil
			}
			_, claimed, err := identity(ctx, h)
			return claimed, err
		},
		Do: func(context.Context) error { return helpers.ErrManual },
		Hint: "Create a claim token at https://www.plex.tv/claim and pass it with " +
			"--set-file plex.claim_token=/path/to/credential, then run: self-host install plex",
		Credential: "admin",
	}); err != nil {
		return err
	}
	if err := ready(ctx, h, "/identity"); err != nil {
		return err
	}
	if err := h.Step(ctx, "claimed", "verify and save the private Plex server token", helpers.StepSpec{
		Check: func(ctx context.Context) (bool, error) { return verifySavedToken(ctx, h) == nil, nil },
		Do:    func(ctx context.Context) error { return saveServerToken(ctx, h) },
		Hint: "Complete the first-run claim, then verify this server in your Plex account at https://app.plex.tv; " +
			"if the claim expired, inspect before reclaiming",
		Credential: "admin",
	}); err != nil {
		return err
	}
	return h.Step(ctx, "account-ownership", "verify this server in your Plex account", helpers.StepSpec{
		Check: func(context.Context) (bool, error) {
			return h.Inputs["verified_server_id"] != "" && h.Inputs["verified_server_id"] == h.Secret(h.Key("server_id")), nil
		},
		Do:   func(context.Context) error { return helpers.ErrManual },
		Hint: "Verify the intended server in your own Plex account, then record its /identity machine identifier with self-host install plex --set plex.verified_server_id=<identifier> and retry self-host setup plex homarr. No Plex Pass purchase, login or server reclaim is automated.",
	})
}

func (App) Check(ctx context.Context, h *helpers.H) error {
	return VerifyHomarr(ctx, h)
}

func (App) Links() []app.Link { return nil }
