// Package wud is What's Up Docker: a private image-update inventory for a
// separately approved remote Docker endpoint, never the local socket.
package wud

import (
	"context"
	"crypto/tls"
	"crypto/x509"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/ajnart/self-host/internal/app"
	"github.com/ajnart/self-host/internal/helpers"
)

// App is What's Up Docker. Traps: docs/catalog/traps/wud.md.
type App struct{}

func (App) Info() app.Info {
	return app.Info{
		ID: "wud", Name: "What's Up Docker", Category: "Containers",
		Description:   "Tell you when new versions of your apps are available",
		Image:         "getwud/wud:9.1.0",
		Docs:          "https://getwud.app/docs/",
		Port:          18083,
		ContainerPort: 3000,
		Service:       "wud",
	}
}

// Inputs requires the separately approved remote Docker endpoint; the local
// Docker socket is never mounted, because a :ro bind is not an API permission
// boundary (docs/catalog/traps/wud.md).
func (App) Inputs() []app.Input {
	return []app.Input{
		{
			Key:      "WUD_DOCKER_HOST",
			Prompt:   "DNS name of the approved remote Docker TLS endpoint",
			Help:     "A Docker socket proxy or TLS endpoint whose mutating operations are denied. See https://getwud.app/docs/",
			Required: true,
		},
		{Key: "WUD_DOCKER_PORT", Prompt: "Remote Docker TLS port", Default: "2376"},
		{Key: "WUD_DOCKER_TLS_CLIENT_AUTH", Prompt: "Require Docker TLS client authentication (true or false)", Default: "false", Help: "Prepare tls/ca.pem inside this App directory. When true, also prepare tls/client-cert.pem and private mode-0600 tls/client-key.pem. No external file paths are accepted."},
	}
}

func dockerHost(rc app.RenderContext) string {
	if value := rc.Inputs["WUD_DOCKER_HOST"]; value != "" {
		return value
	}
	return "docker.example.com"
}

func dockerPort(rc app.RenderContext) string {
	if value := rc.Inputs["WUD_DOCKER_PORT"]; value != "" {
		return value
	}
	return "2376"
}

func (App) Compose(rc app.RenderContext) string {
	clientEnvironment, clientMounts := "", ""
	client, _ := strconv.ParseBool(rc.Inputs["WUD_DOCKER_TLS_CLIENT_AUTH"])
	if client {
		clientEnvironment = "      WUD_WATCHER_DOCKER_APPROVED_CERTFILE: /tls/client-cert.pem\n      WUD_WATCHER_DOCKER_APPROVED_KEYFILE: /tls/client-key.pem\n"
		clientMounts = "      - ./tls/client-cert.pem:/tls/client-cert.pem:ro\n      - ./tls/client-key.pem:/tls/client-key.pem:ro\n"
	}
	return `services:
  wud:
    image: getwud/wud:9.1.0
    restart: unless-stopped
    read_only: true
    environment:
      TZ: ${TZ}
      WUD_AUTH_ADMIN_USER: ${ADMIN_USER}
      WUD_AUTH_ADMIN_PASSWORD: ${ADMIN_PASSWORD}
      WUD_SERVER_FEATURE_DELETE: "false"
      WUD_WATCHER_DOCKER_APPROVED_HOST: ` + strconv.Quote(dockerHost(rc)) + `
      WUD_WATCHER_DOCKER_APPROVED_PORT: ` + strconv.Quote(dockerPort(rc)) + `
      WUD_WATCHER_DOCKER_APPROVED_CAFILE: /tls/ca.pem
` + clientEnvironment + `      WUD_WATCHER_DOCKER_APPROVED_WATCHBYDEFAULT: "false"
      WUD_WATCHER_DOCKER_APPROVED_WATCHEVENTS: "false"
    volumes:
      - ./store:/store
      - ./tls/ca.pem:/tls/ca.pem:ro
` + clientMounts + `    ports:
      - ${BIND_IP}:` + fmt.Sprint(rc.Port) + `:3000
`
}

const setupHint = "Set the approved remote Docker endpoint with: self-host install wud --yes --set wud.WUD_DOCKER_HOST=docker.example.com " +
	"--set wud.WUD_DOCKER_PORT=2376 (see https://getwud.app/docs/)"

const tlsHint = "Prepare tls/ca.pem inside apps/wud before installation. For WUD_DOCKER_TLS_CLIENT_AUTH=true, also provide tls/client-cert.pem and mode-0600 tls/client-key.pem. The approved endpoint must verify TLS and deny Docker mutations; UI readiness does not prove watcher inventory."

