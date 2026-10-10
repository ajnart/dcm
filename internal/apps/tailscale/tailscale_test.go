package tailscale_test

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"sync"
	"testing"

	"github.com/ajnart/self-host/internal/app"
	"github.com/ajnart/self-host/internal/apps/tailscale"
	"github.com/ajnart/self-host/internal/events"
	"github.com/ajnart/self-host/internal/helpers"
	stepstatus "github.com/ajnart/self-host/internal/status"
	"github.com/ajnart/self-host/internal/system"
	"github.com/ajnart/self-host/internal/systemtest"
)

type fakeSecrets map[string]string

func (s fakeSecrets) Get(key string) string       { return s[key] }
func (s fakeSecrets) Set(key, value string) error { s[key] = value; return nil }

const (
	adminUser = "admin"
	adminPass = "correct-horse-battery"
)

// execFake models the containers: the connector's tailscale up and status, and
// the status each App's node answers with.
type execFake struct {
	mu       sync.Mutex
	enrolled bool
	// nodes holds the status JSON a node's Compose service prints.
	nodes map[string]string
	calls []string
}

func (e *execFake) Exec(_ context.Context, service string, _ map[string]string, command ...string) (system.Result, error) {
	e.mu.Lock()
	defer e.mu.Unlock()
	e.calls = append(e.calls, service+": "+strings.Join(command, " "))
	if len(command) < 2 || command[0] != "tailscale" {
		return system.Result{}, nil
	}
	switch {
	case slices.Contains(command, "up"):
		e.enrolled = true
	case slices.Contains(command, "status"):
		if body, found := e.nodes[service]; found {
			return system.Result{Stdout: []byte(body)}, nil
		}
		state := "Stopped"
		if e.enrolled {
			state = "Running"
		}
		body, _ := json.Marshal(map[string]any{"BackendState": state})
		return system.Result{Stdout: body}, nil
	}
	return system.Result{}, nil
}

func (e *execFake) LogText(context.Context, int, ...string) (string, error) { return "", nil }
func (e *execFake) Restart(context.Context, ...string) error                { return nil }
func (e *execFake) Up(context.Context, ...string) error                     { return nil }

// nodeStatus is `tailscale status --json` of a running node with HTTPS on.
func nodeStatus(dnsName string) string {
	body, _ := json.Marshal(map[string]any{
		"BackendState": "Running",
		"CertDomains":  []string{strings.TrimSuffix(dnsName, ".")},
		"Self":         map[string]any{"DNSName": dnsName},
	})
	return string(body)
}

