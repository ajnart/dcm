// Package beszel is the Beszel monitoring hub, with an agent that monitors
// this machine and the read-only Docker socket proxy that agent reads through.
// Traps: docs/catalog/traps/beszel.md.
package beszel

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

const (
	// version is the Hub's version; the agent runs the same one.
	version = "0.20.0"

	AgentService       = "beszel-agent"
	SocketProxyService = "beszel-socket-proxy"
	// DockerSocketMount is the only Docker socket mount any App may declare,
	// and only on SocketProxyService: the proxy denies every write.
	DockerSocketMount = "/var/run/docker.sock:/var/run/docker.sock:ro"
	// SystemName is how this machine appears in the Hub.
	SystemName = "This machine"

	agentPort = "45876"
	proxyPort = "45877"
)

func (App) Info() app.Info {
	return app.Info{
		ID: "beszel", Name: "Beszel", Category: "Monitoring",
		Description:   "A lightweight dashboard for the CPU, memory and disk of the machines you monitor.",
		Image:         "henrygd/beszel:" + version,
		Docs:          "https://www.beszel.dev/guide/hub-installation",
		Port:          8090,
		ContainerPort: 8090,
		Service:       "beszel",
	}
}

func (App) Inputs() []app.Input { return nil }

func (App) Compose(rc app.RenderContext) string {
	port := strconv.Itoa(rc.Port)
	return `services:
  beszel:
    image: henrygd/beszel:` + version + `
    restart: unless-stopped
    environment:
      APP_URL: http://${LAN_IP}:` + port + `
    volumes:
      - ./data:/beszel_data
    ports:
      - ${BIND_IP}:` + port + `:8090
  ` + AgentService + `:
    image: henrygd/beszel-agent:` + version + `
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
    image: lscr.io/linuxserver/socket-proxy:3.4.6
    restart: unless-stopped
    read_only: true
    tmpfs:
      - /run
    environment:
      CONTAINERS: "1"
      POST: "0"
    volumes:
      - ` + DockerSocketMount + `
    ports:
      - 127.0.0.1:` + proxyPort + `:2375
`
}

const emailSuffix = "@selfhost.local"

func adminEmail(h *helpers.H) string { return h.AdminUser() + emailSuffix }

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
		JSON: map[string]string{"identity": adminEmail(h), "password": h.AdminPassword()}})
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
	if body.Token == "" || body.Record.Email != adminEmail(h) || body.Record.Role != "admin" {
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

// machine reports the status of this machine's system in the Hub.
func machine(ctx context.Context, h *helpers.H) (status string, listed bool, err error) {
	resp, err := hubRequest(ctx, h, "/api/collections/systems/records?perPage=500&fields=name,status")
	if err != nil {
		return "", false, err
	}
	var body struct {
		Items []struct {
			Name   string `json:"name"`
			Status string `json:"status"`
		} `json:"items"`
	}
	if err := resp.Decode(&body); err != nil {
		return "", false, err
	}
	for _, item := range body.Items {
		if item.Name == SystemName {
			return item.Status, true, nil
		}
	}
	return "", false, nil
}

func machineUp(ctx context.Context, h *helpers.H) (bool, error) {
	status, listed, err := machine(ctx, h)
	return listed && status == "up", err
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
// token. An existing permanent token is kept: replacing it would disconnect
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
	if err := h.SetSecret(h.Key("agent_key"), key); err != nil {
		return err
	}
	return h.SetSecret(h.Key("agent_token"), token.Token)
}

func startAgent(ctx context.Context, h *helpers.H) error {
	if h.Secret(h.Key("agent_key")) == "" || h.Secret(h.Key("agent_token")) == "" {
		return errors.New("the agent's key and token are not stored yet")
	}
	if err := h.Up(ctx, AgentService); err != nil {
		return err
	}
	return h.Poll(ctx, 2*time.Minute, func(ctx context.Context) (bool, error) { return machineUp(ctx, h) })
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
	user := adminEmail(h)
	if err := h.Step(ctx, "admin-login", "create the Hub administrator "+user, helpers.StepSpec{
		Check: func(ctx context.Context) (bool, error) { return adminSignedIn(ctx, h) },
		Do: func(ctx context.Context) error {
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
		Hint: "Open " + h.URL + " and create the administrator " + user +
			" with the password shown by `self-host credentials`, then run: self-host setup beszel",
		Credential: "admin",
	}); err != nil {
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
		Check: func(ctx context.Context) (bool, error) { return machineUp(ctx, h) },
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
	_, listed, err := machine(ctx, h)
	if err != nil {
		return err
	}
	if !listed {
		return errors.New("this machine is not listed in the Hub; run: self-host setup " + h.App)
	}
	return nil
}

func (App) Links() []app.Link { return nil }
