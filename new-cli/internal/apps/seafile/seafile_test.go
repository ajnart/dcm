package seafile_test

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strconv"
	"strings"
	"testing"

	"github.com/ajnart/self-host/internal/app"
	"github.com/ajnart/self-host/internal/apps/seafile"
	"github.com/ajnart/self-host/internal/events"
	"github.com/ajnart/self-host/internal/helpers"
	stepstatus "github.com/ajnart/self-host/internal/status"
	"github.com/ajnart/self-host/internal/systemtest"
	"go.yaml.in/yaml/v3"
)

type fakeSeafile struct {
	reject bool
}

func (f *fakeSeafile) handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /{$}", func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	})
	mux.HandleFunc("POST /api2/auth-token/", func(w http.ResponseWriter, r *http.Request) {
		r.ParseForm()
		if f.reject || r.PostForm.Get("username") != "admin@selfhost.local" || r.PostForm.Get("password") != "adminpass" {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		json.NewEncoder(w).Encode(map[string]string{"token": "abcdef0123456789abcdef0123456789abcdef01"})
	})
	mux.HandleFunc("GET /api/v2.1/admin/users/", func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer abcdef0123456789abcdef0123456789abcdef01" {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		json.NewEncoder(w).Encode(map[string]any{"count": 1, "results": []any{}})
	})
	return mux
}

type fakeSecrets map[string]string

func (s fakeSecrets) Get(key string) string       { return s[key] }
func (s fakeSecrets) Set(key, value string) error { s[key] = value; return nil }

func newH(t *testing.T, srv *httptest.Server) (*helpers.H, *[]helpers.StepResult) {
	t.Helper()
	deps := systemtest.NewDeps(t)
	var recorded []helpers.StepResult
	h := helpers.New(helpers.Config{
		App: "seafile", Service: "seafile",
		BaseURL: srv.URL, URL: srv.URL, HTTP: srv.Client(),
		Secrets: fakeSecrets{"ADMIN_USER": "admin", "ADMIN_PASSWORD": "adminpass"},
		Log:     events.Discard(), Now: deps.Now, Sleep: deps.Sleep,
		Record: func(r helpers.StepResult) { recorded = append(recorded, r) },
	})
	return h, &recorded
}

func TestSetupThenCheckPass(t *testing.T) {
	srv := httptest.NewServer((&fakeSeafile{}).handler())
	defer srv.Close()
	h, recorded := newH(t, srv)
	ctx := context.Background()

	if err := (seafile.App{}).Setup(ctx, h); err != nil {
		t.Fatalf("Setup: %v", err)
	}
	if err := (seafile.App{}).Check(ctx, h); err != nil {
		t.Fatalf("Check: %v", err)
	}
	for _, r := range *recorded {
		if r.Status == stepstatus.StepFail {
			t.Errorf("step %s failed: %s", r.ID, r.Error)
		}
	}
}

func TestRerunSkipsEveryStep(t *testing.T) {
	srv := httptest.NewServer((&fakeSeafile{}).handler())
	defer srv.Close()
	h, recorded := newH(t, srv)
	ctx := context.Background()
	if err := (seafile.App{}).Setup(ctx, h); err != nil {
		t.Fatalf("first Setup: %v", err)
	}

	*recorded = nil
	if err := (seafile.App{}).Setup(ctx, h); err != nil {
		t.Fatalf("second Setup: %v", err)
	}
	for _, r := range *recorded {
		if r.Status != stepstatus.StepSkip {
			t.Errorf("step %s = %s on rerun, want skip", r.ID, r.Status)
		}
	}
}

func TestFailedLoginHintNamesTheApp(t *testing.T) {
	srv := httptest.NewServer((&fakeSeafile{reject: true}).handler())
	defer srv.Close()
	h, recorded := newH(t, srv)

	if err := (seafile.App{}).Setup(context.Background(), h); err == nil {
		t.Fatal("Setup should fail when the administrator login is rejected")
	}
	var fail *helpers.StepResult
	for i := range *recorded {
		if (*recorded)[i].Status == stepstatus.StepFail {
			fail = &(*recorded)[i]
		}
	}
	if fail == nil || !strings.Contains(fail.Hint, "self-host logs seafile") {
		t.Fatalf("failing step hint should name the App command, got %+v", fail)
	}
}

func TestComposeConfiguredServiceURLMatchesSelectedPublishedPort(t *testing.T) {
	for _, port := range []int{8080, 24880, 80} {
		t.Run(strconv.Itoa(port), func(t *testing.T) {
			compose := (seafile.App{}).Compose(app.RenderContext{Port: port})
			var deployment struct {
				Services map[string]struct {
					Environment map[string]string
					Ports       []string
				}
			}
			if err := yaml.Unmarshal([]byte(compose), &deployment); err != nil {
				t.Fatal(err)
			}
			service := deployment.Services["seafile"]
			host := strings.ReplaceAll(service.Environment["SEAFILE_SERVER_HOSTNAME"], "${LAN_IP}", "192.0.2.44")
			origin, err := url.Parse(service.Environment["SEAFILE_SERVER_PROTOCOL"] + "://" + host)
			if err != nil {
				t.Fatal(err)
			}
			if len(service.Ports) != 1 {
				t.Fatal("Seafile must publish one owned HTTP endpoint")
			}
			mapping := strings.Split(service.Ports[0], ":")
			published := mapping[len(mapping)-2]
			configured := origin.Port()
			if configured == "" && origin.Scheme == "http" {
				configured = "80"
			}
			if configured != published {
				t.Fatalf("Seafile builds URLs for port %s while owned Compose publishes port %s", configured, published)
			}
		})
	}
}

// The v13 Docker bootstrap exports each omitted variable as an empty installer
// value. Unlike an absent installer environment key, that does not select the
// installer default and causes initialization to stop before Seahub starts.
func TestComposeSuppliesDatabaseNamesRequiredByDockerBootstrap(t *testing.T) {
	var deployment struct {
		Services map[string]struct{ Environment map[string]string }
	}
	if err := yaml.Unmarshal([]byte((seafile.App{}).Compose(app.RenderContext{Port: 8080})), &deployment); err != nil {
		t.Fatal(err)
	}
	env := deployment.Services["seafile"].Environment
	for key, want := range map[string]string{
		"SEAFILE_MYSQL_DB_CCNET_DB_NAME":   "ccnet_db",
		"SEAFILE_MYSQL_DB_SEAFILE_DB_NAME": "seafile_db",
		"SEAFILE_MYSQL_DB_SEAHUB_DB_NAME":  "seahub_db",
	} {
		if env[key] != want {
			t.Errorf("%s = %q; Docker bootstrap needs official database name %q instead of an empty installer parameter", key, env[key], want)
		}
	}
}
