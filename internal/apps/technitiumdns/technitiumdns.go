// Package technitiumdns is the Technitium DNS Server.
// Traps: docs/catalog/traps/technitium-dns.md.
package technitiumdns

import (
	"context"
	"errors"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/ajnart/self-host/internal/app"
	"github.com/ajnart/self-host/internal/helpers"
)

type App struct{}

func (App) Info() app.Info {
	return app.Info{
		ID: "technitium-dns", Name: "Technitium DNS Server", Category: "DNS",
		Description:   "A self-hosted DNS server with a web console for blocklists and local records.",
		Image:         "technitium/dns-server:15.5.1",
		Docs:          "https://github.com/TechnitiumSoftware/DnsServer/blob/master/docker-compose.yml",
		Port:          5380,
		ContainerPort: 5380,
		Service:       "technitium-dns",
	}
}

func (App) Inputs() []app.Input {
	return []app.Input{{Key: "dns-port", Prompt: "Published DNS port", Default: "53", Help: "TCP and UDP host port; LAN DNS clients normally require port 53", Validate: func(value string) error {
		port, err := strconv.Atoi(value)
		if err != nil || port < 1 || port > 65535 || strings.Trim(value, "0123456789") != "" {
			return errors.New("must be a decimal port from 1 to 65535")
		}
		return nil
	}}}
}

// Files writes the Admin password for DNS_SERVER_ADMIN_PASSWORD_FILE.
func (App) Files(rc app.RenderContext, secret func(string) string) []app.File {
	return []app.File{{Path: "admin-password", Content: secret("ADMIN_PASSWORD"), Mode: 0o600}}
}

func (App) Compose(rc app.RenderContext) string {
	port := strconv.Itoa(rc.Port)
	dnsPort := rc.Inputs["dns-port"]
	if dnsPort == "" {
		dnsPort = "53"
	}
	return `services:
  technitium-dns:
    image: technitium/dns-server:15.5.1
    restart: unless-stopped
    environment:
      DNS_SERVER_DOMAIN: dns-server
      DNS_SERVER_ADMIN_PASSWORD_FILE: /run/secrets/admin-password
    volumes:
      - ./config:/etc/dns
      - ./logs:/var/log/technitium/dns
      - ./admin-password:/run/secrets/admin-password:ro
    ports:
      - ${BIND_IP}:` + dnsPort + `:53/udp
      - ${BIND_IP}:` + dnsPort + `:53/tcp
      - ${BIND_IP}:` + port + `:5380
`
}

func adminWorks(ctx context.Context, h *helpers.H) (bool, error) {
	login, err := h.HTTP(ctx, helpers.Request{Method: http.MethodPost, Path: "/api/user/login",
		Form: url.Values{"user": {h.AdminUser()}, "pass": {h.AdminPassword()}}})
	if err != nil {
		return false, err
	}
	if login.Status != http.StatusOK {
		return false, nil
	}
	var body struct {
		Status   string `json:"status"`
		Username string `json:"username"`
		Token    string `json:"token"`
	}
	if err := login.Decode(&body); err != nil {
		return false, err
	}
	if body.Status != "ok" || body.Token == "" || body.Username != h.AdminUser() {
		return false, nil
	}
	profile, err := h.HTTP(ctx, helpers.Request{Path: "/api/user/profile/get",
		Header: map[string]string{"Authorization": "Bearer " + body.Token}})
	if err != nil {
		return false, err
	}
	if profile.Status != http.StatusOK {
		return false, nil
	}
	var details struct {
		Status   string `json:"status"`
		Response struct {
			Username string `json:"username"`
		} `json:"response"`
	}
	if err := profile.Decode(&details); err != nil {
		return false, err
	}
	return details.Status == "ok" && details.Response.Username == h.AdminUser(), nil
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
	if err := ready(ctx, h, "/"); err != nil {
		return err
	}
	return h.Step(ctx, "admin-login", "authenticate the administrator "+h.AdminUser(), helpers.StepSpec{
		Check: func(ctx context.Context) (bool, error) { return adminWorks(ctx, h) },
		Hint: "Recreate the container so it reads the administrator password file: " +
			"self-host start technitium-dns",
		Credential: "admin",
	})
}

func (App) Check(ctx context.Context, h *helpers.H) error {
	ok, err := adminWorks(ctx, h)
	if err != nil {
		return err
	}
	if !ok {
		return errors.New("the Admin login cannot sign in to the Technitium DNS console")
	}
	return nil
}

func (App) Links() []app.Link { return nil }
