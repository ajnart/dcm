// Package kopia is the Kopia backup server UI. The image seeds its HTTP Basic
// administrator from the Admin login; a repository password is declared for
// the owner-approved repository setup that follows.
package kopia

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"regexp"
	"strconv"

	"github.com/ajnart/self-host/internal/app"
	"github.com/ajnart/self-host/internal/helpers"
)

// App is Kopia. Traps: docs/catalog/traps/kopia.md.
type App struct{}

func (App) Info() app.Info {
	return app.Info{
		ID: "kopia", Name: "Kopia", Category: "Backups",
		Description:   "Back up your files with encryption and check on them from a web page",
		Image:         "docker.io/kopia/kopia:latest",
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
    image: docker.io/kopia/kopia:latest
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
	sessionCookie   = "Kopia-Session-Cookie"
	csrfHeader      = "X-Kopia-Csrf-Token"
)

// Kopia 0.23.1 embeds this hex token in the authenticated UI's head.
var csrfMeta = regexp.MustCompile(`<meta name="kopia-csrf-token" content="([a-f0-9]{64})"\s*/?>`)

// adminWorks proves unauthenticated access is denied, a wrong password is
// refused, and the saved administrator reads current-user using Kopia's UI
// session cookie and CSRF token. This works without a connected repository.
func adminWorks(ctx context.Context, h *helpers.H) (bool, error) {
	anonymous, err := h.HTTP(ctx, helpers.Request{Path: currentUserPath, NoRedirect: true})
	if err != nil {
		return false, requestFailure(ctx)
	}
	if anonymous.Status != http.StatusUnauthorized {
		return false, fmt.Errorf("anonymous Kopia API returned HTTP %d; expected HTTP 401", anonymous.Status)
	}
	if anonymous.Header.Get("WWW-Authenticate") != basicChallenge {
		return false, errors.New("Kopia API did not provide its expected Basic authentication challenge")
	}
	wrong, err := h.HTTP(ctx, helpers.Request{Path: currentUserPath, User: h.AdminUser(), Password: h.AdminPassword() + "-wrong", NoRedirect: true})
	if err != nil {
		return false, requestFailure(ctx)
	}
	if wrong.Status != http.StatusUnauthorized {
		return false, fmt.Errorf("Kopia API accepted an incorrect administrator credential or returned an unexpected response (HTTP %d); expected HTTP 401", wrong.Status)
	}
	session := h.Session()
	ui, err := session.HTTP(ctx, helpers.Request{Path: "/", User: h.AdminUser(), Password: h.AdminPassword(), NoRedirect: true})
	if err != nil {
		return false, requestFailure(ctx)
	}
	if ui.Status != http.StatusOK {
		return false, fmt.Errorf("saved administrator login to the Kopia UI returned HTTP %d; expected HTTP 200", ui.Status)
	}
	token := csrfMeta.FindSubmatch(ui.Body)
	if session.Cookie(sessionCookie) == "" || len(token) != 2 {
		return false, errors.New("authenticated Kopia UI did not supply its session cookie and CSRF token")
	}
	resp, err := session.HTTP(ctx, helpers.Request{Path: currentUserPath, User: h.AdminUser(), Password: h.AdminPassword(), NoRedirect: true,
		Header: map[string]string{csrfHeader: string(token[1])}})
	if err != nil {
		return false, requestFailure(ctx)
	}
	if resp.Status != http.StatusOK {
		return false, fmt.Errorf("authenticated Kopia current-user API returned HTTP %d; expected HTTP 200 with a valid UI session", resp.Status)
	}
	var identity struct {
		Username string `json:"username"`
		Hostname string `json:"hostname"`
	}
	if err := resp.Decode(&identity); err != nil {
		return false, errors.New("authenticated Kopia current-user API returned invalid identity JSON")
	}
	if identity.Username == "" || identity.Hostname == "" {
		return false, errors.New("authenticated Kopia current-user API omitted its username or hostname")
	}
	return true, nil
}

func requestFailure(ctx context.Context) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	return errors.New("Kopia authentication request failed before an HTTP response")
}

func (App) Setup(ctx context.Context, h *helpers.H) error {
	if err := h.Ready(ctx, currentUserPath, helpers.WantStatus(http.StatusUnauthorized), helpers.NoRedirect()); err != nil {
		return err
	}
	return h.Step(ctx, "admin-auth", "verify the administrator "+h.AdminUser(), helpers.StepSpec{
		Check: func(ctx context.Context) (bool, error) { return adminWorks(ctx, h) },
		Do: func(ctx context.Context) error {
			_, err := adminWorks(ctx, h)
			return err
		},
		Hint: "Verify the saved login with self-host credentials. UI HTTP 401 indicates the saved login is refused; " +
			"API HTTP 401 after successful UI login indicates a session/CSRF contract failure. Keep the existing login and repository; " +
			"recreate the container after correcting its server configuration.",
		Credential: "admin",
	})
}

// Check verifies UI access only. It does not create or connect a repository
// and does not claim backup readiness.
func (App) Check(ctx context.Context, h *helpers.H) error {
	if ok, err := adminWorks(ctx, h); !ok {
		return fmt.Errorf("Kopia administrator verification failed: %w", err)
	}
	return nil
}

func (App) Links() []app.Link { return nil }
