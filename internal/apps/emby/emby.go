// Package emby is Emby. Traps: docs/catalog/traps/emby.md.
package emby

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"strconv"

	"github.com/ajnart/self-host/internal/app"
	"github.com/ajnart/self-host/internal/firstadmin"
	"github.com/ajnart/self-host/internal/helpers"
)

// App is Emby. Traps: docs/catalog/traps/emby.md.
type App struct{}

func (App) Info() app.Info {
	return app.Info{
		ID: "emby", Name: "Emby", Category: "Media",
		Description:   "Watch your own movies and shows on any TV, phone or computer",
		Image:         "emby/embyserver:latest",
		Docs:          "https://emby.media/support/articles/Installation.html",
		Port:          8096,
		ContainerPort: 8096,
		Service:       "emby",
		UsesMedia:     true,
	}
}

func (App) Inputs() []app.Input { return nil }
func (App) Links() []app.Link   { return nil }

// Compose mounts the shared media root read-only at /mnt/media.
func (App) Compose(rc app.RenderContext) string {
	port := strconv.Itoa(rc.Port)
	return `services:
  emby:
    image: emby/embyserver:latest
    restart: unless-stopped
    volumes:
      - ./config:/config
      - ${MEDIA_ROOT}:/mnt/media:ro
    ports:
      - ${BIND_IP}:` + port + `:8096
`
}

func embyHeader(token string) map[string]string {
	header := map[string]string{
		"Authorization": `Emby Client="selfhost", Device="selfhost-cli", DeviceId="selfhost-cli", Version="1.0.0"`,
	}
	if token != "" {
		header["X-Emby-Token"] = token
	}
	return header
}

func signIn(ctx context.Context, h *helpers.H, user, password string) (string, error) {
	resp, err := h.HTTP(ctx, helpers.Request{
		Method: http.MethodPost, Path: "/Users/AuthenticateByName",
		Header: embyHeader(""), NoRedirect: true,
		Form: url.Values{"Username": {user}, "Pw": {password}},
	})
	if err != nil {
		return "", err
	}
	if resp.Status == http.StatusUnauthorized || resp.Status == http.StatusForbidden {
		return "", nil
	}
	if !resp.OK() {
		return "", fmt.Errorf("Emby sign-in returned HTTP %d", resp.Status)
	}
	var result struct {
		AccessToken string
		User        struct {
			ID     string
			Name   string
			Policy struct {
				IsAdministrator bool `json:"IsAdministrator"`
			} `json:"Policy"`
		} `json:"User"`
	}
	if err := resp.Decode(&result); err != nil {
		return "", errors.New("Emby returned an incomplete administrator sign-in")
	}
	h.Log.Secret(result.AccessToken)
	accepted := false
	defer func() {
		if !accepted && result.AccessToken != "" {
			logout(ctx, h, result.AccessToken)
		}
	}()
	if result.AccessToken == "" || result.User.ID == "" || result.User.Name != user || !result.User.Policy.IsAdministrator {
		return "", errors.New("Emby did not verify the Project administrator")
	}
	resp, err = h.HTTP(ctx, helpers.Request{Path: "/System/Configuration", Header: embyHeader(result.AccessToken), NoRedirect: true})
	if err != nil {
		return "", err
	}
	var configuration struct{ IsStartupWizardCompleted *bool }
	if resp.Status != http.StatusOK || resp.Decode(&configuration) != nil || configuration.IsStartupWizardCompleted == nil {
		return "", errors.New("Emby did not report its first-owner wizard status")
	}
	if !*configuration.IsStartupWizardCompleted {
		return "", helpers.ErrManual
	}
	accepted = true
	return result.AccessToken, nil
}

func logout(ctx context.Context, h *helpers.H, token string) {
	_, _ = h.HTTP(ctx, helpers.Request{Method: http.MethodPost, Path: "/Sessions/Logout", Header: embyHeader(token), NoRedirect: true})
}

func loginWorks(ctx context.Context, h *helpers.H, user, password string) (bool, error) {
	token, err := signIn(ctx, h, user, password)
	if token != "" {
		logout(ctx, h, token)
	}
	return token != "", err
}

// runWizard posts what Emby's web wizard posts. Once the wizard is complete
// every /Startup endpoint answers 401, so an existing owner cannot be reset;
// a 401 here means the Admin login was not the one that created the owner.
func runWizard(ctx context.Context, h *helpers.H, user, password string) error {
	startup := func(method, path string, body any) (helpers.Response, error) {
		return h.HTTP(ctx, helpers.Request{Method: method, Path: path, Header: embyHeader(""), NoRedirect: true, JSON: body})
	}
	resp, err := startup(http.MethodGet, "/Startup/Configuration", nil)
	if err != nil {
		return err
	}
	if resp.Status != http.StatusOK {
		return fmt.Errorf("%w: Emby's first-owner wizard is not open (HTTP %d); finish it by hand", helpers.ErrManual, resp.Status)
	}
	steps := []struct {
		method, path string
		body         any
	}{
		{http.MethodPost, "/Startup/Configuration", map[string]string{"UICulture": "en-US", "MetadataCountryCode": "US", "PreferredMetadataLanguage": "en"}},
		{http.MethodGet, "/Startup/User", nil},
		{http.MethodPost, "/Startup/User", map[string]string{"Name": user, "Password": password}},
		{http.MethodPost, "/Startup/RemoteAccess", map[string]bool{"EnableRemoteAccess": true, "EnableAutomaticPortMapping": false}},
		{http.MethodPost, "/Startup/Complete", nil},
	}
	for _, step := range steps {
		resp, err := startup(step.method, step.path, step.body)
		if err != nil {
			return err
		}
		if !resp.OK() {
			return fmt.Errorf("%s %s returned HTTP %d", step.method, step.path, resp.Status)
		}
	}
	return nil
}

func firstAdmin() firstadmin.FirstAdmin {
	return firstadmin.FirstAdmin{
		Ready:  firstadmin.Probe{Path: "/System/Info/Public"},
		Login:  loginWorks,
		Create: runWizard,
		Manual: "open the first-owner wizard and create the administrator with username admin and the password from `self-host credentials`",
	}
}

func (App) Setup(ctx context.Context, h *helpers.H) error {
	if err := firstAdmin().Setup(ctx, h); err != nil {
		return err
	}
	if h.Peer("homarr") == nil {
		h.Skip("homarr-api-key", "Homarr is not installed; no Emby API key is needed")
		return nil
	}
	return h.Step(ctx, "homarr-api-key", "prepare a dedicated Emby API key", helpers.StepSpec{
		Check: func(ctx context.Context) (bool, error) {
			if APIKey(h) == "" {
				return false, nil
			}
			err := VerifyHomarr(ctx, h)
			return err == nil, err
		},
		Do:         func(ctx context.Context) error { return createHomarrKey(ctx, h) },
		Hint:       "Open " + h.URL + " and inspect Dashboard > Advanced > Security. A matching key name alone does not prove Project ownership; keep user keys and resolve that collision explicitly. Restore a previously created dedicated self-host Homarr key through the Project secret boundary, then run self-host setup emby. Do not delete other keys or change user visibility.",
		Credential: "admin",
	})
}

func (App) Check(ctx context.Context, h *helpers.H) error {
	ok, err := loginWorks(ctx, h, h.AdminUser(), h.AdminPassword())
	if err != nil {
		return err
	}
	if !ok {
		return fmt.Errorf("the Admin login %s cannot sign in to Emby", h.AdminUser())
	}
	return nil
}