func newH(t *testing.T, records *[]helpers.StepResult, inputs map[string]string, exec *execFake, web ...app.WebTarget) *helpers.H {
	t.Helper()
	deps := systemtest.NewDeps(t)
	dir := t.TempDir()
	if len(web) > 0 {
		fragment := (tailscale.App{}).Compose(app.RenderContext{Web: web})
		if err := os.WriteFile(filepath.Join(dir, "compose.yml"), []byte(fragment), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	if exec == nil {
		exec = &execFake{}
	}
	return helpers.New(helpers.Config{
		App: "tailscale", Service: "tailscale", Dir: dir,
		Inputs:  inputs,
		Exec:    exec,
		Secrets: fakeSecrets{"ADMIN_USER": adminUser, "ADMIN_PASSWORD": adminPass},
		Log:     events.Discard(), Now: deps.Now, Sleep: deps.Sleep,
		Record: func(r helpers.StepResult) { *records = append(*records, r) },
	})
}

func TestSetupThenCheckThenRerunSkips(t *testing.T) {
	var records []helpers.StepResult
	h := newH(t, &records, map[string]string{"auth_key": "tskey-auth-example"}, nil)
	ctx := context.Background()

	if err := (tailscale.App{}).Setup(ctx, h); err != nil {
		t.Fatalf("Setup: %v", err)
	}
	if err := (tailscale.App{}).Check(ctx, h); err != nil {
		t.Fatalf("Check: %v", err)
	}

	records = nil
	if err := (tailscale.App{}).Setup(ctx, h); err != nil {
		t.Fatalf("rerun Setup: %v", err)
	}
	for _, r := range records {
		if r.Status != stepstatus.StepSkip {
			t.Errorf("rerun step %s = %s, want skip", r.ID, r.Status)
		}
	}
}

func TestMissingAuthKeyHintNamesTheKeyPage(t *testing.T) {
	var records []helpers.StepResult
	h := newH(t, &records, map[string]string{}, nil)

	if err := (tailscale.App{}).Setup(context.Background(), h); err == nil {
		t.Fatal("Setup should fail when no auth key was supplied")
	}
	var hint string
	for _, r := range records {
		if r.Status == stepstatus.StepFail {
			hint = r.Hint
		}
	}
	if !strings.Contains(hint, "login.tailscale.com") {
		t.Errorf("hint should name where to get the auth key, got %q", hint)
	}
}

var jellyfin = app.WebTarget{ID: "jellyfin", Service: "jellyfin", ContainerPort: 8096}

func TestComposeGivesAWebAppItsOwnTailscaleNode(t *testing.T) {
	fragment := (tailscale.App{}).Compose(app.RenderContext{Web: []app.WebTarget{jellyfin}})
	want := `  tailscale-jellyfin:
    image: ghcr.io/tailscale/tailscale:v1.102.4
    hostname: jellyfin
    restart: unless-stopped
    environment:
      TS_HOSTNAME: jellyfin
      TS_AUTHKEY: file:/run/secrets/auth-key
      TS_STATE_DIR: /var/lib/tailscale
      TS_USERSPACE: "true"
      TS_SERVE_CONFIG: /config/serve.json
    volumes:
      - ./nodes/jellyfin/state:/var/lib/tailscale
      - ./nodes/jellyfin/config:/config:ro
      - ./keys:/run/secrets:ro
`
	if !strings.Contains(fragment, want) {
		t.Fatalf("fragment lacks the Jellyfin node:\n%s", fragment)
	}
	if strings.Count(fragment, "image: ghcr.io/tailscale/tailscale") != 2 {
		t.Errorf("want the connector and one node, got:\n%s", fragment)
	}
}

func TestComposeWithoutWebAppsHasOnlyTheConnector(t *testing.T) {
	fragment := (tailscale.App{}).Compose(app.RenderContext{})
	if strings.Contains(fragment, "tailscale-") {
		t.Errorf("no node expected, got:\n%s", fragment)
	}
}

func TestComposeNeverPutsTheKeyInTheFragment(t *testing.T) {
	rc := app.RenderContext{Web: []app.WebTarget{jellyfin}, Inputs: map[string]string{"auth_key": "tskey-auth-secret-value"}}
	if fragment := (tailscale.App{}).Compose(rc); strings.Contains(fragment, "secret-value") {
		t.Errorf("fragment carries the key:\n%s", fragment)
	}
}

func TestOAuthSecretAsksNodesToAdvertiseTheTag(t *testing.T) {
	for key, want := range map[string]bool{"tskey-auth-abc": false, "tskey-client-abc": true} {
		fragment := (tailscale.App{}).Compose(app.RenderContext{Web: []app.WebTarget{jellyfin}, Inputs: map[string]string{"auth_key": key}})
		if got := strings.Contains(fragment, "TS_EXTRA_ARGS: --advertise-tags=tag:self-host"); got != want {
			t.Errorf("key %s: tag advertised = %v, want %v", key, got, want)
		}
	}
}

func filesByPath(files []app.File) map[string]app.File {
	out := map[string]app.File{}
	for _, f := range files {
		out[f.Path] = f
	}
	return out
}

func TestFilesServeEachAppOverHTTPSInsideTheTailnetOnly(t *testing.T) {
	files := filesByPath((tailscale.App{}).Files(app.RenderContext{Web: []app.WebTarget{jellyfin}}, nil))
	serve, found := files["nodes/jellyfin/config/serve.json"]
	if !found {
		t.Fatalf("no serve.json, got %v", files)
	}
	var doc struct {
		TCP map[string]struct{ HTTPS bool }
		Web map[string]struct {
			Handlers map[string]struct{ Proxy string }
		}
	}
	if err := json.Unmarshal([]byte(serve.Content), &doc); err != nil {
		t.Fatalf("serve.json: %v\n%s", err, serve.Content)
	}
	if !doc.TCP["443"].HTTPS {
		t.Error("HTTPS is not served on 443")
	}
	if got := doc.Web["${TS_CERT_DOMAIN}:443"].Handlers["/"].Proxy; got != "http://jellyfin:8096" {
		t.Errorf("proxy = %q, want http://jellyfin:8096", got)
	}
	if strings.Contains(serve.Content, "AllowFunnel") {
		t.Error("serve.json must never allow Funnel")
	}
}

func TestFilesWriteTheKeyPrivatelyAndMakeOAuthSecretsPermanent(t *testing.T) {
	for key, want := range map[string]string{
		"tskey-auth-abc":   "tskey-auth-abc",
		"tskey-client-abc": "tskey-client-abc?ephemeral=false&preauthorized=true",
	} {
		files := filesByPath((tailscale.App{}).Files(app.RenderContext{Inputs: map[string]string{"auth_key": key}}, nil))
		file := files["keys/auth-key"]
		if file.Content != want || file.Mode != 0o600 {
			t.Errorf("key %s: file %q mode %o, want %q mode 600", key, file.Content, file.Mode, want)
		}
	}
}

func stepStatus(records []helpers.StepResult, id string) stepstatus.Step {
	for _, r := range records {
		if r.ID == id {
			return r.Status
		}
	}
	return ""
}

func TestSetupWaitsForEachAppsNodeToGetItsName(t *testing.T) {
	var records []helpers.StepResult
	exec := &execFake{nodes: map[string]string{"tailscale-jellyfin": nodeStatus("jellyfin.tail1234.ts.net.")}}
	h := newH(t, &records, map[string]string{"auth_key": "tskey-auth-example"}, exec, jellyfin)

	if err := (tailscale.App{}).Setup(context.Background(), h); err != nil {
		t.Fatalf("Setup: %v", err)
	}
	if got := stepStatus(records, "name-jellyfin"); got != stepstatus.StepSkip {
		t.Errorf("step name-jellyfin = %q, want skip (the node already answers with its name)", got)
	}
	if err := (tailscale.App{}).Check(context.Background(), h); err != nil {
		t.Errorf("Check: %v", err)
	}
}

func TestSetupSaysHTTPSIsOffWhenTheNodeHasNoCertificateName(t *testing.T) {
	var records []helpers.StepResult
	exec := &execFake{nodes: map[string]string{"tailscale-jellyfin": `{"BackendState":"Running","CertDomains":[],"Self":{"DNSName":"jellyfin.tail1234.ts.net."}}`}}
	h := newH(t, &records, map[string]string{"auth_key": "tskey-auth-example"}, exec, jellyfin)

	if err := (tailscale.App{}).Setup(context.Background(), h); err == nil {
		t.Fatal("Setup should fail while HTTPS is off")
	}
	var failed helpers.StepResult
	for _, r := range records {
		if r.Status == stepstatus.StepFail {
			failed = r
		}
	}
	if failed.ID != "name-jellyfin" || !strings.Contains(failed.Hint, "https://login.tailscale.com/admin/dns") || !strings.Contains(failed.Error, "HTTPS is not turned on") {
		t.Errorf("failed step %+v should name the DNS page and say HTTPS is off", failed)
	}
}

func TestSetupNeverPutsTheKeyInACommand(t *testing.T) {
	var records []helpers.StepResult
	exec := &execFake{nodes: map[string]string{"tailscale-jellyfin": nodeStatus("jellyfin.tail1234.ts.net.")}}
	h := newH(t, &records, map[string]string{"auth_key": "tskey-client-very-secret"}, exec, jellyfin)

	if err := (tailscale.App{}).Setup(context.Background(), h); err != nil {
		t.Fatalf("Setup: %v", err)
	}
	for _, call := range exec.calls {
		if strings.Contains(call, "very-secret") {
			t.Errorf("a command carries the key: %s", call)
		}
	}
	if !slices.ContainsFunc(exec.calls, func(c string) bool {
		return strings.Contains(c, "--auth-key=file:/run/secrets/auth-key") && strings.Contains(c, "--advertise-tags=tag:self-host")
	}) {
		t.Errorf("the OAuth secret should enroll from the key file with the tag, got %v", exec.calls)
	}
}
