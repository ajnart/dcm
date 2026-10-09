package uptimekuma_test

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"

	"github.com/ajnart/self-host/internal/apps/porttest"
	"github.com/ajnart/self-host/internal/apps/uptimekuma"
)

type fakeUptime struct {
	mu       sync.Mutex
	user     string
	password string
}

func (f *fakeUptime) handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /", func(w http.ResponseWriter, r *http.Request) { w.Write([]byte("kuma")) })
	mux.HandleFunc("GET /metrics", func(w http.ResponseWriter, r *http.Request) {
		f.mu.Lock()
		defer f.mu.Unlock()
		user, password, ok := r.BasicAuth()
		if !ok || user != f.user || password != f.password || f.password == "" {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		w.Write([]byte("# HELP uptime_monitor_status Monitor status\n"))
	})
	return mux
}

func TestTheAdminLoginAuthenticatesTheMetricsEndpoint(t *testing.T) {
	server := httptest.NewServer((&fakeUptime{user: "admin", password: "secret"}).handler())
	defer server.Close()
	rec := &porttest.Recorder{}
	h := porttest.New(t, porttest.Options{App: "uptime-kuma", Service: "uptime-kuma",
		Secrets: porttest.Secrets{"ADMIN_USER": "admin", "ADMIN_PASSWORD": "secret"}}, server, rec)

	if err := (uptimekuma.App{}).Setup(context.Background(), h); err != nil {
		t.Fatalf("Setup: %v", err)
	}
	if err := (uptimekuma.App{}).Check(context.Background(), h); err != nil {
		t.Fatalf("Check: %v", err)
	}
	if rec.Status("admin") != "skip" {
		t.Fatalf("admin step = %q, want skip", rec.Status("admin"))
	}
}

func TestRerunSkipsEveryStep(t *testing.T) {
	server := httptest.NewServer((&fakeUptime{user: "admin", password: "secret"}).handler())
	defer server.Close()
	rec := &porttest.Recorder{}
	h := porttest.New(t, porttest.Options{App: "uptime-kuma", Service: "uptime-kuma",
		Secrets: porttest.Secrets{"ADMIN_USER": "admin", "ADMIN_PASSWORD": "secret"}}, server, rec)

	if err := (uptimekuma.App{}).Setup(context.Background(), h); err != nil {
		t.Fatalf("Setup: %v", err)
	}
	if rec.Status("ready") != "skip" || rec.Status("admin") != "skip" {
		t.Fatalf("rerun should skip: ready=%q admin=%q", rec.Status("ready"), rec.Status("admin"))
	}
}

func TestTheHintNamesTheAppPage(t *testing.T) {
	server := httptest.NewServer((&fakeUptime{user: "admin", password: "changed"}).handler())
	defer server.Close()
	rec := &porttest.Recorder{}
	h := porttest.New(t, porttest.Options{App: "uptime-kuma", Service: "uptime-kuma",
		Secrets: porttest.Secrets{"ADMIN_USER": "admin", "ADMIN_PASSWORD": "secret"}}, server, rec)

	if err := (uptimekuma.App{}).Setup(context.Background(), h); err == nil {
		t.Fatal("Setup should fail when the administrator is not the saved login")
	}
	if rec.Status("admin") != "manual" || !strings.Contains(rec.Hint(), server.URL) {
		t.Fatalf("admin step should be manual with the App URL hint, got %q", rec.Hint())
	}
}
