// Package beszel is the Beszel monitoring hub, with an agent that monitors
// this machine and the read-only Docker socket proxy that agent reads through.
// Traps: docs/catalog/traps/beszel.md.
package beszel

import (
	"context"
	"errors"
	"net/http"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/ajnart/self-host/internal/app"
	"github.com/ajnart/self-host/internal/firstadmin"
	"github.com/ajnart/self-host/internal/helpers"
)

type App struct{}

func (App) AdminEmail(username string) string {
	if username == "" {
		return ""
	}
	return username + emailSuffix
}

const (
	AgentService       = "beszel-agent"
	SocketProxyService = "beszel-socket-proxy"
	// SystemName is how this machine appears in the Hub.
	SystemName = "This machine"

	dockerSocketTarget = "/var/run/docker.sock"
	agentPort          = "45876"
	proxyPort          = "45877"
)

func (App) DockerSocketTarget() string { return dockerSocketTarget }

// dockerSocketMount is the only Docker socket mount any App may declare, and
// only on SocketProxyService: the proxy denies every write.
func dockerSocketMount(source string) string {
	if source == "" {
		source = dockerSocketTarget
	}
	return source + ":" + dockerSocketTarget + ":ro"
}

func IsDockerSocketMount(mount string) bool {
	suffix := ":" + dockerSocketTarget + ":ro"
	source := strings.TrimSuffix(mount, suffix)
	return source != mount && filepath.IsAbs(source) && filepath.Base(source) == "docker.sock" && !strings.Contains(source, ":")
}

func (App) Info() app.Info {
	return app.Info{
		ID: "beszel", Name: "Beszel", Category: "Monitoring",
		Description:   "See how busy your computers are: processor, memory and disk space",
		Image:         "henrygd/beszel:latest",
		Docs:          "https://www.beszel.dev/guide/hub-installation",
		Port:          8090,
		ContainerPort: 8090,
		WebSockets:    true,
		Service:       "beszel",
	}
}

func (App) Inputs() []app.Input { return nil }

func (App) Compose(rc app.RenderContext) string {
	port := strconv.Itoa(rc.Port)
	return `services:
  beszel:
    image: henrygd/beszel:latest
    restart: unless-stopped
    environment:
      APP_URL: http://${LAN_IP}:` + port + `
    volumes:
      - ./data:/beszel_data
    ports:
      - ${BIND_IP}:` + port + `:8090
  ` + AgentService + `:
    image: henrygd/beszel-agent:latest
    restart: unless-stopped
    network_mode: host
    depends_on:
      - ` + SocketProxyService + `
    environment:
      HUB_URL: http://127.0.0.1:` + port + `
      LISTEN: 127.0.0.1:` + agentPort + `
      KEY: "${BESZEL_AGENT_KEY:-}"
      TOKEN: "${BESZEL_AGENT_TOKEN:-}"
      SYSTEM_NAME: ` + SystemName + `
      DOCKER_HOST: tcp://127.0.0.1:` + proxyPort + `
    volumes:
      - ./agent:/var/lib/beszel-agent
  ` + SocketProxyService + `:
    image: lscr.io/linuxserver/socket-proxy:latest
    restart: unless-stopped
    read_only: true
    tmpfs:
      - /run
    environment:
      CONTAINERS: "1"
      POST: "0"
    volumes:
      - ` + dockerSocketMount(rc.DockerSocket) + `
    ports:
      - 127.0.0.1:` + proxyPort + `:2375
`
}

const emailSuffix = "@selfhost.local"

// AdminEmail is the Admin login in the Hub: the Admin user at a fixed domain.
func AdminEmail(h *helpers.H) string { return (App{}).AdminEmail(h.AdminUser()) }

func firstRun(ctx context.Context, h *helpers.H) (bool, error) {
	resp, err := h.Expect(ctx, helpers.Request{Path: "/api/beszel/first-run"}, http.StatusOK)
	if err != nil {
		return false, err
	}
	var body struct {
		FirstRun bool `json:"firstRun"`
	}
	if err := resp.Decode(&body); err != nil {
		return false, err
	}
	return body.FirstRun, nil
}

// signIn signs in as the Admin login. A refused login is not an error.
func signIn(ctx context.Context, h *helpers.H) (token string, ok bool, err error) {
	resp, err := h.HTTP(ctx, helpers.Request{Method: http.MethodPost,
		Path: "/api/collections/users/auth-with-password",
		JSON: map[string]string{"identity": AdminEmail(h), "password": h.AdminPassword()}})
	if err != nil {
		return "", false, err
	}
	if resp.Status != http.StatusOK {
		return "", false, nil
	}
	var body struct {
		Token  string `json:"token"`
		Record struct {
			Email string `json:"email"`
			Role  string `json:"role"`
		} `json:"record"`
	}
	if err := resp.Decode(&body); err != nil {
		return "", false, err
	}
	if body.Token == "" || body.Record.Email != AdminEmail(h) || body.Record.Role != "admin" {
		return "", false, nil
	}
	return body.Token, true, nil
}