func (App) Preflight(ctx context.Context, h *helpers.H) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	if err := validateTLS(h); err != nil {
		return fmt.Errorf("Docker TLS prerequisites: %w; %s", err, tlsHint)
	}
	return nil
}

func validateTLS(h *helpers.H) error {
	host := h.Inputs["WUD_DOCKER_HOST"]
	if host == "" || strings.ContainsAny(host, "/\\@?# \t\r\n") {
		return errors.New("WUD_DOCKER_HOST must name the approved Docker TLS endpoint")
	}
	port := h.Inputs["WUD_DOCKER_PORT"]
	if port == "" {
		port = "2376"
	}
	number, err := strconv.Atoi(port)
	if err != nil || number < 1 || number > 65535 {
		return errors.New("WUD_DOCKER_PORT must be a valid TLS port")
	}
	client := false
	if choice := h.Inputs["WUD_DOCKER_TLS_CLIENT_AUTH"]; choice != "" {
		client, err = strconv.ParseBool(choice)
		if err != nil {
			return errors.New("WUD_DOCKER_TLS_CLIENT_AUTH must be true or false")
		}
	}
	for _, dir := range []string{h.Dir, filepath.Dir(h.Dir)} {
		info, err := os.Lstat(dir)
		if err != nil || !info.IsDir() {
			return errors.New("the WUD App and its parent must be real owned directories, without symlink bind ancestors")
		}
	}
	root, err := os.OpenRoot(h.Dir)
	if err != nil {
		return fmt.Errorf("open the owned WUD directory: %w", err)
	}
	defer root.Close()
	info, err := root.Lstat("tls")
	if err != nil || !info.IsDir() {
		return errors.New("tls must be a real directory inside the WUD App directory")
	}
	read := func(name string, private bool) ([]byte, error) {
		info, err := root.Lstat("tls/" + name)
		if err != nil || !info.Mode().IsRegular() {
			return nil, fmt.Errorf("tls/%s must be a regular owned file", name)
		}
		if private && info.Mode().Perm()&0o077 != 0 {
			return nil, fmt.Errorf("tls/%s must have private mode-0600 permissions", name)
		}
		data, err := root.ReadFile("tls/" + name)
		if err != nil {
			return nil, fmt.Errorf("read owned tls/%s: %w", name, err)
		}
		return data, nil
	}
	ca, err := read("ca.pem", false)
	if err != nil {
		return err
	}
	if !x509.NewCertPool().AppendCertsFromPEM(ca) {
		return errors.New("tls/ca.pem does not contain a valid trusted certificate")
	}
	if client {
		cert, err := read("client-cert.pem", false)
		if err != nil {
			return err
		}
		key, err := read("client-key.pem", true)
		if err != nil {
			return err
		}
		if _, err = tls.X509KeyPair(cert, key); err != nil {
			return errors.New("owned TLS client certificate and private key must form a valid matching pair")
		}
	}
	return nil
}

type identity struct {
	Username string `json:"username"`
	Role     string `json:"role"`
	Provider string `json:"provider"`
}

func adminWorks(ctx context.Context, h *helpers.H) (bool, error) {
	resp, err := h.HTTP(ctx, helpers.Request{Path: "/auth/user", User: h.AdminUser(), Password: h.AdminPassword()})
	if err != nil {
		return false, err
	}
	if resp.Status != http.StatusOK {
		return false, nil
	}
	var current identity
	if err := resp.Decode(&current); err != nil {
		return false, err
	}
	return current.Username == h.AdminUser() && current.Role == "admin", nil
}

