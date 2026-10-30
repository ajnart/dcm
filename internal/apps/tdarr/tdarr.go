// Package tdarr is the Tdarr transcode server: Setup takes over the seeded
// administrator (or registers the first one on 2.x) and the internal node
// starts with every worker disabled.
package tdarr

import (
	"context"
	"errors"
	"fmt"
	"slices"
	"strconv"
	"time"

	"github.com/ajnart/self-host/internal/app"
	"github.com/ajnart/self-host/internal/firstadmin"
	"github.com/ajnart/self-host/internal/helpers"
)

// App is Tdarr. Traps: docs/catalog/traps/tdarr.md.
type App struct{}

func (App) Info() app.Info {
	return app.Info{
		ID: "tdarr", Name: "Tdarr", Category: "Media",
		Description:   "Shrink and convert your video files automatically to save space",
		Image:         "ghcr.io/haveagitgat/tdarr:latest",
		Docs:          "https://docs.tdarr.io/",
		Port:          8265,
		ContainerPort: 8265,
		Service:       "tdarr",
	}
}

func (App) Inputs() []app.Input { return nil }

func (App) Secrets() []app.SecretSpec {
	return []app.SecretSpec{{Name: "api_key_seed", Length: 32}}
}

const source = "webui"

func (App) Compose(rc app.RenderContext) string {
	port := strconv.Itoa(rc.Port)
	return `services:
  tdarr:
    image: ghcr.io/haveagitgat/tdarr:latest
    restart: unless-stopped
    environment:
      PUID: ${PUID}
      PGID: ${PGID}
      TZ: ${TZ}
      serverIP: 0.0.0.0
      serverPort: "8266"
      webUIPort: "8265"
      internalNode: "true"
      inContainer: "true"
      auth: "true"
      seededApiKey: tapi_${TDARR_API_KEY_SEED}
      apiKey: tapi_${TDARR_API_KEY_SEED}
      openBrowser: "false"
      transcodecpuWorkers: "0"
      transcodegpuWorkers: "0"
      healthcheckcpuWorkers: "0"
      healthcheckgpuWorkers: "0"
    volumes:
      - ./server:/app/server
      - ./configs:/app/configs
      - ./logs:/app/logs
      - ./media-library:/media:ro
      - ./transcode-cache:/temp
    ports:
      - ${BIND_IP}:` + port + `:8265
`
}

func (App) Links() []app.Link { return nil }

func (App) StandaloneGuide() string {
	return "After the first start, register the first administrator on the first-run page."
}

func loginWorks(ctx context.Context, h *helpers.H, user, password string) (bool, error) {
	resp, err := h.HTTP(ctx, helpers.Request{
		Method: "POST", Path: "/api/v2/public/auth/login",
		Header: map[string]string{"x-tdarr-request-source": source},
		JSON:   map[string]string{"username": user, "password": password},
	})
	if err != nil {
		return false, err
	}
	if resp.Status == 401 || resp.Status == 403 {
		return false, nil
	}
	if !resp.OK() {
		return false, fmt.Errorf("login returned HTTP %d", resp.Status)
	}
	var login struct {
		Token string `json:"token"`
	}
	if err := resp.Decode(&login); err != nil {
		return false, err
	}
	if login.Token == "" {
		return false, nil
	}
	h.Log.Secret(login.Token)
	verify, err := h.HTTP(ctx, helpers.Request{
		Path: "/api/v2/auth/verify-token",
		Header: map[string]string{
			"Authorization":          "Bearer " + login.Token,
			"x-tdarr-request-source": source,
		},
	})
	if err != nil {
		return false, err
	}
	if !verify.OK() {
		return false, nil
	}
	var owner struct {
		Roles     []string `json:"roles"`
		LocalAuth *bool    `json:"localAuth"`
	}
	if err := verify.Decode(&owner); err != nil {
		return false, err
	}
	return owner.LocalAuth != nil && *owner.LocalAuth && slices.Contains(owner.Roles, "admin"), nil
}

func seedLogin(ctx context.Context, h *helpers.H) (string, error) {
	seed := h.Secret(h.Key("api_key_seed"))
	if seed == "" {
		return "", nil
	}
	return token(ctx, h, "admin", "tapi_"+seed)
}

