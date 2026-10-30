// Package frigate is Frigate. Traps: docs/catalog/traps/frigate.md.
package frigate

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/ajnart/self-host/internal/app"
	"github.com/ajnart/self-host/internal/firstadmin"
	"github.com/ajnart/self-host/internal/helpers"
)

// App is Frigate. Traps: docs/catalog/traps/frigate.md.
type App struct{}

func (App) Info() app.Info {
	return app.Info{
		ID: "frigate", Name: "Frigate", Category: "Cameras",
		Description:   "Record your security cameras and get alerts when people or cars appear",
		Image:         "ghcr.io/blakeblackshear/frigate:stable",
		Docs:          "https://docs.frigate.video/guides/getting_started/",
		Port:          8971,
		ContainerPort: 8971,
		Service:       "frigate",
	}
}

func (App) Inputs() []app.Input { return nil }
func (App) Links() []app.Link   { return nil }

func (App) StandaloneGuide() string {
	return "Frigate generates the first administrator (admin) and prints its password once in the container logs; sign in with it and change it."
}

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
    image: ghcr.io/blakeblackshear/frigate:stable
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
	if user == "" || password == "" {
		return "", false, errors.New("the Frigate Admin login is missing; run self-host setup frigate")
	}
	denied, err := h.HTTP(ctx, helpers.Request{Path: "/api/profile", NoRedirect: true})
	if err != nil {
		return "", false, errors.New("cannot verify the protected Frigate API; retry self-host setup frigate")
	}
	if denied.Status != http.StatusUnauthorized && denied.Status != http.StatusForbidden {
		return "", false, fmt.Errorf("Frigate anonymous profile access was not denied (HTTP %d)", denied.Status)
	}
	resp, err := h.HTTP(ctx, helpers.Request{
		Method: http.MethodPost, Path: "/api/login",
		JSON: map[string]string{"user": user, "password": password}, NoRedirect: true,
	})
	if err != nil {
		return "", false, errors.New("the Frigate login request failed; retry self-host setup frigate")
	}
	if resp.Status == http.StatusUnauthorized || resp.Status == http.StatusForbidden {
		return "", false, nil
	}
	if resp.Status != http.StatusOK {
		return "", false, fmt.Errorf("POST /api/login returned HTTP %d", resp.Status)
	}
	cookies := (&http.Response{Header: resp.Header}).Cookies()
	token := ""
	for _, cookie := range cookies {
		if cookie.Name != "frigate_token" {
			continue
		}
		if token != "" || len(cookie.Value) > 4096 || !sessionToken.MatchString(cookie.Value) {
			return "", false, errors.New("Frigate returned an invalid or ambiguous session cookie")
		}
		token = cookie.Value
	}
	if token == "" {
		return "", false, errors.New("Frigate did not return its frigate_token session cookie")
	}
	h.Log.Secret(token)
	profile, err := h.HTTP(ctx, helpers.Request{
		Path: "/api/profile", Header: map[string]string{"Authorization": "Bearer " + token}, NoRedirect: true,
	})
	if err != nil {
		return "", false, errors.New("cannot verify the Frigate administrator profile")
	}
	if profile.Status != http.StatusOK {
		return "", false, fmt.Errorf("the authenticated Frigate profile returned HTTP %d", profile.Status)
	}
	var identity struct {
		Username       string   `json:"username"`
		Role           string   `json:"role"`
		AllowedCameras []string `json:"allowed_cameras"`
	}
	if err := profile.Decode(&identity); err != nil || identity.Username != user || identity.Role != "admin" || identity.AllowedCameras == nil {
		return "", false, errors.New("Frigate did not verify the expected administrator and camera permissions")
	}
	return token, true, nil
}

func loginWorks(ctx context.Context, h *helpers.H, user, password string) (bool, error) {
	_, ok, err := login(ctx, h, user, password)
	return ok, err
}

var temporaryPassword = regexp.MustCompile(`\*\*\*\s+Password:\s+([0-9a-f]{32})\s+\*\*\*`)
var sessionToken = regexp.MustCompile(`^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$`)