func (App) Setup(ctx context.Context, h *helpers.H) error {
	host := h.Inputs["WUD_DOCKER_HOST"]
	if err := h.Step(ctx, "docker-endpoint", "the approved remote Docker endpoint is set", helpers.StepSpec{
		Check: func(context.Context) (bool, error) { return host != "", nil },
		Hint:  setupHint,
	}); err != nil {
		return err
	}
	if err := h.Step(ctx, "tls-files", "the owned Docker TLS trust files are valid", helpers.StepSpec{
		Check: func(context.Context) (bool, error) { err := validateTLS(h); return err == nil, err },
		Hint:  tlsHint,
	}); err != nil {
		return err
	}
	if err := h.Ready(ctx, "/auth/user"); err != nil {
		return err
	}
	if err := h.Step(ctx, "admin", "the web UI accepts the Admin login", helpers.StepSpec{
		Check: func(ctx context.Context) (bool, error) { return adminWorks(ctx, h) },
		Do: func(context.Context) error {
			return errors.New("the administrator is seeded from the environment when the container starts")
		},
		Hint:       "Recreate the container so it reads the Admin login from secrets.env: self-host start wud",
		Credential: "admin",
	}); err != nil {
		return err
	}
	// WUD starts discovery on a deferred timer after registration. A working
	// login can precede that scan, so observe approved inventory separately.
	discovery, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	attempt := func(ctx context.Context) (bool, error) { return approvedInventoryReady(ctx, h) }
	return h.Step(discovery, "inventory", "wait for the approved Docker watcher to discover an image", helpers.StepSpec{
		Check: attempt,
		Do: func(ctx context.Context) error {
			if err := refreshSoleApprovedWatcher(ctx, h); err != nil {
				return err
			}
			return h.Poll(ctx, 10*time.Second, attempt)
		},
		Hint: "The approved Docker watcher has not discovered an image; verify endpoint TLS and label an owned container wud.watch=true, then run: self-host setup wud",
	})
}

func (App) Check(ctx context.Context, h *helpers.H) error {
	if err := validateTLS(h); err != nil {
		return fmt.Errorf("Docker TLS prerequisites: %w; %s", err, tlsHint)
	}
	if ok, err := adminWorks(ctx, h); !ok {
		return fmt.Errorf("the administrator %s cannot sign in: %v", h.AdminUser(), err)
	}
	resp, err := h.HTTP(ctx, helpers.Request{Path: "/api/containers"})
	if err != nil {
		return err
	}
	if resp.Status != http.StatusUnauthorized {
		return fmt.Errorf("anonymous inventory access is not denied (HTTP %d)", resp.Status)
	}
	inventory, err := h.HTTP(ctx, helpers.Request{Path: "/api/containers", User: h.AdminUser(), Password: h.AdminPassword()})
	if err != nil {
		return err
	}
	if inventory.Status != http.StatusOK {
		return fmt.Errorf("authenticated watcher inventory returned HTTP %d", inventory.Status)
	}
	var containers []watcherContainer
	if err := inventory.Decode(&containers); err != nil {
		return err
	}
	for _, container := range containers {
		if container.ID == "" || container.Watcher != "approved" {
			continue
		}
		// The collection is persisted state. Only this per-container endpoint
		// re-reads Docker and reports a failed scan instead of returning cache.
		scan, cancel := context.WithTimeout(ctx, 30*time.Second)
		defer cancel()
		fresh, err := h.HTTP(scan, helpers.Request{Method: http.MethodPost, Path: "/api/containers/" + url.PathEscape(container.ID) + "/watch", User: h.AdminUser(), Password: h.AdminPassword()})
		if err != nil {
			return fmt.Errorf("fresh approved Docker watcher scan failed: %w", err)
		}
		if fresh.Status != http.StatusOK {
			return fmt.Errorf("fresh approved Docker watcher scan returned HTTP %d; verify endpoint TLS and the selected owned container", fresh.Status)
		}
		var current struct {
			ID      string `json:"id"`
			Watcher string `json:"watcher"`
			Error   any    `json:"error"`
		}
		if err := fresh.Decode(&current); err != nil {
			return err
		}
		if current.ID != container.ID || current.Watcher != "approved" || current.Error != nil {
			return errors.New("fresh scan did not confirm the selected approved container without a watcher error")
		}
		return nil
	}
	return missingInventory(ctx, h, containers)
}

func (App) Links() []app.Link { return nil }

func boundedInventoryCount(count int) int {
	if count > 1024 {
		return -1
	}
	return count
}

type watcherContainer struct {
	ID      string `json:"id"`
	Watcher string `json:"watcher"`
	Error   any    `json:"error"`
	Image   struct {
		ID string `json:"id"`
	} `json:"image"`
}