func token(ctx context.Context, h *helpers.H, user, password string) (string, error) {
	resp, err := h.HTTP(ctx, helpers.Request{
		Method: "POST", Path: "/api/v2/public/auth/login",
		Header: map[string]string{"x-tdarr-request-source": source},
		JSON:   map[string]string{"username": user, "password": password},
	})
	if err != nil {
		return "", err
	}
	if resp.Status == 401 || resp.Status == 403 {
		return "", nil
	}
	if !resp.OK() {
		return "", fmt.Errorf("login returned HTTP %d", resp.Status)
	}
	var login struct {
		Token string `json:"token"`
	}
	if err := resp.Decode(&login); err != nil {
		return "", err
	}
	h.Log.Secret(login.Token)
	return login.Token, nil
}

// exists reports whether an administrator blocks first-run: the seeded 3.x
// admin can still be taken over, and 401/403 with setupAdmin=true means no
// owner has registered yet.
func exists(ctx context.Context, h *helpers.H) (bool, error) {
	seeded, err := seedLogin(ctx, h)
	if err != nil {
		return false, err
	}
	if seeded != "" {
		return false, nil
	}
	resp, err := h.HTTP(ctx, helpers.Request{
		Path:   "/api/v2/auth/verify-token",
		Header: map[string]string{"x-tdarr-request-source": source},
	})
	if err != nil {
		return false, err
	}
	if resp.OK() {
		return false, fmt.Errorf("Tdarr authentication must remain enabled; restore auth=true and retry Setup")
	}
	if resp.Status != 401 && resp.Status != 403 {
		return false, fmt.Errorf("verify-token returned HTTP %d", resp.Status)
	}
	var state struct {
		SetupAdmin *bool `json:"setupAdmin"`
	}
	if err := resp.Decode(&state); err != nil {
		return false, err
	}
	if state.SetupAdmin == nil {
		return true, nil
	}
	return !*state.SetupAdmin, nil
}

func authorized(ctx context.Context, h *helpers.H, path, bearer string, body any) (helpers.Response, error) {
	resp, err := h.HTTP(ctx, helpers.Request{
		Method: "POST", Path: path, JSON: body,
		Header: map[string]string{"x-tdarr-request-source": source, "Authorization": "Bearer " + bearer},
	})
	if err != nil {
		return resp, err
	}
	if !resp.OK() {
		return resp, fmt.Errorf("%s returned HTTP %d", path, resp.Status)
	}
	return resp, nil
}

func create(ctx context.Context, h *helpers.H, user, password string) error {
	seeded, err := seedLogin(ctx, h)
	if err != nil {
		return err
	}
	if seeded != "" {
		return takeOver(ctx, h, seeded, user, password)
	}
	resp, err := h.HTTP(ctx, helpers.Request{
		Method: "POST", Path: "/api/v2/public/auth/register",
		Header: map[string]string{"x-tdarr-request-source": source},
		JSON:   map[string]string{"username": user, "password": password},
	})
	if err != nil {
		return err
	}
	if resp.Status != 201 && !resp.OK() {
		return fmt.Errorf("registering the first administrator returned HTTP %d", resp.Status)
	}
	return nil
}

// takeOver turns the administrator seeded with the native API key into the
// Admin login: the seeded admin is renamed in effect by resetting its password,
// or a second administrator is registered when the Admin username differs.
func takeOver(ctx context.Context, h *helpers.H, seeded, user, password string) error {
	bearer, current := seeded, "tapi_"+h.Secret(h.Key("api_key_seed"))
	if user != "admin" {
		temporary := h.Key("temporary_password")
		current, bearer = h.Secret(temporary), ""
		if current != "" {
			bearer, _ = token(ctx, h, user, current)
		}
		if bearer == "" {
			resp, err := authorized(ctx, h, "/api/v2/admin/register", seeded, map[string]any{
				"username": user, "roles": []string{"admin", "user"},
			})
			if err != nil {
				return err
			}
			var created struct {
				TemporaryPassword string `json:"temporaryPassword"`
			}
			if err := resp.Decode(&created); err != nil || created.TemporaryPassword == "" {
				return errors.New("Tdarr did not return a temporary password for the new administrator")
			}
			current = created.TemporaryPassword
			if err := h.SetSecret(temporary, current); err != nil {
				return err
			}
			bearer, err = token(ctx, h, user, current)
			if err != nil {
				return err
			}
			if bearer == "" {
				return errors.New("the new Tdarr administrator could not sign in with its temporary password")
			}
		}
	}
	_, err := authorized(ctx, h, "/api/v2/auth/reset-password", bearer, map[string]string{"oldPassword": current, "password": password})
	if err != nil {
		return err
	}
	if user != "admin" {
		return h.SetSecret(h.Key("temporary_password"), "")
	}
	return nil
}

