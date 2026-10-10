// Package homeassistant is Home Assistant. Traps: docs/catalog/traps/home-assistant.md.
package homeassistant

import (
	"context"
	"fmt"
	"net/http"
	"strconv"
	"strings"

	"github.com/ajnart/self-host/internal/app"
	"github.com/ajnart/self-host/internal/firstadmin"
	"github.com/ajnart/self-host/internal/helpers"
)

// App is Home Assistant. Traps: docs/catalog/traps/home-assistant.md.
type App struct{}

func (App) Info() app.Info {
	return app.Info{
		ID: "home-assistant", Name: "Home Assistant", Category: "Home automation",
		Description:   "Control and automate your lights, sensors and smart home devices",
		Image:         "ghcr.io/home-assistant/home-assistant:2026.9.3",
		Docs:          "https://www.home-assistant.io/installation/",
		Port:          8123,
		ContainerPort: 8123,
		WebSockets:    true,
		Service:       "home-assistant",
	}
}

func (App) Inputs() []app.Input { return nil }
func (App) Links() []app.Link   { return nil }

// Compose exposes only the web UI on loopback bridge networking; LAN
// discovery, radios and microphones need separate approval.
func (App) Compose(rc app.RenderContext) string {
	port := strconv.Itoa(rc.Port)
	return `services:
  home-assistant:
    image: ghcr.io/home-assistant/home-assistant:2026.9.3
    restart: unless-stopped
    environment:
      TZ: ${TZ}
    volumes:
      - ./config:/config
    ports:
      - ${BIND_IP}:` + port + `:8123
`
}

func clientID(h *helpers.H) string { return strings.TrimRight(h.URL, "/") + "/" }

// userStepDone reports whether the user onboarding step is complete. The
// pinned view is removed after every step is saved, which means done.
func userStepDone(ctx context.Context, h *helpers.H) (bool, error) {
	resp, err := h.HTTP(ctx, helpers.Request{Path: "/api/onboarding"})
	if err != nil {
		return false, err
	}
	if resp.Status == http.StatusNotFound {
		return true, nil
	}
	if resp.Status != http.StatusOK {
		return false, fmt.Errorf("GET /api/onboarding returned HTTP %d", resp.Status)
	}
	var steps []struct {
		Step string `json:"step"`
		Done bool   `json:"done"`
	}
	if err := resp.Decode(&steps); err != nil {
		return false, err
	}
	for _, step := range steps {
		if step.Step == "user" {
			return step.Done, nil
		}
	}
	return false, fmt.Errorf("Home Assistant user onboarding status is missing")
}

func adminExists(ctx context.Context, h *helpers.H) (bool, error) {
	return userStepDone(ctx, h)
}

func createAdmin(ctx context.Context, h *helpers.H, user, password string) error {
	_, err := h.Expect(ctx, helpers.Request{
		Method: http.MethodPost, Path: "/api/onboarding/users",
		JSON: map[string]any{
			"name": "Administrator", "username": user, "password": password,
			"client_id": clientID(h), "language": "en",
		},
	})
	return err
}

// loginWorks runs the same login flow the web UI runs and checks the password
// is accepted; the authorization code itself is left unconsumed.
func loginWorks(ctx context.Context, h *helpers.H, user, password string) (bool, error) {
	id := clientID(h)
	opened, err := h.Expect(ctx, helpers.Request{
		Method: http.MethodPost, Path: "/auth/login_flow",
		JSON: map[string]any{"client_id": id, "redirect_uri": id, "handler": []any{"homeassistant", nil}},
	})
	if err != nil {
		return false, err
	}
	var flow struct {
		Type   string `json:"type"`
		FlowID string `json:"flow_id"`
	}
	if err := opened.Decode(&flow); err != nil {
		return false, err
	}
	if flow.Type != "form" || flow.FlowID == "" {
		return false, fmt.Errorf("Home Assistant returned an unexpected login flow")
	}
	verified, err := h.HTTP(ctx, helpers.Request{
		Method: http.MethodPost, Path: "/auth/login_flow/" + flow.FlowID,
		JSON: map[string]any{"client_id": id, "username": user, "password": password},
	})
	if err != nil {
		return false, err
	}
	if verified.Status == http.StatusNotFound {
		return false, fmt.Errorf("Home Assistant saved login flow is unavailable")
	}
	if !verified.OK() {
		return false, fmt.Errorf("POST /auth/login_flow/%s returned HTTP %d", flow.FlowID, verified.Status)
	}
	var result struct {
		Type   string `json:"type"`
		Result string `json:"result"`
	}
	if err := verified.Decode(&result); err != nil {
		return false, err
	}
	return result.Type == "create_entry" && result.Result != "", nil
}

func firstAdmin() firstadmin.FirstAdmin {
	return firstadmin.FirstAdmin{
		Ready:  firstadmin.Probe{Path: "/", Want: []int{http.StatusOK}},
		Exists: adminExists,
		Create: createAdmin,
		Login:  loginWorks,
		Manual: "open the onboarding page and create the owner with username admin and the password from `self-host credentials`",
	}
}

func (App) Setup(ctx context.Context, h *helpers.H) error {
	return firstAdmin().Setup(ctx, h)
}

func (App) Check(ctx context.Context, h *helpers.H) error {
	ok, err := loginWorks(ctx, h, h.AdminUser(), h.AdminPassword())
	if err != nil {
		return err
	}
	if !ok {
		return fmt.Errorf("the Admin login %s cannot sign in to Home Assistant", h.AdminUser())
	}
	return nil
}
