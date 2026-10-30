// Package actualbudget is Actual Budget, a private budgeting server.
// Traps: docs/catalog/traps/actual-budget.md.
package actualbudget

import (
	"context"
	"errors"
	"net/http"
	"strconv"
	"time"

	"github.com/ajnart/self-host/internal/app"
	"github.com/ajnart/self-host/internal/helpers"
)

type App struct{}

func (App) Info() app.Info {
	return app.Info{
		ID: "actual-budget", Name: "Actual Budget", Category: "Productivity",
		Description:   "Plan your spending and follow every dollar, with one budget on all your devices",
		Image:         "ghcr.io/actualbudget/actual:latest",
		Docs:          "https://actualbudget.org/docs/install/docker/",
		Port:          5006,
		ContainerPort: 5006,
		Service:       "actual-budget",
	}
}

func (App) Inputs() []app.Input { return nil }

func (App) Compose(rc app.RenderContext) string {
	port := strconv.Itoa(rc.Port)
	return `services:
  actual-budget:
    image: ghcr.io/actualbudget/actual:latest
    restart: unless-stopped
    volumes:
      - ./data:/data
    ports:
      - ${BIND_IP}:` + port + `:5006
`
}

func bootstrapped(ctx context.Context, h *helpers.H) (bool, error) {
	resp, err := h.Expect(ctx, helpers.Request{Path: "/account/needs-bootstrap"}, http.StatusOK)
	if err != nil {
		return false, err
	}
	var body struct {
		Data struct {
			Bootstrapped bool `json:"bootstrapped"`
		} `json:"data"`
	}
	if err := resp.Decode(&body); err != nil {
		return false, err
	}
	return body.Data.Bootstrapped, nil
}

// signedIn logs in with the server password and validates the resulting admin session.
func signedIn(ctx context.Context, h *helpers.H, password string) (bool, error) {
	resp, err := h.HTTP(ctx, helpers.Request{Method: http.MethodPost, Path: "/account/login",
		JSON: map[string]string{"password": password}})
	if err != nil {
		return false, err
	}
	if resp.Status != http.StatusOK {
		return false, nil
	}
	var login struct {
		Data struct {
			Token string `json:"token"`
		} `json:"data"`
	}
	if err := resp.Decode(&login); err != nil {
		return false, err
	}
	if login.Data.Token == "" {
		return false, nil
	}
	valid, err := h.HTTP(ctx, helpers.Request{Path: "/account/validate",
		Header: map[string]string{"x-actual-token": login.Data.Token}})
	if err != nil {
		return false, err
	}
	if valid.Status != http.StatusOK {
		return false, nil
	}
	var check struct {
		Data struct {
			Validated  bool   `json:"validated"`
			Permission string `json:"permission"`
		} `json:"data"`
	}
	if err := valid.Decode(&check); err != nil {
		return false, err
	}
	return check.Data.Validated && check.Data.Permission == "ADMIN", nil
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
	if err := ready(ctx, h, "/account/needs-bootstrap"); err != nil {
		return err
	}
	password := h.AdminPassword()
	return h.Step(ctx, "admin-password", "set the server password to the Admin login", helpers.StepSpec{
		Check: func(ctx context.Context) (bool, error) { return signedIn(ctx, h, password) },
		Do: func(ctx context.Context) error {
			initialized, err := bootstrapped(ctx, h)
			if err != nil {
				return err
			}
			if initialized {
				return errors.New("this server was bootstrapped outside setup and the Admin password does not sign in")
			}
			_, err = h.Expect(ctx, helpers.Request{Method: http.MethodPost, Path: "/account/bootstrap",
				JSON: map[string]string{"password": password}}, http.StatusOK)
			return err
		},
		Hint: "Open " + h.URL + " and set the server password to the one shown by `self-host credentials`, " +
			"then run: self-host setup actual-budget",
		Credential: "admin",
	})
}

func (App) Check(ctx context.Context, h *helpers.H) error {
	ok, err := signedIn(ctx, h, h.AdminPassword())
	if err != nil {
		return err
	}
	if !ok {
		return errors.New("the Admin password cannot sign in to Actual Budget")
	}
	return nil
}

func (App) Links() []app.Link { return nil }

func (App) StandaloneGuide() string {
	return "After the first start, open the web page and set the server password."
}
