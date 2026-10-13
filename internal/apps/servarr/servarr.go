package servarr

import (
	"context"
	"fmt"
	"path/filepath"
	"strings"
	"time"

	"github.com/ajnart/self-host/internal/helpers"
)

const (
	V3 = "/api/v3"
	V1 = "/api/v1"
)

type Servarr struct {
	Name string
	API  string
}

func Request(h *helpers.H, api string, req helpers.Request) helpers.Request {
	req.Path = api + req.Path
	req.Header = map[string]string{"X-Api-Key": h.Secret(h.Key("api_key"))}
	return req
}

func (s Servarr) Request(h *helpers.H, req helpers.Request) helpers.Request {
	return Request(h, s.API, req)
}

func (s Servarr) Setup(ctx context.Context, h *helpers.H) error {
	if err := h.Ready(ctx, "/ping"); err != nil {
		return err
	}
	err := h.Step(ctx, "api-key", "read the "+s.Name+" API key", helpers.StepSpec{
		Check: func(ctx context.Context) (bool, error) { return s.keyWorks(ctx, h) },
		Do:    func(ctx context.Context) error { return s.ReadAPIKey(ctx, h) },
		Hint:  "Copy the API key from " + s.Name + " > Settings > General into secrets.env as " + h.Key("api_key") + ".",
	})
	if err != nil {
		return err
	}
	return h.Step(ctx, "auth", "require the Admin login (forms authentication)", helpers.StepSpec{
		Check:      func(ctx context.Context) (bool, error) { return s.authConfigured(ctx, h) },
		Do:         func(ctx context.Context) error { return s.setAuth(ctx, h) },
		Hint:       "Open " + s.Name + " > Settings > General > Security: set Authentication to Forms and enter the Admin login.",
		Credential: "admin",
	})
}

func (s Servarr) Check(ctx context.Context, h *helpers.H) error {
	if ok, err := s.keyWorks(ctx, h); !ok {
		return fmt.Errorf("the %s API key is not accepted: %v", s.Name, err)
	}
	if ok, err := loginWorks(ctx, h); !ok {
		return fmt.Errorf("the Admin login %s cannot sign in to %s: %v", h.AdminUser(), s.Name, err)
	}
	return nil
}

func (s Servarr) keyWorks(ctx context.Context, h *helpers.H) (bool, error) {
	if h.Secret(h.Key("api_key")) == "" {
		return false, nil
	}
	resp, err := h.HTTP(ctx, s.Request(h, helpers.Request{Path: "/system/status"}))
	return err == nil && resp.Status == 200, err
}

func (s Servarr) ReadAPIKey(ctx context.Context, h *helpers.H) error {
	key, err := h.ConfigValue(ctx, filepath.Join("config", "config.xml"), helpers.XMLElement("ApiKey"), 2*time.Minute)
	if err != nil {
		return err
	}
	return h.SetSecret(h.Key("api_key"), key)
}

func loginWorks(ctx context.Context, h *helpers.H) (bool, error) {
	resp, err := h.HTTP(ctx, helpers.Request{
		Method: "POST", Path: "/login", NoRedirect: true,
		Form: map[string][]string{"username": {h.AdminUser()}, "password": {h.AdminPassword()}},
	})
	if err != nil {
		return false, err
	}
	if resp.Status < 300 || resp.Status > 399 {
		return false, fmt.Errorf("login returned HTTP %d", resp.Status)
	}
	return !strings.Contains(resp.Header.Get("Location"), "loginFailed=true"), nil
}

type hostConfig map[string]any

func (s Servarr) hostConfig(ctx context.Context, h *helpers.H) (hostConfig, error) {
	resp, err := h.Expect(ctx, s.Request(h, helpers.Request{Path: "/config/host"}))
	if err != nil {
		return nil, err
	}
	var cfg hostConfig
	return cfg, resp.Decode(&cfg)
}

func (s Servarr) authConfigured(ctx context.Context, h *helpers.H) (bool, error) {
	cfg, err := s.hostConfig(ctx, h)
	if err != nil {
		return false, err
	}
	if cfg["authenticationMethod"] != "forms" || cfg["authenticationRequired"] != "enabled" || cfg["username"] != h.AdminUser() {
		return false, nil
	}
	return loginWorks(ctx, h)
}

func (s Servarr) setAuth(ctx context.Context, h *helpers.H) error {
	cfg, err := s.hostConfig(ctx, h)
	if err != nil {
		return err
	}
	cfg["authenticationMethod"] = "forms"
	cfg["authenticationRequired"] = "enabled"
	cfg["username"] = h.AdminUser()
	cfg["password"] = h.AdminPassword()
	cfg["passwordConfirmation"] = h.AdminPassword()
	id, _ := cfg["id"].(float64)
	if _, err := h.Expect(ctx, s.Request(h, helpers.Request{
		Method: "PUT", Path: fmt.Sprintf("/config/host/%d", int(id)), JSON: cfg,
	})); err != nil {
		return err
	}
	if h.Poll(ctx, 30*time.Second, func(ctx context.Context) (bool, error) { return loginWorks(ctx, h) }) == nil {
		return nil
	}
	if err := h.Restart(ctx); err != nil {
		return err
	}
	return h.Poll(ctx, 2*time.Minute, func(ctx context.Context) (bool, error) { return loginWorks(ctx, h) })
}
