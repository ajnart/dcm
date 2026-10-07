// Package zerotier is the ZeroTier One virtual LAN node.
// Traps: docs/catalog/traps/zerotier.md.
package zerotier

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/ajnart/self-host/internal/app"
	"github.com/ajnart/self-host/internal/helpers"
)

type App struct{}

func (App) Info() app.Info {
	return app.Info{
		ID: "zerotier", Name: "ZeroTier", Category: "Remote access",
		Description:   "Joins this host to a ZeroTier virtual LAN with a persistent node identity.",
		Image:         "zerotier/zerotier:1.14.2",
		Docs:          "https://docs.zerotier.com/",
		Port:          0,
		ContainerPort: 0,
		Service:       "zerotier",
	}
}

func (App) Inputs() []app.Input { return nil }

// Secrets declares the native service API token, handed to the container as
// ZEROTIER_API_SECRET and never written to Compose.
func (App) Secrets() []app.SecretSpec {
	return []app.SecretSpec{{Name: "api_secret", Length: 48}}
}

// Files disables UPnP/NAT-PMP and in-container reachability beyond the node.
func (App) Files(rc app.RenderContext, secret func(string) string) []app.File {
	return []app.File{{
		Path:    "local-policy",
		Content: `{"settings":{"portMappingEnabled":false,"allowTcpFallbackRelay":false,"allowManaged":false,"allowGlobal":false,"allowDefault":false}}` + "\n",
	}}
}

const version = "1.14.2"

func (App) Compose(rc app.RenderContext) string {
	return `services:
  zerotier:
    image: zerotier/zerotier:1.14.2
    restart: unless-stopped
    cap_add:
      - NET_ADMIN
    devices:
      - /dev/net/tun
    environment:
      ZEROTIER_API_SECRET: ${ZEROTIER_API_SECRET}
    volumes:
      - ./identity:/var/lib/zerotier-one
      - ./local-policy:/var/lib/zerotier-one/local.conf
`
}

var addressPattern = regexp.MustCompile(`^[0-9a-f]{10}$`)

// nativeGet reads the node-local ZeroTier API. The token reaches curl through
// the exec environment, never through argv or logs.
func nativeGet(ctx context.Context, h *helpers.H, path, token string) (int, []byte, error) {
	script := `curl --silent --show-error --max-time 8 --noproxy '*' --write-out '%{http_code}' http://127.0.0.1:9993` + path
	env := map[string]string{}
	if token != "" {
		env["ZT_TOKEN"] = token
		script = `curl --silent --show-error --max-time 8 --noproxy '*' -H "X-ZT1-Auth: $ZT_TOKEN" ` +
			`--write-out '%{http_code}' http://127.0.0.1:9993` + path
	}
	result, err := h.Exec(ctx, env, "sh", "-c", script)
	if err != nil {
		return 0, nil, err
	}
	out := string(result.Stdout)
	if len(out) < 3 {
		return 0, nil, errors.New("ZeroTier native API read returned no status")
	}
	status, err := strconv.Atoi(out[len(out)-3:])
	if err != nil {
		return 0, nil, err
	}
	return status, []byte(out[:len(out)-3]), nil
}

func identityWorks(ctx context.Context, h *helpers.H, token string) (bool, error) {
	for _, path := range []string{"/status", "/controller/network"} {
		status, _, err := nativeGet(ctx, h, path, "")
		if err != nil {
			return false, err
		}
		if status != http.StatusUnauthorized {
			return false, nil
		}
	}
	status, body, err := nativeGet(ctx, h, "/status", token)
	if err != nil {
		return false, err
	}
	if status != http.StatusOK {
		return false, nil
	}
	var node struct {
		Version        string `json:"version"`
		Address        string `json:"address"`
		PublicIdentity string `json:"publicIdentity"`
	}
	if err := json.Unmarshal(body, &node); err != nil {
		return false, err
	}
	if node.Version != version || !addressPattern.MatchString(node.Address) ||
		!strings.HasPrefix(node.PublicIdentity, node.Address+":0:") {
		return false, nil
	}
	for _, path := range []string{"/network", "/controller/network"} {
		status, body, err := nativeGet(ctx, h, path, token)
		if err != nil {
			return false, err
		}
		if status != http.StatusOK {
			return false, nil
		}
		var inventory []any
		if err := json.Unmarshal(body, &inventory); err != nil {
			return false, err
		}
		if len(inventory) != 0 {
			return false, nil
		}
	}
	return true, nil
}

func (App) Setup(ctx context.Context, h *helpers.H) error {
	if err := h.Step(ctx, "ready", "wait for the ZeroTier native API", helpers.StepSpec{
		Check: func(ctx context.Context) (bool, error) {
			status, _, err := nativeGet(ctx, h, "/status", "")
			return status == http.StatusUnauthorized, err
		},
		Do: func(ctx context.Context) error {
			return h.Poll(ctx, 2*time.Minute, func(ctx context.Context) (bool, error) {
				status, _, err := nativeGet(ctx, h, "/status", "")
				return status == http.StatusUnauthorized, err
			})
		},
		Hint: "Read the container logs with: self-host logs zerotier",
	}); err != nil {
		return err
	}
	return h.Step(ctx, "native-identity", "verify the node identity and native API token", helpers.StepSpec{
		Check: func(ctx context.Context) (bool, error) {
			return identityWorks(ctx, h, h.Secret(h.Key("api_secret")))
		},
		Hint: "Recreate the container so it imports ZEROTIER_API_SECRET from secrets.env: " +
			"self-host start zerotier",
		Credential: h.Key("api_secret"),
	})
}

func (App) Check(ctx context.Context, h *helpers.H) error {
	ok, err := identityWorks(ctx, h, h.Secret(h.Key("api_secret")))
	if err != nil {
		return err
	}
	if !ok {
		return errors.New("the ZeroTier native API token or node identity could not be verified")
	}
	return nil
}

func (App) Links() []app.Link { return nil }