func adminSignedIn(ctx context.Context, h *helpers.H) (bool, error) {
	_, ok, err := signIn(ctx, h)
	return ok, err
}

// hubRequest sends an authenticated request to the Hub as the Admin login.
// PocketBase takes the session token as the whole Authorization header.
func hubRequest(ctx context.Context, h *helpers.H, path string) (helpers.Response, error) {
	token, err := h.Remember("session", func() (string, error) {
		token, ok, err := signIn(ctx, h)
		if err != nil {
			return "", err
		}
		if !ok {
			return "", errors.New("the Admin login cannot sign in to Beszel")
		}
		return token, nil
	})
	if err != nil {
		return helpers.Response{}, err
	}
	resp, err := h.HTTP(ctx, helpers.Request{Path: path, Header: map[string]string{"Authorization": token}})
	if err != nil {
		return resp, err
	}
	if !resp.OK() {
		return resp, errors.New("GET " + strings.SplitN(path, "?", 2)[0] + " returned HTTP " + strconv.Itoa(resp.Status))
	}
	return resp, nil
}

func hubKey(ctx context.Context, h *helpers.H) (string, error) {
	resp, err := hubRequest(ctx, h, "/api/beszel/info")
	if err != nil {
		return "", err
	}
	var body struct {
		Key string `json:"key"`
	}
	if err := resp.Decode(&body); err != nil {
		return "", err
	}
	key := strings.TrimSpace(body.Key)
	if key == "" {
		return "", errors.New("the Hub reported no public key")
	}
	return key, nil
}

type universalToken struct {
	Token     string `json:"token"`
	Active    bool   `json:"active"`
	Permanent bool   `json:"permanent"`
}

func (t universalToken) usable() bool { return t.Token != "" && t.Active && t.Permanent }

func tokenRequest(ctx context.Context, h *helpers.H, query string) (universalToken, error) {
	resp, err := hubRequest(ctx, h, "/api/beszel/universal-token"+query)
	if err != nil {
		return universalToken{}, err
	}
	var token universalToken
	err = resp.Decode(&token)
	return token, err
}

type hubSystem struct {
	ID     string `json:"id"`
	Name   string `json:"name"`
	Status string `json:"status"`
}

func systems(ctx context.Context, h *helpers.H) ([]hubSystem, error) {
	resp, err := hubRequest(ctx, h, "/api/collections/systems/records?perPage=500&fields=id,name,status")
	if err != nil {
		return nil, err
	}
	var body struct {
		Items []hubSystem `json:"items"`
	}
	if err := resp.Decode(&body); err != nil {
		return nil, err
	}
	return body.Items, nil
}

// machine finds this machine's system in the Hub. Once enrolment has stored
// its record id the id decides, so renaming the system in the Hub changes
// nothing; the name only identifies a system that was never enrolled.
func machine(ctx context.Context, h *helpers.H) (hubSystem, bool, error) {
	items, err := systems(ctx, h)
	if err != nil {
		return hubSystem{}, false, err
	}
	stored := h.Secret(h.Key("machine_id"))
	for _, item := range items {
		if item.ID != "" && item.ID == stored {
			return item, true, nil
		}
	}
	for _, item := range items {
		if item.ID != "" && item.Name == SystemName {
			return item, true, nil
		}
	}
	return hubSystem{}, false, nil
}

// MachineID is the Hub's record id for this machine's system, read as the
// Admin login. Homarr's System Stats widget selects a system by it.
func MachineID(ctx context.Context, h *helpers.H) (string, error) {
	system, listed, err := machine(ctx, h)
	if err != nil {
		return "", err
	}
	if !listed {
		return "", errors.New("this machine is not listed in the Hub; run: self-host setup " + h.App)
	}
	return system.ID, nil
}

// enrolled reports that the agent's system is up in the Hub and its record id
// is the one stored, so later Checks keep finding it after a rename.
func enrolled(ctx context.Context, h *helpers.H) (bool, error) {
	system, listed, err := machine(ctx, h)
	return listed && system.Status == "up" && system.ID == h.Secret(h.Key("machine_id")), err
}

func agentSettingsCurrent(ctx context.Context, h *helpers.H) (bool, error) {
	key, token := h.Secret(h.Key("agent_key")), h.Secret(h.Key("agent_token"))
	if key == "" || token == "" {
		return false, nil
	}
	current, err := hubKey(ctx, h)
	if err != nil {
		return false, err
	}
	issued, err := tokenRequest(ctx, h, "")
	if err != nil {
		return false, err
	}
	return key == current && issued.usable() && issued.Token == token, nil
}

