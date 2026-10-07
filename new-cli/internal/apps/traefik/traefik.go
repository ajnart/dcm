// Package traefik is the Traefik reverse proxy. Its private, authenticated,
// read-only management API is enabled through the file provider; the docker
// socket is never mounted.
package traefik

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"strconv"
	"time"

	"github.com/ajnart/self-host/internal/app"
	"github.com/ajnart/self-host/internal/helpers"
	"golang.org/x/crypto/bcrypt"
)

// apiRule mirrors the recipe's GET-only management paths.
const apiRule = "Method(`GET`) && (Path(`/api/version`) || Path(`/api/entrypoints`) || Path(`/api/http/routers`) || Path(`/api/http/services`) || Path(`/api/http/middlewares`) || Path(`/api/tcp/routers`) || Path(`/api/tcp/services`) || Path(`/api/tcp/middlewares`) || Path(`/api/udp/routers`) || Path(`/api/udp/services`))"

// App is Traefik. Traps: docs/catalog/traps/traefik.md.
type App struct{}

func (App) Info() app.Info {
	return app.Info{
		ID: "traefik", Name: "Traefik", Category: "Ingress",
		Description:   "Reverse proxy with a private, authenticated read-only management API",
		Image:         "traefik:v3.6.22",
		Docs:          "https://doc.traefik.io/traefik/",
		Port:          8080,
		ContainerPort: 8080,
		Service:       "traefik",
	}
}

func (App) Inputs() []app.Input { return nil }

func (App) Compose(rc app.RenderContext) string {
	port := strconv.Itoa(rc.Port)
	return `services:
  traefik:
    image: traefik:v3.6.22
    restart: unless-stopped
    command:
      - --entryPoints.health.address=:8080
      - --ping=true
      - --ping.entryPoint=health
      - --api=true
      - --api.dashboard=false
      - --api.insecure=false
      - --providers.file.filename=/etc/traefik/dynamic.yml
      - --providers.file.watch=false
      - --log.level=ERROR
    environment:
      TRAEFIK_ADMIN_AUTH_HASH: ${ADMIN_PASSWORD}
    volumes:
      - ./management-api:/etc/traefik/dynamic.yml
    ports:
      - ${BIND_IP}:` + port + `:8080
`
}

// Files writes the file-provider config with a Go-generated bcrypt hash of the
// shared Admin login, mounted read-only to the container.
func (App) Files(_ app.RenderContext, secret func(name string) string) []app.File {
	hash, err := bcrypt.GenerateFromPassword([]byte(secret("ADMIN_PASSWORD")), bcrypt.DefaultCost)
	if err != nil {
		return nil
	}
	content := "http:\n" +
		"  routers:\n" +
		"    selfhost-api:\n" +
		"      entryPoints: [health]\n" +
		"      rule: '" + apiRule + "'\n" +
		"      service: api@internal\n" +
		"      middlewares: [selfhost-auth]\n" +
		"  middlewares:\n" +
		"    selfhost-auth:\n" +
		"      basicAuth:\n" +
		"        users:\n" +
		"          - '" + secret("ADMIN_USER") + ":" + string(hash) + "'\n" +
		"        removeHeader: true\n"
	return []app.File{{Path: "management-api", Content: content, Mode: 0o600}}
}

// adminWorks proves the management API rejects anonymous access and accepts
// only the saved credential's bcrypt hash, with the pinned read-only router.
func adminWorks(ctx context.Context, h *helpers.H) (bool, error) {
	anonymous, err := h.HTTP(ctx, helpers.Request{Path: "/api/version"})
	if err != nil {
		return false, err
	}
	if anonymous.Status != http.StatusUnauthorized {
		return false, nil
	}
	version, err := h.HTTP(ctx, helpers.Request{Path: "/api/version", User: h.AdminUser(), Password: h.AdminPassword()})
	if err != nil {
		return false, err
	}
	if version.Status != http.StatusOK {
		return false, nil
	}
	var info struct {
		Version string `json:"Version"`
	}
	if err := version.Decode(&info); err != nil {
		return false, err
	}
	if info.Version != "3.6.22" {
		return false, nil
	}
	routers, err := h.HTTP(ctx, helpers.Request{Path: "/api/http/routers", User: h.AdminUser(), Password: h.AdminPassword()})
	if err != nil {
		return false, err
	}
	if routers.Status != http.StatusOK {
		return false, nil
	}
	var list []struct {
		Name   string `json:"name"`
		Status string `json:"status"`
	}
	if err := routers.Decode(&list); err != nil {
		return false, err
	}
	for _, router := range list {
		if router.Name == "selfhost-api@file" && router.Status == "enabled" {
			return true, nil
		}
	}
	return false, nil
}

func (App) Setup(ctx context.Context, h *helpers.H) error {
	if err := h.WaitHTTP(ctx, "/ping", 2*time.Minute); err != nil {
		return err
	}
	return h.Step(ctx, "admin-api", "verify the "+h.AdminUser()+" control-interface credential", helpers.StepSpec{
		Check: func(ctx context.Context) (bool, error) { return adminWorks(ctx, h) },
		Do: func(context.Context) error {
			return errors.New("Traefik reads the file-provider config and its bcrypt hash at start")
		},
		Hint: "Regenerate the file-provider config and recreate the container: self-host install traefik, then self-host start traefik. " +
			"Verify with: curl -u " + h.AdminUser() + ":<password from `self-host credentials`> " + h.URL + "/api/version",
		Credential: "control-interface",
	})
}

func (App) Check(ctx context.Context, h *helpers.H) error {
	if ok, err := adminWorks(ctx, h); !ok {
		return fmt.Errorf("the %s control-interface credential is refused by Traefik: %v", h.AdminUser(), err)
	}
	return nil
}

func (App) Links() []app.Link { return nil }
