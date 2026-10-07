// Package frigate is Frigate. Traps: docs/catalog/traps/frigate.md.
package frigate

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"regexp"
	"strconv"
	"strings"

	"github.com/ajnart/self-host/internal/app"
	"github.com/ajnart/self-host/internal/helpers"
	"github.com/ajnart/self-host/internal/onboard"
)

// App is Frigate. Traps: docs/catalog/traps/frigate.md.
type App struct{}

func (App) Info() app.Info {
	return app.Info{
		ID: "frigate", Name: "Frigate", Category: "Cameras",
		Description:   "Local network video recorder that detects objects on your cameras",
		Image:         "ghcr.io/blakeblackshear/frigate:0.18.0",
		Docs:          "https://docs.frigate.video/guides/getting_started/",
		Port:          8971,
		ContainerPort: 8971,
		Service:       "frigate",
	}
}

func (App) Inputs() []app.Input { return nil }
func (App) Links() []app.Link   { return nil }

// Secrets declares the JWT secret Frigate requires before its first start.
func (App) Secrets() []app.SecretSpec {
	return []app.SecretSpec{{Name: "jwt_secret", Length: 32, Hex: true}}
}

// bootstrapConfig is the read-only, camera-free starter config; only the
// authenticated 8971 listener is published. 8971 serves TLS with a
// self-signed certificate by default, which answers plain HTTP with 400, so
// TLS is off on this private, authenticated listener (as the trap says).
const bootstrapConfig = `version: 0.18
auth:
  enabled: true
tls:
  enabled: false
cameras: {}
`

func (App) Files(_ app.RenderContext, _ func(string) string) []app.File {
	return []app.File{{Path: "bootstrap-config", Content: bootstrapConfig}}
}

func (App) Compose(rc app.RenderContext) string {
	port := strconv.Itoa(rc.Port)
	return `services:
  frigate:
    image: ghcr.io/blakeblackshear/frigate:0.18.0
    restart: unless-stopped
    shm_size: "64mb"
    environment:
      FRIGATE_JWT_SECRET: ${FRIGATE_JWT_SECRET}
    volumes:
      - ./config:/config
      - ./storage:/media/frigate
      - ./bootstrap-config:/config/config.yml:ro
    ports:
      - ${BIND_IP}:` + port + `:8971
    tmpfs:
      - /tmp/cache
`
}

// login returns the private session cookie when the password is accepted.
func login(ctx context.Context, h *helpers.H, user, password string) (string, bool, error) {
	resp, err := h.HTTP(ctx, helpers.Request{
		Method: http.MethodPost, Path: "/api/login",
		JSON: map[string]string{"user": user, "password": password},
	})
	if err != nil {
		return "", false, err
	}
	if resp.Status == http.StatusUnauthorized || resp.Status == http.StatusForbidden {
		return "", false, nil
	}
	if !resp.OK() {
		return "", false, fmt.Errorf("POST /api/login returned HTTP %d", resp.Status)
	}
	return resp.Cookie("frigate_token"), true, nil
}

func loginWorks(ctx context.Context, h *helpers.H, user, password string) (bool, error) {
	_, ok, err := login(ctx, h, user, password)
	return ok, err
}

var temporaryPassword = regexp.MustCompile(`\*\*\*\s+Password:\s+([0-9a-f]{32})\s+\*\*\*`)

// firstUserPassword reads the generated password from the latest fresh-user
// block in the container's whole log: Frigate logs every request, so the
// block scrolls far out of a short tail. A password reset after that block
// is refused.
func firstUserPassword(ctx context.Context, h *helpers.H) (string, error) {
	logs, err := h.Logs(ctx, 1_000_000)
	if err != nil {
		return "", err
	}
	start := strings.LastIndex(logs, "Auth is enabled, but no users exist")
	if start < 0 || strings.Contains(logs[start:], "Reset admin password") {
		return "", errors.New("no fresh Frigate first-user password block in the logs")
	}
	found := temporaryPassword.FindStringSubmatch(logs[start:])
	if found == nil {
		return "", errors.New("no generated administrator password in the Frigate logs")
	}
	return found[1], nil
}

// createAdmin rotates the generated first user to the saved Admin password.
func createAdmin(ctx context.Context, h *helpers.H, user, password string) error {
	denied, err := h.HTTP(ctx, helpers.Request{Path: "/api/profile"})
	if err != nil {
		return err
	}
	if denied.Status != http.StatusUnauthorized && denied.Status != http.StatusForbidden {
		return errors.New("Frigate anonymous profile access was not denied")
	}
	temporary, err := firstUserPassword(ctx, h)
	if err != nil {
		return err
	}
	token, ok, err := login(ctx, h, user, temporary)
	if err != nil {
		return err
	}
	if !ok || token == "" {
		return errors.New("the temporary Frigate administrator password was rejected")
	}
	_, err = h.Expect(ctx, helpers.Request{
		Method: http.MethodPut, Path: "/api/users/" + user + "/password",
		Header: map[string]string{"Cookie": "frigate_token=" + token},
		JSON:   map[string]string{"password": password},
	})
	return err
}

func firstAdmin() onboard.FirstAdmin {
	return onboard.FirstAdmin{
		Ready:  onboard.Probe{Path: "/", Want: []int{http.StatusOK, http.StatusUnauthorized}},
		Create: createAdmin,
		Login:  loginWorks,
		Manual: "sign in with the temporary password printed by the container (`self-host logs frigate`) and change it to the password from `self-host credentials`",
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
		return fmt.Errorf("the Admin login %s cannot sign in to Frigate", h.AdminUser())
	}
	return nil
}
