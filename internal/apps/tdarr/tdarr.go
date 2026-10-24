// Package tdarr is the Tdarr transcode server: its web UI registers the first
// administrator and the internal node starts with every worker disabled.
package tdarr

import (
	"context"
	"fmt"
	"slices"
	"strconv"

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
		Image:         "ghcr.io/haveagitgat/tdarr:2.92.01",
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
    image: ghcr.io/haveagitgat/tdarr:2.92.01
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

// exists reads the unauthenticated verify-token state: 401/403 with
// setupAdmin=true means no owner has registered yet.
func exists(ctx context.Context, h *helpers.H) (bool, error) {
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

func create(ctx context.Context, h *helpers.H, user, password string) error {
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

func setup() firstadmin.FirstAdmin {
	return firstadmin.FirstAdmin{
		Ready:  firstadmin.Probe{Path: "/"},
		Exists: exists,
		Create: create,
		Login:  loginWorks,
		Manual: "Tdarr registers the first administrator on its first-run page.",
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
		Hint: "Back up Tdarr before changing versions; this Link supports Tdarr 2.92.01 or newer 2.x.",
	}); err != nil {
		return err
	}
	if err := setup().Setup(ctx, h); err != nil {
		return err
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
	data, err := ReadHomarr(ctx, h)
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
