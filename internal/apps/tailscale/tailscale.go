// Package tailscale is the Tailscale userspace connector.
// Traps: docs/catalog/traps/tailscale.md.
package tailscale

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"go.yaml.in/yaml/v3"

	"github.com/ajnart/self-host/internal/app"
	"github.com/ajnart/self-host/internal/helpers"
	ts "github.com/ajnart/self-host/internal/tailscale"
)

type App struct{}

func (App) Info() app.Info {
	return app.Info{
		ID: "tailscale", Name: "Tailscale", Category: "Remote access",
		Description:   "Reach your home apps privately from anywhere, on any of your devices",
		Image:         "ghcr.io/tailscale/tailscale:v1.102.4",
		Docs:          "https://tailscale.com/docs/",
		Port:          0,
		ContainerPort: 0,
		Service:       "tailscale",
	}
}

// Inputs requires an owner-issued auth key or OAuth client secret; enrollment cannot be generated locally.
func (App) Inputs() []app.Input {
	return []app.Input{{
		Key:      "auth_key",
		Prompt:   "Tailscale auth key",
		Help:     "Make one reusable, pre-approved key at " + ts.KeysURL + " and paste it here. An OAuth client secret works too.",
		Required: true,
		Private:  true,
	}}
}

// Files writes the key every node reads and each App's serve configuration.
func (App) Files(rc app.RenderContext, secret func(string) string) []app.File {
	files := []app.File{{Path: ts.KeyDir + "/" + ts.KeyFile, Content: ts.KeyFileContent(rc.Inputs["auth_key"]), Mode: 0o600}}
	for _, target := range rc.Web {
		files = append(files, app.File{Path: ts.ServePath(target.ID), Content: ts.ServeConfig(target)})
	}
	return files
}

// Compose renders the connector and, for each App with a web page, its own
// node that serves the App over HTTPS on its own name.
func (App) Compose(rc app.RenderContext) string {
	oauth := ts.IsOAuth(rc.Inputs["auth_key"])
	var b strings.Builder
	b.WriteString(`services:
  tailscale:
    image: ghcr.io/tailscale/tailscale:v1.102.4
    hostname: self-host
    entrypoint: ["/usr/local/bin/tailscaled"]
    command: ["--tun=userspace-networking", "--state=/var/lib/tailscale/tailscaled.state", "--socket=/tmp/tailscaled.sock"]
    restart: unless-stopped
    volumes:
      - ./state:/var/lib/tailscale
      - ./keys:/run/secrets:ro
`)
	for _, target := range rc.Web {
		b.WriteString(ts.Sidecar(target, oauth))
	}
	return b.String()
}

func connected(ctx context.Context, h *helpers.H, service string) (ts.Node, error) {
	result, err := h.ExecIn(ctx, service, nil, ts.StatusCommand()...)
	if err != nil {
		return ts.Node{}, err
	}
	return ts.ParseStatus(result.Stdout)
}

func running(ctx context.Context, h *helpers.H) (bool, error) {
	node, err := connected(ctx, h, h.Service)
	if err != nil {
		return false, err
	}
	return node.Running(), nil
}

// nodes lists the Apps that have a node, read from the Compose file Install wrote.
func nodes(h *helpers.H) []string {
	data, err := os.ReadFile(filepath.Join(h.Dir, "compose.yml"))
	if err != nil {
		return nil
	}
	var doc struct {
		Services map[string]any `yaml:"services"`
	}
	if yaml.Unmarshal(data, &doc) != nil {
		return nil
	}
	var ids []string
	for service := range doc.Services {
		if id, found := ts.AppOf(service); found {
			ids = append(ids, id)
		}
	}
	sort.Strings(ids)
	return ids
}

func (App) Setup(ctx context.Context, h *helpers.H) error {
	if err := h.Step(ctx, "auth-key", "read the Tailscale auth key", helpers.StepSpec{
		Check: func(context.Context) (bool, error) { return h.Inputs["auth_key"] != "", nil },
		Do:    func(context.Context) error { return errors.New("no Tailscale auth key was supplied") },
		Hint: "Make one reusable, pre-approved key at " + ts.KeysURL + " and pass it with " +
			"--set-file tailscale.auth_key=/path/to/credential, then run: self-host install tailscale",
		Credential: "admin",
	}); err != nil {
		return err
	}
	if err := h.Step(ctx, "enroll", "enroll this node in the tailnet", helpers.StepSpec{
		Check: func(ctx context.Context) (bool, error) { return running(ctx, h) },
		Do: func(ctx context.Context) error {
			args := []string{"tailscale", "--socket=" + ts.Socket, "up", "--hostname=self-host", "--auth-key=file:/run/secrets/" + ts.KeyFile}
			if ts.IsOAuth(h.Inputs["auth_key"]) {
				args = append(args, "--advertise-tags="+ts.Tag)
			}
			_, err := h.Exec(ctx, nil, args...)
			return err
		},
		Hint: "Enroll by hand inside the container: tailscale up --auth-key=file:/run/secrets/" + ts.KeyFile,
	}); err != nil {
		return err
	}
	for _, id := range nodes(h) {
		if err := h.Step(ctx, "name-"+id, "give "+id+" its private name", helpers.StepSpec{
			Check: func(ctx context.Context) (bool, error) { return named(ctx, h, id) },
			Do: func(ctx context.Context) error {
				return h.Poll(ctx, 2*time.Minute, func(ctx context.Context) (bool, error) { return named(ctx, h, id) })
			},
			Hint: "Check the node's logs with: self-host logs tailscale. Turn on HTTPS on the DNS page, " + ts.DNSURL +
				", and make sure the key is reusable and pre-approved, then run: self-host setup tailscale",
		}); err != nil {
			return err
		}
	}
	return nil
}

// named reports whether an App's node is running with its HTTPS name.
func named(ctx context.Context, h *helpers.H, id string) (bool, error) {
	node, err := connected(ctx, h, ts.ServiceName(id))
	if err != nil {
		return false, err
	}
	if node.Running() && !node.HTTPS {
		return false, errors.New("HTTPS is not turned on for the tailnet")
	}
	return node.Running() && node.DNSName != "", nil
}

func (App) Check(ctx context.Context, h *helpers.H) error {
	ok, err := running(ctx, h)
	if err != nil {
		return err
	}
	if !ok {
		return errors.New("the Tailscale node is not enrolled and running")
	}
	for _, id := range nodes(h) {
		if ok, err := named(ctx, h, id); err != nil || !ok {
			return fmt.Errorf("%s has no private name yet%s", id, reason(err))
		}
	}
	return nil
}

func reason(err error) string {
	if err == nil {
		return ""
	}
	return ": " + err.Error()
}

func (App) Links() []app.Link { return nil }
