// Package slskd is the slskd Soulseek client. Its Web UI takes the Admin login
// and a generated primary API key as environment variables.
package slskd

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"strconv"
	"strings"

	"github.com/ajnart/self-host/internal/app"
	"github.com/ajnart/self-host/internal/firstadmin"
	"github.com/ajnart/self-host/internal/helpers"
)

// App is slskd. Traps: docs/catalog/traps/slskd.md.
type App struct{}

func (App) Info() app.Info {
	return app.Info{
		ID: "slskd", Name: "Slskd", Category: "Downloads",
		Description:   "Share and find music with others on the Soulseek network, from a web page",
		Image:         "ghcr.io/slskd/slskd:0.26.1",
		Docs:          "https://github.com/slskd/slskd/tree/master/docs",
		Port:          5030,
		ContainerPort: 5030,
		Service:       "slskd",
		UsesMedia:     true,
	}
}

func (App) Inputs() []app.Input { return nil }

// Secrets declares the primary API key the image documents, so the documented
// slskd/slskd defaults are never retained.
func (App) Secrets() []app.SecretSpec {
	return []app.SecretSpec{{Name: "api_key", Length: 48}}
}

func (App) Files(app.RenderContext, func(string) string) []app.File {
	return []app.File{{Path: "app/.keep", Mode: 0o644}}
}

func (App) Compose(rc app.RenderContext) string {
	port := strconv.Itoa(rc.Port)
	return `services:
  slskd:
    image: ghcr.io/slskd/slskd:0.26.1
    restart: unless-stopped
    user: ${PUID}:${PGID}
    environment:
      SLSKD_USERNAME: ${ADMIN_USER}
      SLSKD_PASSWORD: ${ADMIN_PASSWORD}
      SLSKD_API_KEY: role=ReadOnly;${SLSKD_API_KEY}
      SLSKD_DOWNLOADS_DIR: /downloads
    volumes:
      - ./app:/app
      - ${DOWNLOADS_ROOT}:/downloads
    ports:
      - ${BIND_IP}:` + port + `:5030
`
}

func isJWT(token string) bool {
	parts := strings.Split(token, ".")
	return len(parts) == 3 && parts[0] != "" && parts[1] != "" && parts[2] != ""
}

// adminWorks proves authentication is enabled, the saved password returns an
// administrator bearer token, and the generated primary API key is accepted.
func adminWorks(ctx context.Context, h *helpers.H) (bool, error) {
	enabled, err := h.HTTP(ctx, helpers.Request{Path: "/api/v0/session/enabled"})
	if err != nil {
		return false, err
	}
	if enabled.Status != http.StatusOK {
		return false, nil
	}
	var isEnabled bool
	if err := enabled.Decode(&isEnabled); err != nil {
		return false, err
	}
	if !isEnabled {
		return false, nil
	}
	login, err := h.HTTP(ctx, helpers.Request{Method: http.MethodPost, Path: "/api/v0/session", JSON: map[string]string{
		"username": h.AdminUser(), "password": h.AdminPassword(),
	}})
	if err != nil {
		return false, err
	}
	if login.Status != http.StatusOK {
		return false, nil
	}
	var session struct {
		Name  string `json:"name"`
		Token string `json:"token"`
	}
	if err := login.Decode(&session); err != nil {
		return false, err
	}
	if session.Name != h.AdminUser() || !isJWT(session.Token) {
		return false, nil
	}
	readback, err := h.HTTP(ctx, helpers.Request{Path: "/api/v0/session", Header: map[string]string{"Authorization": "Bearer " + session.Token}})
	if err != nil {
		return false, err
	}
	if readback.Status != http.StatusOK {
		return false, nil
	}
	key := h.Secret(h.Key("api_key"))
	if key == "" {
		return false, fmt.Errorf("%s is missing from secrets.env", h.Key("api_key"))
	}
	keyed, err := h.HTTP(ctx, helpers.Request{Path: "/api/v0/session", Header: map[string]string{"X-API-Key": key}})
	if err != nil {
		return false, err
	}
	return keyed.Status == http.StatusOK, nil
}

func (App) Setup(ctx context.Context, h *helpers.H) error {
	if err := h.Ready(ctx, "/api/v0/session/enabled"); err != nil {
		return err
	}
	if err := (firstadmin.FirstAdmin{
		StepID: "admin-login",
		Title:  func(_ *helpers.H, user string) string { return "verify the administrator " + user },
		Login: func(ctx context.Context, h *helpers.H, _, _ string) (bool, error) {
			return adminWorks(ctx, h)
		},
		Create: func(context.Context, *helpers.H, string, string) error {
			return errors.New("slskd reads SLSKD_USERNAME/SLSKD_PASSWORD/SLSKD_API_KEY only when the container starts")
		},
		Hint: func(h *helpers.H, _ string) string {
			return "slskd applies the Web UI login and API key on first start. Recreate the container: self-host start slskd, " +
				"then open " + h.URL + " and sign in with the password from `self-host credentials`."
		},
	}).Admin(ctx, h); err != nil {
		return err
	}
	if err := h.Step(ctx, "homarr-api", "verify Slskd download data", helpers.StepSpec{
		Check: func(ctx context.Context) (bool, error) {
			err := VerifyHomarr(ctx, h)
			return err == nil, err
		},
		Do:         func(ctx context.Context) error { return VerifyHomarr(ctx, h) },
		Hint:       "Back up Slskd, then run self-host update slskd to apply version 0.26.1 and its read-only primary API key. Restore a lost key through the Project secret boundary; never paste it into chat. Then retry self-host setup slskd.",
		Credential: "admin",
	}); err != nil {
		return err
	}
	return h.Step(ctx, "soulseek", "verify the Soulseek connection", helpers.StepSpec{
		Check:      func(ctx context.Context) (bool, error) { return soulseekReady(ctx, h) },
		Do:         func(ctx context.Context) error { return VerifySoulseek(ctx, h) },
		Hint:       soulseekHint(h),
		Credential: "admin",
	})
}

// Check verifies the Web UI login and the generated primary API key. It does
// not create a Soulseek protocol account, which needs owner credentials.
func (App) Check(ctx context.Context, h *helpers.H) error {
	if ok, err := adminWorks(ctx, h); !ok || err != nil {
		return fmt.Errorf("the Admin login %s cannot sign in to slskd: %v", h.AdminUser(), err)
	}
	if err := VerifyHomarr(ctx, h); err != nil {
		return err
	}
	return VerifySoulseek(ctx, h)
}

func (App) Links() []app.Link { return nil }