func setup() firstadmin.FirstAdmin {
	return firstadmin.FirstAdmin{
		Ready:  firstadmin.Probe{Path: "/"},
		Exists: exists,
		Create: create,
		Login:  loginWorks,
		Manual: "Open Tdarr and register the first administrator on its first-run page.",
	}
}

func (App) Setup(ctx context.Context, h *helpers.H) error {
	if err := h.Ready(ctx, "/api/v2/status", helpers.WantStatus(200)); err != nil {
		return err
	}
	if err := h.Step(ctx, "api-version", "verify the supported Tdarr API", helpers.StepSpec{
		Check: func(ctx context.Context) (bool, error) {
			err := verifyVersion(ctx, h)
			return err == nil, err
		},
		Do:   func(ctx context.Context) error { return verifyVersion(ctx, h) },
		Hint: "Back up Tdarr before changing versions; this Link supports Tdarr 2.92.01 or newer 2.x and 3.x.",
	}); err != nil {
		return err
	}
	if err := setup().Setup(ctx, h); err != nil {
		return err
	}
	if h.Peer("homarr") == nil {
		h.Skip("homarr-api-key", "Homarr is not installed; no Tdarr API key check is needed")
		return nil
	}
	return h.Step(ctx, "homarr-api-key", "verify Tdarr's native API key", helpers.StepSpec{
		Check: func(ctx context.Context) (bool, error) {
			if h.Secret(h.Key("homarr_api_key")) == "" {
				return false, nil
			}
			_, err := ReadHomarr(ctx, h)
			return err == nil, err
		},
		Do: func(ctx context.Context) error {
			if h.Secret(h.Key("homarr_api_key")) == "" {
				seed := h.Secret(h.Key("api_key_seed"))
				if seed == "" {
					return helpers.ErrManual
				}
				if err := h.SetSecret(h.Key("homarr_api_key"), "tapi_"+seed); err != nil {
					return err
				}
			}
			data, err := ReadHomarr(ctx, h)
			if err == nil && data.NodeCount == 0 {
				h.Info("Tdarr's server API answers, but no nodes are connected; processing is unavailable")
			}
			return err
		},
		Hint: "For an older Project, run self-host install tdarr to apply native key seeding without deleting its data. Restore a lost or rejected managed key through the Project secret boundary; do not rotate or adopt another key. Then retry self-host setup tdarr and self-host setup homarr. Workers remain disabled until separately approved.",
	})
}

func (App) Check(ctx context.Context, h *helpers.H) error {
	if err := setup().Check(ctx, h); err != nil {
		return err
	}
	if h.Peer("homarr") == nil {
		return nil
	}
	data, err := ReadHomarr(ctx, h)
	if err == nil && data.NodeCount == 0 {
		var readErr error
		h.Poll(ctx, 2*time.Minute, func(ctx context.Context) (bool, error) {
			data, readErr = ReadHomarr(ctx, h)
			return readErr != nil || data.NodeCount > 0, nil
		})
		err = readErr
	}
	if err == nil {
		switch {
		case data.NodeCount == 0:
			h.Info("Tdarr's server API answers, but no nodes are connected. Restore the existing internal node's saved API key and retry self-host setup tdarr; connecting another node needs separate approval.")
			return helpers.ErrManual
		case data.UnpausedNodes == 0:
			h.Info("Tdarr's server API answers, but every connected node is paused. Review node and media permissions before approving processing, then retry self-host setup tdarr; Setup will not unpause nodes.")
			return helpers.ErrManual
		case data.WorkerCount == 0:
			h.Info("Tdarr's server API answers with no running workers; this verifies monitoring, not processing or hardware")
		}
	}
	return err
}
