// Package pihole is Pi-hole, a network-wide DNS ad blocker.
// Traps: docs/catalog/traps/pihole.md.
package pihole

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/ajnart/self-host/internal/app"
	"github.com/ajnart/self-host/internal/helpers"
)

type App struct{}

func (App) Info() app.Info {
	return app.Info{
		ID: "pihole", Name: "Pi-hole", Category: "DNS",
		Description:   "Stop ads and trackers on all your devices at home, with a simple admin page",
		Image:         "pihole/pihole:2026.09.0",
		Docs:          "https://docs.pi-hole.net/docker/",
		Port:          8080,
		ContainerPort: 80,
		Service:       "pihole",
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

// Files writes the Admin password for WEBPASSWORD_FILE; the container reads it
// on startup and never sees the value in Compose or a command line.
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
  pihole:
    image: pihole/pihole:2026.09.0
    restart: unless-stopped
    environment:
      TZ: ${TZ}
      WEBPASSWORD_FILE: admin-password
    volumes:
      - ./config:/etc/pihole
      - ./admin-password:/run/secrets/admin-password:ro
    ports:
      - ${BIND_IP}:` + dnsPort + `:53/udp
      - ${BIND_IP}:` + dnsPort + `:53/tcp
      - ${BIND_IP}:` + port + `:80
`
}

func sessionWorks(ctx context.Context, h *helpers.H) (bool, error) {
	login, err := h.HTTP(ctx, helpers.Request{Method: http.MethodPost, Path: "/api/auth",
		JSON: map[string]string{"password": h.AdminPassword()}, NoRedirect: true})
	if err != nil {
		return false, authFailure(ctx, h, 0, false, "", 0)
	}
	if login.Status != http.StatusOK {
		return false, authFailure(ctx, h, login.Status, false, "", 0)
	}
	var body struct {
		Session struct {
			Valid bool   `json:"valid"`
			SID   string `json:"sid"`
		} `json:"session"`
	}
	if err := login.Decode(&body); err != nil {
		return false, authFailure(ctx, h, login.Status, false, "", 0)
	}
	if !body.Session.Valid || body.Session.SID == "" {
		return false, authFailure(ctx, h, login.Status, body.Session.Valid, body.Session.SID, 0)
	}
	h.Log.Secret(body.Session.SID)
	defer logoutSession(ctx, h, body.Session.SID)
	// This protected local status endpoint avoids the separate update-metadata
	// file required by /api/info/version. Both owner-selected states are valid.
	blocking, err := h.HTTP(ctx, helpers.Request{Path: "/api/dns/blocking",
		Header: map[string]string{"X-FTL-SID": body.Session.SID}, NoRedirect: true})
	if err != nil {
		return false, authFailure(ctx, h, login.Status, body.Session.Valid, body.Session.SID, 0)
	}
	if blocking.Status != http.StatusOK {
		return false, authFailure(ctx, h, login.Status, body.Session.Valid, body.Session.SID, blocking.Status)
	}
	var state struct {
		Blocking string `json:"blocking"`
	}
	if blocking.Decode(&state) != nil || (state.Blocking != "enabled" && state.Blocking != "disabled") {
		return false, fmt.Errorf("%w; blocking_state_valid=false", authFailure(ctx, h, login.Status, body.Session.Valid, body.Session.SID, blocking.Status))
	}
	return true, nil
}

// Failure-only probes retain fixed booleans/statuses, never response text,
// session values, password contents, hashes or container logs.
func authFailure(ctx context.Context, h *helpers.H, login int, valid bool, sid string, blocking int) error {
	ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	header := map[string]string{}
	if sid != "" {
		header["X-FTL-SID"] = sid
	}
	auth, err := h.HTTP(ctx, helpers.Request{Path: "/api/auth", Header: header, NoRedirect: true})
	authStatus := 0
	authValid := false
	if err == nil {
		authStatus = auth.Status
		var body struct {
			Session struct {
				Valid bool `json:"valid"`
			} `json:"session"`
		}
		if auth.Decode(&body) == nil {
			authValid = body.Session.Valid
		}
	}
	metadata := "bootstrap_metadata=unobserved"
	if h.Config.Exec != nil {
		// Docker exec defaults to the image's root bootstrap identity; this
		// observes readability only, without opening the private file.
		res, err := h.Exec(ctx, nil, "sh", "-c", bootstrapMetadataProbe)
		if err == nil && res.ExitCode == 0 {
			facts := strings.Fields(string(res.Stdout))
			if len(facts) == 4 && (facts[0] == "root=true" || facts[0] == "root=false") && (facts[1] == "readable=true" || facts[1] == "readable=false") && (facts[2] == "basename=true" || facts[2] == "basename=false") && (facts[3] == "explicit=true" || facts[3] == "explicit=false") {
				metadata = fmt.Sprintf("exec_%s password_file_%s file_basename_matches=%s explicit_container_password_env=%s", facts[0], facts[1], strings.TrimPrefix(facts[2], "basename="), strings.TrimPrefix(facts[3], "explicit="))
			}
		}
	}
	return fmt.Errorf("Pi-hole auth probe: login_http=%d session_valid=%t sid_present=%t auth_http=%d auth_valid=%t blocking_http=%d; %s (zero HTTP status means unobserved)", login, valid, sid != "", authStatus, authValid, blocking, metadata)
}

const bootstrapMetadataProbe = `set +x
root=false; readable=false; basename=false; explicit=false
[ "$(id -u)" = 0 ] && root=true
[ -r /run/secrets/admin-password ] && readable=true
[ "${WEBPASSWORD_FILE:-}" = admin-password ] && basename=true
[ "${FTLCONF_webserver_api_password+x}" = x ] && explicit=true
printf 'root=%s\nreadable=%s\nbasename=%s\nexplicit=%s\n' "$root" "$readable" "$basename" "$explicit"
`

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
	if err := ready(ctx, h, "/admin/"); err != nil {
		return err
	}
	if err := h.Step(ctx, "admin-login", "authenticate the web password", helpers.StepSpec{
		Check:      func(ctx context.Context) (bool, error) { return adminSessionWorks(ctx, h) },
		Hint:       "Recreate the container so it reads the web password file: self-host start pihole. An existing two-factor Admin login is a person-owned prerequisite; Setup will not disable it or supply a token.",
		Credential: "admin",
	}); err != nil {
		return err
	}
	return h.Step(ctx, "homarr-password", "prepare the dedicated Homarr application password", helpers.StepSpec{
		Check: func(ctx context.Context) (bool, error) {
			if h.Secret(h.Key("homarr_app_password")) == "" {
				return false, nil
			}
			err := VerifyHomarr(ctx, h)
			return err == nil, err
		},
		Do:         func(ctx context.Context) error { return prepareHomarrPassword(ctx, h) },
		Hint:       "Restore the Project's owned application password and hash through its secret boundary. If activation was interrupted, apply only that saved hash in Pi-hole's app_pwhash setting after checking the slot is empty. Keep app_sudo disabled, then retry self-host setup pihole. Never replace another application's password or use the Admin password.",
		Credential: "admin",
	})
}

func (App) Check(ctx context.Context, h *helpers.H) error {
	ok, err := sessionWorks(ctx, h)
	if err != nil {
		return err
	}
	if !ok {
		return errors.New("the Admin password cannot sign in to the Pi-hole web API")
	}
	return nil
}

func (App) Links() []app.Link { return nil }