func approvedInventoryReady(ctx context.Context, h *helpers.H) (bool, error) {
	if err := ctx.Err(); err != nil {
		return false, err
	}
	response, err := h.HTTP(ctx, helpers.Request{Path: "/api/containers", User: h.AdminUser(), Password: h.AdminPassword()})
	if err != nil {
		return false, errors.New("approved Docker inventory request failed")
	}
	if response.Status != http.StatusOK {
		return false, fmt.Errorf("approved Docker inventory returned HTTP %d", response.Status)
	}
	var containers []watcherContainer
	if response.Decode(&containers) != nil {
		return false, errors.New("approved Docker inventory returned invalid metadata")
	}
	for _, container := range containers {
		if container.ID != "" && container.Watcher == "approved" && container.Error == nil && container.Image.ID != "" {
			// A restored store may still name a removed container. This scoped
			// watch re-reads Docker; neither cached presence nor 404 is readiness.
			fresh, err := h.HTTP(ctx, helpers.Request{Method: http.MethodPost, Path: "/api/containers/" + url.PathEscape(container.ID) + "/watch", User: h.AdminUser(), Password: h.AdminPassword()})
			if err != nil {
				return false, errors.New("fresh approved Docker inventory request failed")
			}
			if fresh.Status != http.StatusOK {
				return false, fmt.Errorf("fresh approved Docker inventory returned HTTP %d", fresh.Status)
			}
			var current watcherContainer
			if fresh.Decode(&current) != nil {
				return false, errors.New("fresh approved Docker inventory returned invalid metadata")
			}
			if current.ID != container.ID || current.Image.ID != container.Image.ID || current.Watcher != "approved" || current.Error != nil {
				return false, errors.New("fresh approved Docker inventory did not confirm the selected container and image")
			}
			return true, nil
		}
	}
	return false, missingInventory(ctx, h, containers)
}

func missingInventory(ctx context.Context, h *helpers.H, containers []watcherContainer) error {
	nonemptyIDs, approvedCount := 0, 0
	for _, container := range containers {
		if container.ID != "" {
			nonemptyIDs++
		}
		if container.Watcher == "approved" {
			approvedCount++
		}
	}
	// The watcher endpoint includes masked configuration. Decode only identity
	// fields and report fixed flags/counts; never emit names or configuration.
	watcherHTTP, dockerWatchers := 0, 0
	approvedRegistered, metadataValid := false, false
	watchers, watcherErr := h.HTTP(ctx, helpers.Request{Path: "/api/watchers", User: h.AdminUser(), Password: h.AdminPassword()})
	if watcherErr == nil {
		watcherHTTP = watchers.Status
		if watcherHTTP == http.StatusOK {
			var registrations []struct{ Type, Name string }
			if watchers.Decode(&registrations) == nil {
				metadataValid = true
				for _, registration := range registrations {
					if registration.Type == "docker" {
						dockerWatchers++
						if registration.Name == "approved" {
							approvedRegistered = true
						}
					}
				}
			}
		}
	}
	inventoryCount := len(containers)
	if inventoryCount > 1024 {
		inventoryCount = -1
	}
	if dockerWatchers > 1024 {
		dockerWatchers = -1
	}
	return fmt.Errorf("the administrator works, but the approved Docker watcher has no verified inventory; inventory_count=%d nonempty_ids=%d approved_count=%d docker_watchers=%d approved_registered=%t watcher_http=%d watcher_metadata_valid=%t; verify the approved TLS endpoint and explicitly label an owned container wud.watch=true", inventoryCount, boundedInventoryCount(nonemptyIDs), boundedInventoryCount(approvedCount), dockerWatchers, approvedRegistered, watcherHTTP, metadataValid)
}

// WUD's registered-watcher API is read-only: registrations come from startup
// configuration. Its all-watch API is confined to the approved boundary only
// when this exact single registration exists; ambiguous scopes need an owner.
func refreshSoleApprovedWatcher(ctx context.Context, h *helpers.H) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	refusal := errors.New("automatic inventory refresh requires exactly one registered docker.approved watcher; manually refresh only the approved watcher and rerun: self-host setup wud")
	response, err := h.HTTP(ctx, helpers.Request{Path: "/api/watchers", User: h.AdminUser(), Password: h.AdminPassword()})
	if err != nil || response.Status != http.StatusOK {
		return refusal
	}
	var watchers []struct{ ID, Type, Name string }
	if response.Decode(&watchers) != nil || len(watchers) != 1 || watchers[0].ID != "docker.approved" || watchers[0].Type != "docker" || watchers[0].Name != "approved" {
		return refusal
	}
	refreshed, err := h.HTTP(ctx, helpers.Request{Method: http.MethodPost, Path: "/api/containers/watch", User: h.AdminUser(), Password: h.AdminPassword()})
	if err != nil {
		return errors.New("approved Docker watcher refresh request failed")
	}
	if refreshed.Status != http.StatusOK {
		return fmt.Errorf("approved Docker watcher refresh returned HTTP %d", refreshed.Status)
	}
	return nil
}
