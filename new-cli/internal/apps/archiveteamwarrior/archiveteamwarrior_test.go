package archiveteamwarrior_test

import (
	"context"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"

	"github.com/ajnart/self-host/internal/app"
	"github.com/ajnart/self-host/internal/apps/archiveteamwarrior"
	"github.com/ajnart/self-host/internal/events"
	"github.com/ajnart/self-host/internal/helpers"
	"github.com/ajnart/self-host/internal/systemtest"
	"go.yaml.in/yaml/v3"
)

func TestComposePreparesWritableImageDataBeforeWarriorStarts(t *testing.T) {
	var deployment struct {
		Services map[string]struct {
			Image       string
			User        string
			Entrypoint  []string
			Command     []string
			Volumes     []string
			Environment map[string]string
			Ports       []string
			NetworkMode string                                `yaml:"network_mode"`
			ReadOnly    bool                                  `yaml:"read_only"`
			DependsOn   map[string]struct{ Condition string } `yaml:"depends_on"`
		}
	}
	if err := yaml.Unmarshal([]byte((archiveteamwarrior.App{}).Compose(app.RenderContext{Port: 8001})), &deployment); err != nil {
		t.Fatal(err)
	}
	main := deployment.Services["archive-team-warrior"]
	init, ok := deployment.Services["archive-team-warrior-init"]
	if !ok || main.DependsOn["archive-team-warrior-init"].Condition != "service_completed_successfully" {
		t.Fatal("UID 1000 Warrior can start before its fresh root-owned binds are prepared")
	}
	if main.User != "1000:1000" || init.User != "0:0" || init.Image != main.Image {
		t.Fatal("startup must prepare ownership with the pinned image and retain Warrior UID 1000")
	}
	if !init.ReadOnly || init.NetworkMode != "none" || len(init.Environment) != 0 || len(init.Ports) != 0 {
		t.Fatal("ownership preparation must have a read-only root and no network, ports or secrets")
	}
	if strings.Join(init.Volumes, "\n") != "./projects:/owned/projects\n./data:/owned/data" {
		t.Fatal("ownership preparation must mount only Warrior's two owned directories")
	}
	if strings.Join(init.Entrypoint, " ") != "/bin/sh -ec" || len(init.Command) != 1 {
		t.Fatal("expected one bounded initialization command")
	}
	if !strings.Contains(init.Command[0], "chown -Rh 1000:1000 /owned/projects /owned/data") {
		t.Fatal("ownership repair must not follow symlinks")
	}
	// Execute the rendered startup operation against synthetic owned paths.
	// UID 1000 is the pinned runtime contract; chown needs that UID or root.
	if os.Geteuid() != 0 && os.Geteuid() != 1000 {
		t.Skip("executable ownership fixture requires UID 1000 or root")
	}
	root := t.TempDir()
	imageData := filepath.Join(root, "image-data")
	owned := filepath.Join(root, "owned")
	for _, dir := range []string{imageData, filepath.Join(owned, "projects"), filepath.Join(owned, "data")} {
		if err := os.MkdirAll(dir, 0o755); err != nil {
			t.Fatal(err)
		}
	}
	for name, content := range map[string]string{
		filepath.Join(imageData, "wget-at-openssl"):     "image helper",
		filepath.Join(imageData, "wget-at-gnutls"):      "replacement must not overwrite",
		filepath.Join(owned, "data", "wget-at-gnutls"):  "retained helper",
		filepath.Join(owned, "data", "retained-data"):   "retained data",
		filepath.Join(owned, "projects", "config.json"): `{"http_password":"fixture-only","selected_project":"none"}`,
	} {
		if err := os.WriteFile(name, []byte(content), 0o600); err != nil {
			t.Fatal(err)
		}
	}
	if err := os.Symlink("/usr/local/bin/wget-lua", filepath.Join(imageData, "wget-at")); err != nil {
		t.Fatal(err)
	}
	script := strings.ReplaceAll(init.Command[0], "/home/warrior/data", imageData)
	script = strings.ReplaceAll(script, "/owned", owned)
	for range 2 {
		if output, err := exec.Command(init.Entrypoint[0], init.Entrypoint[1], script).CombinedOutput(); err != nil {
			t.Fatalf("init fixture: %v (%s)", err, output)
		}
	}
	for name, want := range map[string]string{
		filepath.Join(owned, "data", "wget-at-openssl"): "image helper",
		filepath.Join(owned, "data", "wget-at-gnutls"):  "retained helper",
		filepath.Join(owned, "data", "retained-data"):   "retained data",
		filepath.Join(owned, "projects", "config.json"): `{"http_password":"fixture-only","selected_project":"none"}`,
	} {
		got, err := os.ReadFile(name)
		if err != nil || string(got) != want {
			t.Fatalf("init changed or failed to seed fixture %s", filepath.Base(name))
		}
	}
	if target, err := os.Readlink(filepath.Join(owned, "data", "wget-at")); err != nil || target != "/usr/local/bin/wget-lua" {
		t.Fatal("image helper symlink was not preserved")
	}
}

