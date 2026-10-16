package cleanuparr_test

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/ajnart/self-host/internal/apps/cleanuparr"
	"github.com/ajnart/self-host/internal/events"
	"github.com/ajnart/self-host/internal/helpers"
	stepstatus "github.com/ajnart/self-host/internal/status"
)

type secrets map[string]string

func (s secrets) Get(key string) string       { return s[key] }
func (s secrets) Set(key, value string) error { s[key] = value; return nil }

type fake struct {
	user, password string
	complete       bool
	sonarr         []map[string]any
	clients        []map[string]any
	posted         map[string]any
}

func (f *fake) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	var creds struct{ Username, Password string }
	route := r.Method + " " + r.URL.Path
	if strings.HasPrefix(r.URL.Path, "/api/configuration/") && r.Header.Get("Authorization") != "Bearer fixture-token" {
		w.WriteHeader(http.StatusUnauthorized)
		return
	}
	switch {
	case route == "GET /health":
		w.WriteHeader(http.StatusOK)
	case route == "GET /api/auth/status":
		_ = json.NewEncoder(w).Encode(map[string]bool{"setupCompleted": f.complete})
	case route == "POST /api/auth/setup/account":
		_ = json.NewDecoder(r.Body).Decode(&creds)
		f.user, f.password = creds.Username, creds.Password
		w.WriteHeader(http.StatusCreated)
	case route == "POST /api/auth/setup/complete":
		f.complete = true
	case route == "POST /api/auth/login":
		_ = json.NewDecoder(r.Body).Decode(&creds)
		if !f.complete || creds.Username != f.user || creds.Password != f.password {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		_ = json.NewEncoder(w).Encode(map[string]any{"requiresTwoFactor": false, "tokens": map[string]string{"accessToken": "fixture-token"}})
	case route == "GET /api/configuration/sonarr":
		_ = json.NewEncoder(w).Encode(map[string]any{"instances": f.sonarr})
	case route == "POST /api/configuration/sonarr/instances":
		_ = json.NewDecoder(r.Body).Decode(&f.posted)
		f.sonarr = append(f.sonarr, map[string]any{"id": "s1", "url": f.posted["url"].(string) + "/"})
		w.WriteHeader(http.StatusCreated)
	case route == "DELETE /api/configuration/sonarr/instances/s1":
		f.sonarr = nil
	case route == "GET /api/configuration/download_client":
		_ = json.NewEncoder(w).Encode(map[string]any{"clients": f.clients})
	case route == "POST /api/configuration/download_client":
		_ = json.NewDecoder(r.Body).Decode(&f.posted)
		f.clients = append(f.clients, map[string]any{"id": "c1", "host": f.posted["host"].(string) + "/"})
		w.WriteHeader(http.StatusCreated)
	default:
		w.WriteHeader(http.StatusNotFound)
	}
}

func newH(srv *httptest.Server, s secrets, records *[]helpers.StepResult) *helpers.H {
	return helpers.New(helpers.Config{App: "cleanuparr", BaseURL: srv.URL, URL: srv.URL, HTTP: srv.Client(), Log: events.Discard(),
		Secrets: s, Record: func(r helpers.StepResult) { *records = append(*records, r) }})
}

func TestSetupCreatesTheAdminOnce(t *testing.T) {
	f := &fake{}
	srv := httptest.NewServer(f)
	t.Cleanup(srv.Close)
	var records []helpers.StepResult
	h := newH(srv, secrets{"ADMIN_USER": "admin", "ADMIN_PASSWORD": "fixture-only-password"}, &records)

	if err := (cleanuparr.App{}).Setup(context.Background(), h); err != nil {
		t.Fatalf("Setup = %v", err)
	}
	if f.user != "admin" || !f.complete {
		t.Fatalf("admin not created: %+v", f)
	}
	records = nil
	if err := (cleanuparr.App{}).Setup(context.Background(), h); err != nil {
		t.Fatalf("second Setup = %v", err)
	}
	for _, r := range records {
		if r.Status != stepstatus.StepSkip {
			t.Fatalf("second Setup records = %+v, want all skipped", records)
		}
	}
	if err := (cleanuparr.App{}).Check(context.Background(), h); err != nil {
		t.Fatalf("Check = %v", err)
	}
}

func TestLinksConnectSonarrAndQBittorrentByServiceName(t *testing.T) {
	f := &fake{user: "admin", password: "fixture-only-password", complete: true}
	srv := httptest.NewServer(f)
	t.Cleanup(srv.Close)
	var records []helpers.StepResult
	s := secrets{"ADMIN_USER": "admin", "ADMIN_PASSWORD": "fixture-only-password", "SONARR_API_KEY": "fixture-sonarr-key"}
	from := newH(srv, s, &records)
	links := (cleanuparr.App{}).Links()
	targets := map[string]*helpers.H{
		"sonarr":      helpers.New(helpers.Config{App: "sonarr", Service: "sonarr", ContainerPort: 8989, Secrets: s, Log: events.Discard()}),
		"qbittorrent": helpers.New(helpers.Config{App: "qbittorrent", Service: "qbittorrent", ContainerPort: 8080, Secrets: s, Log: events.Discard()}),
	}
	for _, l := range links {
		to := targets[l.Target]
		if to == nil {
			continue
		}
		for range 2 {
			if err := l.Apply(context.Background(), from, to); err != nil {
				t.Fatalf("%s Apply = %v", l.ID, err)
			}
		}
	}
	if len(f.sonarr) != 1 || len(f.clients) != 1 {
		t.Fatalf("want one Sonarr and one client after two runs, got %+v %+v", f.sonarr, f.clients)
	}
	if f.posted["host"] != "http://qbittorrent:8080" || f.posted["typeName"] != "qBittorrent" {
		t.Fatalf("download client = %+v", f.posted)
	}
	for _, l := range links {
		if l.Target == "sonarr" {
			if err := l.Remove(context.Background(), from, targets["sonarr"]); err != nil {
				t.Fatalf("Remove = %v", err)
			}
		}
	}
	if len(f.sonarr) != 0 {
		t.Fatalf("Sonarr still connected: %+v", f.sonarr)
	}
}
