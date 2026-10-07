// Package kopia is the Kopia backup server UI. The image seeds its HTTP Basic
// administrator from the Admin login; a repository password is declared for
// the owner-approved repository setup that follows.
package kopia

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"strconv"

	"github.com/ajnart/self-host/internal/app"
	"github.com/ajnart/self-host/internal/helpers"
)

// App is Kopia. Traps: docs/catalog/traps/kopia.md.
type App struct{}

func (App) Info() app.Info {
	return app.Info{
		ID: "kopia", Name: "Kopia", Category: "Backups",
		Description:   "Encrypted backups with a private web UI for the repository",
		Image:         "docker.io/kopia/kopia:0.23.1",
		Docs:          "https://kopia.io/docs/getting-started/",
		Port:          51515,
		ContainerPort: 51515,
		Service:       "kopia",
	}
}

func (App) Inputs() []app.Input { return nil }

// Secrets declares the repository password the owner later uses to create or
// connect a repository. It does not create one; the server password stays the
// shared Admin login.
func (App) Secrets() []app.SecretSpec {
	return []app.SecretSpec{{Name: "repository_password", Length: 48}}
}

func (App) Compose(rc app.RenderContext) string {
	port := strconv.Itoa(rc.Port)
	return `services:
  kopia:
    image: docker.io/kopia/kopia:0.23.1
    restart: unless-stopped
    command:
      - server
      - start
      - --address=0.0.0.0:51515
      - --insecure
      - --async-repo-connect
    environment:
      KOPIA_SERVER_USERNAME: ${ADMIN_USER}
      KOPIA_SERVER_PASSWORD: ${ADMIN_PASSWORD}
      KOPIA_PASSWORD: ${KOPIA_REPOSITORY_PASSWORD}
    volumes:
      - ./config:/app/config
      - ./cache:/app/cache
      - ./logs:/app/logs
    ports:
      - ${BIND_IP}:` + port + `:51515
`
}

const (
	currentUserPath = "/api/v1/current-user"
	basicChallenge  = `Basic realm="Kopia"`
)

// adminWorks proves unauthenticated access is denied, a wrong password is
// refused, and the saved administrator reads the documented current-user body.
func adminWorks(ctx context.Context, h *helpers.H) (bool, error) {
	anonymous, err := h.HTTP(ctx, helpers.Request{Path: currentUserPath})
	if err != nil {
		return false, err
	}
	if anonymous.Status != http.StatusUnauthorized || anonymous.Header.Get("WWW-Authenticate") != basicChallenge {
		return false, nil
	}
	wrong, err := h.HTTP(ctx, helpers.Request{Path: currentUserPath, User: h.AdminUser(), Password: h.AdminPassword() + "-wrong"})
	if err != nil {
		return false, err
	}
	if wrong.Status != http.StatusUnauthorized {
		return false, nil
	}
	resp, err := h.HTTP(ctx, helpers.Request{Path: currentUserPath, User: h.AdminUser(), Password: h.AdminPassword()})
	if err != nil {
		return false, err
	}
	if resp.Status != http.StatusOK {
		return false, nil
	}
	var identity struct {
		Username string `json:"username"`
		Hostname string `json:"hostname"`
	}
	if err := resp.Decode(&identity); err != nil {
		return false, err
	}
	return identity.Username != "" && identity.Hostname != "", nil
}

func (App) Setup(ctx context.Context, h *helpers.H) error {
	if err := h.Ready(ctx, currentUserPath); err != nil {
		return err
	}
	return h.Step(ctx, "admin-auth", "verify the administrator "+h.AdminUser(), helpers.StepSpec{
		Check: func(ctx context.Context) (bool, error) { return adminWorks(ctx, h) },
		Do: func(context.Context) error {
			return errors.New("Kopia reads KOPIA_SERVER_USERNAME and KOPIA_SERVER_PASSWORD only when the server starts")
		},
		Hint: "Kopia binds the Admin login when the server starts. Recreate the container: self-host start kopia, " +
			"then open " + h.URL + " and sign in with the password from `self-host credentials`.",
		Credential: "admin",
	})
}

// Check verifies UI access only. It does not create or connect a repository
// and does not claim backup readiness.
func (App) Check(ctx context.Context, h *helpers.H) error {
	if ok, err := adminWorks(ctx, h); !ok {
		return fmt.Errorf("the Admin login %s cannot sign in to Kopia: %v", h.AdminUser(), err)
	}
	return nil
}

func (App) Links() []app.Link { return nil }