// storeAgentSettings saves the Hub's public key and its permanent universal
// token, and recreates the agent when it already had older ones. An existing permanent token is kept: replacing it would disconnect
// every other agent enrolled with it.
func storeAgentSettings(ctx context.Context, h *helpers.H) error {
	key, err := hubKey(ctx, h)
	if err != nil {
		return err
	}
	token, err := tokenRequest(ctx, h, "")
	if err != nil {
		return err
	}
	if !token.usable() {
		token, err = tokenRequest(ctx, h, "?enable=1&permanent=1")
		if err != nil {
			return err
		}
	}
	if !token.usable() {
		return errors.New("the Hub did not issue a permanent universal token")
	}
	replaced := h.Secret(h.Key("agent_key")) != "" && h.Secret(h.Key("agent_token")) != ""
	if err := h.SetSecret(h.Key("agent_key"), key); err != nil {
		return err
	}
	if err := h.SetSecret(h.Key("agent_token"), token.Token); err != nil {
		return err
	}
	if replaced {
		return h.Up(ctx, AgentService)
	}
	return nil
}

// Deferred holds the agent and its socket proxy back from every Compose up
// until the agent's key and token are stored: without them the agent would
// restart in a loop. Setup starts both.
func (App) Deferred(h *helpers.H) []string {
	if h.Secret(h.Key("agent_key")) != "" && h.Secret(h.Key("agent_token")) != "" {
		return nil
	}
	return []string{AgentService, SocketProxyService}
}

func startAgent(ctx context.Context, h *helpers.H) error {
	if h.Secret(h.Key("agent_key")) == "" || h.Secret(h.Key("agent_token")) == "" {
		return errors.New("the agent's key and token are not stored yet")
	}
	if err := h.Up(ctx, AgentService); err != nil {
		return err
	}
	var found hubSystem
	err := h.Poll(ctx, 2*time.Minute, func(ctx context.Context) (bool, error) {
		system, listed, err := machine(ctx, h)
		found = system
		return listed && system.Status == "up", err
	})
	if err != nil {
		return err
	}
	return h.SetSecret(h.Key("machine_id"), found.ID)
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
	if err := ready(ctx, h, "/api/health"); err != nil {
		return err
	}
	user := AdminEmail(h)
	if err := (firstadmin.FirstAdmin{
		StepID:   "admin-login",
		Username: func(context.Context, *helpers.H) (string, error) { return user, nil },
		Title:    func(_ *helpers.H, user string) string { return "create the Hub administrator " + user },
		Login: func(ctx context.Context, h *helpers.H, _, _ string) (bool, error) {
			return adminSignedIn(ctx, h)
		},
		Create: func(ctx context.Context, h *helpers.H, _, _ string) error {
			pending, err := firstRun(ctx, h)
			if err != nil {
				return err
			}
			if !pending {
				return errors.New("this Hub already has an administrator outside setup")
			}
			_, err = h.Expect(ctx, helpers.Request{Method: http.MethodPost, Path: "/api/beszel/create-user",
				JSON: map[string]string{"email": user, "password": h.AdminPassword()}}, http.StatusOK)
			return err
		},
		Hint: func(h *helpers.H, user string) string {
			return "Open " + h.URL + " and create the administrator " + user +
				" with the password shown by `self-host credentials`, then run: self-host setup beszel"
		},
	}).Admin(ctx, h); err != nil {
		return err
	}
	if err := h.Step(ctx, "agent-settings", "get the agent's key and permanent token from the Hub", helpers.StepSpec{
		Check:      func(ctx context.Context) (bool, error) { return agentSettingsCurrent(ctx, h) },
		Do:         func(ctx context.Context) error { return storeAgentSettings(ctx, h) },
		Hint:       "Sign in at " + h.URL + " as " + user + " and open Settings, Tokens, to enable a permanent token, then run: self-host setup beszel",
		Credential: "admin",
	}); err != nil {
		return err
	}
	return h.Step(ctx, "agent", "start the agent and wait for this machine in the Hub", helpers.StepSpec{
		Check: func(ctx context.Context) (bool, error) { return enrolled(ctx, h) },
		Do:    func(ctx context.Context) error { return startAgent(ctx, h) },
		Hint:  "Read the agent's output with: self-host logs " + h.App + "; it needs the Docker socket proxy and port " + agentPort + " free on this machine",
	})
}

func (App) Check(ctx context.Context, h *helpers.H) error {
	ok, err := adminSignedIn(ctx, h)
	if err != nil {
		return err
	}
	if !ok {
		return errors.New("the Admin login cannot sign in to Beszel")
	}
	_, err = MachineID(ctx, h)
	return err
}

func (App) Links() []app.Link { return nil }

func (App) StandaloneGuide() string {
	return "After the first start, create the administrator on the hub's first visit. self-host starts the agent only after its Setup has read the hub's key and token. " +
		"With plain Compose, start the hub, add a system in its web page, set BESZEL_AGENT_KEY and BESZEL_AGENT_TOKEN, then run docker compose up -d again."
}