type fakeSecrets map[string]string

func (s fakeSecrets) Get(key string) string       { return s[key] }
func (s fakeSecrets) Set(key, value string) error { s[key] = value; return nil }

const (
	adminUser = "admin"
	adminPass = "correct-horse-battery"
)

func TestComposeSeedsAnIdleSingleItemWarriorWithSavedAdminReferences(t *testing.T) {
	var deployment struct {
		Services map[string]struct {
			Environment map[string]string
		}
	}
	if err := yaml.Unmarshal([]byte((archiveteamwarrior.App{}).Compose(app.RenderContext{
		Port: 8001, Inputs: map[string]string{"nickname": "fixture-warrior"},
	})), &deployment); err != nil {
		t.Fatal(err)
	}
	env := deployment.Services["archive-team-warrior"].Environment
	for key, want := range map[string]string{
		"SELECTED_PROJECT": "none", "CONCURRENT_ITEMS": "1", "DOWNLOADER": "fixture-warrior",
		"HTTP_USERNAME": "${ADMIN_USER}", "HTTP_PASSWORD": "${ADMIN_PASSWORD}",
	} {
		if env[key] != want {
			t.Errorf("startup seed %s = %q, want %q", key, env[key], want)
		}
	}
}

func newH(t *testing.T, srv *httptest.Server, records *[]helpers.StepResult) *helpers.H {
	t.Helper()
	deps := systemtest.NewDeps(t)
	return helpers.New(helpers.Config{
		App: "archive-team-warrior", Service: "archive-team-warrior",
		BaseURL: srv.URL, URL: srv.URL, HTTP: srv.Client(),
		Secrets: fakeSecrets{"ADMIN_USER": adminUser, "ADMIN_PASSWORD": adminPass},
		Log:     events.Discard(), Now: deps.Now, Sleep: deps.Sleep,
		Record: func(r helpers.StepResult) { *records = append(*records, r) },
	})
}

func handler(accept bool) http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("/index.html", func(w http.ResponseWriter, r *http.Request) {
		user, pass, ok := r.BasicAuth()
		if !accept || !ok || user != adminUser || pass != adminPass {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		w.Write([]byte("<html>Warrior</html>"))
	})
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusUnauthorized)
	})
	return mux
}

func TestSetupThenCheckThenRerunSkips(t *testing.T) {
	srv := httptest.NewServer(handler(true))
	t.Cleanup(srv.Close)
	var records []helpers.StepResult
	h := newH(t, srv, &records)
	ctx := context.Background()

	if err := (archiveteamwarrior.App{}).Setup(ctx, h); err != nil {
		t.Fatalf("Setup: %v", err)
	}
	if err := (archiveteamwarrior.App{}).Check(ctx, h); err != nil {
		t.Fatalf("Check: %v", err)
	}

	records = nil
	if err := (archiveteamwarrior.App{}).Setup(ctx, h); err != nil {
		t.Fatalf("rerun Setup: %v", err)
	}
	for _, r := range records {
		if r.Status != "skip" {
			t.Errorf("rerun step %s = %s, want skip", r.ID, r.Status)
		}
	}
}

func TestFailingStepHintNamesTheApp(t *testing.T) {
	srv := httptest.NewServer(handler(false))
	t.Cleanup(srv.Close)
	var records []helpers.StepResult
	h := newH(t, srv, &records)

	if err := (archiveteamwarrior.App{}).Setup(context.Background(), h); err == nil {
		t.Fatal("Setup should fail when the Admin login is rejected")
	}
	var hint string
	for _, r := range records {
		if r.Status == "fail" {
			hint = r.Hint
		}
	}
	if !strings.Contains(hint, "archive-team-warrior") {
		t.Errorf("hint should name the App, got %q", hint)
	}
}