// firstUserPassword reads the generated password from the latest fresh-user
// block in the container's whole log: Frigate logs every request, so the
// block scrolls far out of a short tail. A password reset after that block
// is refused.
func firstUserPassword(ctx context.Context, h *helpers.H) (string, error) {
	response, err := h.HTTP(ctx, helpers.Request{Path: "/api/auth/first_time_login", NoRedirect: true})
	if err != nil || response.Status != http.StatusOK {
		return "", fmt.Errorf("%w: cannot establish Frigate's first-user state; finish the administrator login privately, then retry self-host setup frigate", helpers.ErrManual)
	}
	var state struct {
		FirstLogin bool `json:"admin_first_time_login"`
	}
	if err := response.Decode(&state); err != nil || !state.FirstLogin {
		return "", fmt.Errorf("%w: Frigate already has an administrator; restore the Admin login through the Project secret boundary and retry self-host setup frigate", helpers.ErrManual)
	}
	logs, err := h.Logs(ctx, 1_000_000)
	if err != nil {
		return "", fmt.Errorf("%w: the private Frigate first-user log is unavailable; finish the administrator login privately and retry self-host setup frigate", helpers.ErrManual)
	}
	start := strings.LastIndex(logs, "Auth is enabled, but no users exist")
	if start < 0 || strings.Count(logs, "Auth is enabled, but no users exist") != 1 || strings.Contains(logs, "Reset admin password") {
		return "", fmt.Errorf("%w: no unambiguous Frigate first-user password block; finish the administrator login privately and retry self-host setup frigate", helpers.ErrManual)
	}
	found := temporaryPassword.FindStringSubmatch(logs[start:])
	if found == nil {
		return "", fmt.Errorf("%w: no generated administrator password in the private Frigate first-user log", helpers.ErrManual)
	}
	h.Log.Secret(found[1])
	return found[1], nil
}

