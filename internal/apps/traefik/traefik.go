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
)

// apiRule mirrors the recipe's GET-only management paths.
const apiRule = "Method(`GET`) && (Path(`/api/version`) || Path(`/api/entrypoints`) || Path(`/api/http/routers`) || Path(`/api/http/services`) || Path(`/api/http/middlewares`) || Path(`/api/tcp/routers`) || Path(`/api/tcp/services`) || Path(`/api/tcp/middlewares`) || Path(`/api/udp/routers`) || Path(`/api/udp/services`))"

// App is Traefik. Traps: docs/catalog/traps/traefik.md.
type App struct{}

func (App) Info() app.Info {
	return app.Info{
		ID: "traefik", Name: "Traefik", Category: "Ingress",
		Description:   "Send web visitors to the right app automatically, with a read-only status page",
		Image:         "traefik:latest",
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
    image: traefik:latest
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
	hash, err := helpers.HashPassword(helpers.Bcrypt, secret("ADMIN_PASSWORD"))
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
		"          - '" + secret("ADMIN_USER") + ":" + hash + "'\n" +
		"        removeHeader: true\n"
	return []app.File{{Path: "management-api", Content: content, Mode: 0o600}}
}

var errAnonymousAPI = errors.New("management API permits anonymous access; refusing to configure credentials")

// adminWorks proves the management API rejects anonymous access and accepts
// only the saved credential's bcrypt hash, with the pinned read-only router.
func adminWorks(ctx context.Context, h *helpers.H) (bool, error) {
	anonymous, err := h.HTTP(ctx, helpers.Request{Path: "/api/version", NoRedirect: true})
	if err != nil {
		return false, managementRequestError(ctx)
	}
	if anonymous.Status == http.StatusOK {
		return false, fmt.Errorf("%w (HTTP 200)", errAnonymousAPI)
	}
	if anonymous.Status != http.StatusUnauthorized {
		return false, fmt.Errorf("anonymous management API probe returned HTTP %d; expected HTTP 401", anonymous.Status)
	}
	version, err := h.HTTP(ctx, helpers.Request{Path: "/api/version", User: h.AdminUser(), Password: h.AdminPassword(), NoRedirect: true})
	if err != nil {
		return false, managementRequestError(ctx)
	}
	if version.Status != http.StatusOK {
		return false, fmt.Errorf("saved management API credential probe returned HTTP %d; expected HTTP 200", version.Status)
	}
	var info struct {
		Version string `json:"Version"`
	}
	if err := version.Decode(&info); err != nil {
		return false, errors.New("authenticated management API returned invalid version JSON")
	}
	if !helpers.VersionCompatible(info.Version, "3.6.22") {
		return false, errors.New("management API version is not Traefik 3.6.22 or newer 3.x")
	}
	routers, err := h.HTTP(ctx, helpers.Request{Path: "/api/http/routers", User: h.AdminUser(), Password: h.AdminPassword(), NoRedirect: true})
	if err != nil {
		return false, managementRequestError(ctx)
	}
	if routers.Status != http.StatusOK {
		return false, fmt.Errorf("authenticated router probe returned HTTP %d; expected HTTP 200", routers.Status)
	}
	var list []struct {
		Name   string `json:"name"`
		Status string `json:"status"`
	}
	if err := routers.Decode(&list); err != nil {
		return false, errors.New("authenticated management API returned invalid router JSON")
	}
	for _, router := range list {
		if router.Name == "selfhost-api@file" && router.Status == "enabled" {
			return true, nil
		}
	}
	return false, errors.New("authenticated management API has no enabled selfhost-api file-provider router")
}

func managementRequestError(ctx context.Context) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	return errors.New("management API request failed before an HTTP response")
}

func waitAdminAPI(ctx context.Context, h *helpers.H) error {
	ctx, cancel := context.WithTimeout(ctx, 2*time.Minute)
	defer cancel()
	var refused error
	err := h.Poll(ctx, 2*time.Minute, func(ctx context.Context) (bool, error) {
		done, err := adminWorks(ctx, h)
		if errors.Is(err, errAnonymousAPI) {
			refused = err
			return true, nil
		}
		return done, err
	})
	if err != nil {
		return err
	}
	return refused
}

func (App) Setup(ctx context.Context, h *helpers.H) error {
	if err := h.Ready(ctx, "/ping", helpers.WantStatus(http.StatusOK)); err != nil {
		return err
	}
	return h.Step(ctx, "admin-api", "verify the "+h.AdminUser()+" control-interface credential", helpers.StepSpec{
		Check: func(ctx context.Context) (bool, error) { return adminWorks(ctx, h) },
		Do:    func(ctx context.Context) error { return waitAdminAPI(ctx, h) },
		Hint: "A responding ping does not prove the file-provider API is ready. HTTP 404 indicates a missing route; " +
			"HTTP 401 for the saved login indicates a credential/config mismatch. Verify the saved login with self-host credentials " +
			"and the restored management-api file; keep the existing login and recreate the container after correcting config.",
		Credential: "control-interface",
	})
}

func (App) Check(ctx context.Context, h *helpers.H) error {
	if ok, err := adminWorks(ctx, h); !ok {
		return fmt.Errorf("Traefik control-interface verification failed: %w", err)
	}
	return nil
}

func (App) Links() []app.Link { return nil }
