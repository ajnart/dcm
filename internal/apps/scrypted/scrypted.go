// Package scrypted is the Scrypted camera hub: a bridge-only bootstrap that
// creates the private first administrator and its durable owner token.
package scrypted

import (
	"context"
	"fmt"
	"strconv"

	"github.com/ajnart/self-host/internal/app"
	"github.com/ajnart/self-host/internal/firstadmin"
	"github.com/ajnart/self-host/internal/helpers"
)

// App is Scrypted. Traps: docs/catalog/traps/scrypted.md.
type App struct{}

func (App) Info() app.Info {
	return app.Info{
		ID: "scrypted", Name: "Scrypted", Category: "Cameras",
		Description:   "Bring your security cameras into Apple Home and other smart home apps",
		Image:         "ghcr.io/koush/scrypted:lite",
		Docs:          "https://docs.scrypted.app/",
		Port:          11080,
		ContainerPort: 11080,
		Service:       "scrypted",
	}
}

func (App) Inputs() []app.Input { return nil }

func (App) Compose(rc app.RenderContext) string {
	port := strconv.Itoa(rc.Port)
	return `services:
  scrypted:
    image: ghcr.io/koush/scrypted:lite
    restart: unless-stopped
    volumes:
      - ./data:/server/volume
    ports:
      - ${BIND_IP}:` + port + `:11080
`
}

func (App) Links() []app.Link { return nil }

func (App) StandaloneGuide() string {
	return "After the first start, create the first administrator on the login page."
}

// identity is what POST /login returns; hasLogin is present only on the empty
// first-run probe.
type identity struct {
	Username      string `json:"username"`
	Authorization string `json:"authorization"`
	HasLogin      *bool  `json:"hasLogin"`
}

func signIn(ctx context.Context, h *helpers.H, user, password string) (identity, int, error) {
	resp, err := h.HTTP(ctx, helpers.Request{
		Method: "POST", Path: "/login",
		JSON: map[string]string{"username": user, "password": password},
	})
	if err != nil {
		return identity{}, 0, err
	}
	var account identity
	if len(resp.Body) > 0 {
		if err := resp.Decode(&account); err != nil {
			return identity{}, resp.Status, err
		}
	}
	return account, resp.Status, nil
}

// loginWorks proves the saved administrator through a fresh password login.
func loginWorks(ctx context.Context, h *helpers.H, user, password string) (bool, error) {
	account, status, err := signIn(ctx, h, user, password)
	if err != nil {
		return false, err
	}
	if status == 401 {
		return false, nil
	}
	if status < 200 || status >= 300 {
		return false, fmt.Errorf("sign-in returned HTTP %d", status)
	}
	return account.Username == user && account.Authorization != "", nil
}

// exists probes the pinned first-run state with empty credentials.
func exists(ctx context.Context, h *helpers.H) (bool, error) {
	account, status, err := signIn(ctx, h, "", "")
	if err != nil {
		return false, err
	}
	if status < 200 || status >= 300 {
		return false, nil
	}
	return account.HasLogin != nil && *account.HasLogin, nil
}

// create makes the first administrator; empty credentials cannot create a user.
func create(ctx context.Context, h *helpers.H, user, password string) error {
	account, status, err := signIn(ctx, h, user, password)
	if err != nil {
		return err
	}
	if status < 200 || status >= 300 || account.Authorization == "" {
		return fmt.Errorf("creating the first administrator returned HTTP %d", status)
	}
	return nil
}

func setup() firstadmin.FirstAdmin {
	return firstadmin.FirstAdmin{
		Ready:  firstadmin.Probe{Path: "/", Want: []int{200, 302}},
		Exists: exists,
		Create: create,
		Login:  loginWorks,
		Manual: "Scrypted creates the first administrator on its login page.",
	}
}

func (App) Setup(ctx context.Context, h *helpers.H) error { return setup().Setup(ctx, h) }

func (App) Check(ctx context.Context, h *helpers.H) error { return setup().Check(ctx, h) }