// createAdmin rotates the generated first user to the saved Admin password.
func createAdmin(ctx context.Context, h *helpers.H, user, password string) error {
	if h.Secret(h.Key("admin_rotation_pending")) != "" {
		return fmt.Errorf("%w: the previous Frigate password change is uncertain; restore or finish the Admin login privately, then retry self-host setup frigate", helpers.ErrManual)
	}
	if user != "admin" {
		return fmt.Errorf("%w: Frigate generates the first administrator as admin; create the shared Admin login as an administrator in Frigate's user settings, then retry self-host setup frigate", helpers.ErrManual)
	}
	denied, err := h.HTTP(ctx, helpers.Request{Path: "/api/profile"})
	if err != nil {
		return err
	}
	if denied.Status != http.StatusUnauthorized && denied.Status != http.StatusForbidden {
		return fmt.Errorf("Frigate anonymous profile access was not denied (HTTP %d)", denied.Status)
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
	if err := h.SetSecret(h.Key("admin_rotation_pending"), "true"); err != nil {
		return err
	}
	response, err := h.HTTP(ctx, helpers.Request{
		Method: http.MethodPut, Path: "/api/users/" + user + "/password",
		Header: map[string]string{"Cookie": "frigate_token=" + token},
		JSON:   map[string]string{"password": password}, NoRedirect: true,
	})
	if err != nil {
		return fmt.Errorf("%w: the Frigate password change was not confirmed; finish it privately and retry self-host setup frigate", helpers.ErrManual)
	}
	if response.Status != http.StatusOK {
		return fmt.Errorf("the Frigate password change returned HTTP %d; finish it privately and retry self-host setup frigate", response.Status)
	}
	return nil
}

func firstAdmin() firstadmin.FirstAdmin {
	return firstadmin.FirstAdmin{
		// The static frontend can answer before the authenticated API starts.
		// Wait for the API to deny anonymous access before checking credentials.
		Ready:  firstadmin.Probe{Path: "/api/profile", Want: []int{http.StatusUnauthorized, http.StatusForbidden}},
		Create: createAdmin,
		Login:  loginWorks,
		Manual: "privately inspect the first-login help and `self-host logs frigate`, finish the administrator account using the password from `self-host credentials`, and never share the logs or credentials",
	}
}

func (App) Setup(ctx context.Context, h *helpers.H) error {
	h = apiHelper(ctx, h)
	if err := firstAdmin().Setup(ctx, h); err != nil {
		return err
	}
	if h.Secret(h.Key("admin_rotation_pending")) != "" {
		if err := h.SetSecret(h.Key("admin_rotation_pending"), ""); err != nil {
			return err
		}
	}
	return h.Step(ctx, "api", "verify Frigate server statistics", helpers.StepSpec{
		Check: func(ctx context.Context) (bool, error) {
			_, err := ReadStatistics(ctx, h)
			return err == nil, err
		},
		Do: func(ctx context.Context) error {
			return h.Poll(ctx, 2*time.Minute, func(ctx context.Context) (bool, error) {
				_, err := ReadStatistics(ctx, h)
				return err == nil, err
			})
		},
		Hint: "Keep authentication enabled on Frigate port 8971, restore the Admin login through the Project secret boundary, then run self-host setup frigate. A camera-free server is valid; camera recording and detection need separately approved configuration.",
	})
}

func (App) Check(ctx context.Context, h *helpers.H) error {
	_, err := ReadStatistics(ctx, h)
	return err
}

type Statistics struct {
	Cameras int
	Uptime  float64
	Version string
}

func ReadStatistics(ctx context.Context, h *helpers.H) (Statistics, error) {
	h = apiHelper(ctx, h)
	token, ok, err := login(ctx, h, h.AdminUser(), h.AdminPassword())
	if err != nil {
		return Statistics{}, err
	}
	if !ok {
		return Statistics{}, errors.New("Frigate rejected the Admin login; restore it through the Project secret boundary and retry self-host setup frigate")
	}
	response, err := h.HTTP(ctx, helpers.Request{
		Path: "/api/stats", Header: map[string]string{"Authorization": "Bearer " + token}, NoRedirect: true,
	})
	if err != nil {
		return Statistics{}, errors.New("the authenticated Frigate statistics request failed; retry self-host setup frigate")
	}
	if response.Status != http.StatusOK {
		return Statistics{}, fmt.Errorf("the authenticated Frigate statistics returned HTTP %d; retry self-host setup frigate", response.Status)
	}
	var snapshot struct {
		Cameras map[string]struct{} `json:"cameras"`
		Service struct {
			Uptime  *float64 `json:"uptime"`
			Version string   `json:"version"`
		} `json:"service"`
	}
	if err := response.Decode(&snapshot); err != nil || snapshot.Cameras == nil || snapshot.Service.Uptime == nil || *snapshot.Service.Uptime < 0 || snapshot.Service.Version == "" {
		return Statistics{}, errors.New("Frigate returned incomplete server statistics; retry self-host setup frigate")
	}
	if !helpers.VersionCompatible(snapshot.Service.Version, "0.18.0") {
		return Statistics{}, errors.New("this Frigate API contract supports Frigate 0.18.0 or newer 0.x; back up Frigate before changing its version, then retry Setup")
	}
	return Statistics{Cameras: len(snapshot.Cameras), Uptime: *snapshot.Service.Uptime, Version: snapshot.Service.Version}, nil
}

func VerifyHomarr(ctx context.Context, h *helpers.H) (Statistics, error) {
	h = apiHelper(ctx, h)
	address, err := url.Parse(h.BaseURL)
	if err != nil || address.Scheme != "https" {
		return Statistics{}, fmt.Errorf("%w: Homarr requires trusted HTTPS on Frigate's authenticated port 8971. The current HTTP starter cannot be linked; approve a Project-scoped TLS configuration and certificate trust in Homarr and the CLI before retrying self-host setup frigate and self-host setup homarr. Do not disable authentication or use port 5000", helpers.ErrManual)
	}
	response, err := h.HTTP(ctx, helpers.Request{Path: "/api/profile", NoRedirect: true})
	if err != nil {
		return Statistics{}, fmt.Errorf("%w: Frigate's HTTPS API is unreachable or its certificate is not trusted by the CLI; finish the approved private TLS and certificate-trust configuration, then retry self-host setup frigate and self-host setup homarr", helpers.ErrManual)
	}
	if response.Status != http.StatusUnauthorized && response.Status != http.StatusForbidden {
		return Statistics{}, fmt.Errorf("Frigate's HTTPS API did not deny anonymous profile access (HTTP %d); keep authentication enabled on port 8971 and retry Setup", response.Status)
	}
	return ReadStatistics(ctx, h)
}

func apiHelper(ctx context.Context, h *helpers.H) *helpers.H {
	address, err := url.Parse(h.BaseURL)
	if err != nil || address.Scheme != "http" {
		return h
	}
	response, err := h.HTTP(ctx, helpers.Request{Path: "/api/profile", NoRedirect: true})
	if err != nil || response.Status != http.StatusBadRequest {
		return h
	}
	address.Scheme = "https"
	config := h.Config
	config.BaseURL = address.String()
	return helpers.New(config)
}
