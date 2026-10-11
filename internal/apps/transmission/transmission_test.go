package transmission_test

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"

	"github.com/ajnart/self-host/internal/apps/porttest"
	"github.com/ajnart/self-host/internal/apps/transmission"
	stepstatus "github.com/ajnart/self-host/internal/status"
)

type fakeTransmission struct {
	mu       sync.Mutex
	user     string
	password string
}

func (f *fakeTransmission) auth(w http.ResponseWriter, r *http.Request) bool {
	user, password, ok := r.BasicAuth()
	if !ok || user != f.user || password != f.password {
		w.WriteHeader(http.StatusUnauthorized)
		return false
	}
	return true
}

func (f *fakeTransmission) handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /transmission/web/", func(w http.ResponseWriter, r *http.Request) {
		f.mu.Lock()
		defer f.mu.Unlock()
		if !f.auth(w, r) {
			return
		}
		w.Write([]byte("web"))
	})
	mux.HandleFunc("POST /transmission/rpc", func(w http.ResponseWriter, r *http.Request) {
		f.mu.Lock()
		defer f.mu.Unlock()
		if !f.auth(w, r) {
			return
		}
		if r.Header.Get("X-Transmission-Session-Id") == "" {
			w.Header().Set("X-Transmission-Session-Id", "csrf")
			w.WriteHeader(http.StatusConflict)
			return
		}
		var request struct {
			Method string `json:"method"`
		}
		if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
			w.WriteHeader(http.StatusBadRequest)
			return
		}
		switch request.Method {
		case "session-get":
			w.Write([]byte(`{"result":"success","arguments":{"version":"4.1.3","rpc-version-semver":"6.0.1"}}`))
		case "session-stats":
			w.Write([]byte(`{"result":"success","arguments":{"downloadSpeed":0,"uploadSpeed":0,"torrentCount":0,"activeTorrentCount":0,"pausedTorrentCount":0}}`))
		case "torrent-get":
			w.Write([]byte(`{"result":"success","arguments":{"torrents":[]}}`))
		default:
			w.WriteHeader(http.StatusBadRequest)
		}
	})
	return mux
}

func TestPreseededLoginIsProvenThroughRPC(t *testing.T) {
	server := httptest.NewServer((&fakeTransmission{user: "admin", password: "secret"}).handler())
	defer server.Close()
	rec := &porttest.Recorder{}
	h := porttest.New(t, porttest.Options{App: "transmission", Service: "transmission",
		Secrets: porttest.Secrets{"ADMIN_USER": "admin", "ADMIN_PASSWORD": "secret"}}, server, rec)

	if err := (transmission.App{}).Setup(context.Background(), h); err != nil {
		t.Fatalf("Setup: %v", err)
	}
	if err := (transmission.App{}).Check(context.Background(), h); err != nil {
		t.Fatalf("Check: %v", err)
	}
	if rec.Status("admin") != stepstatus.StepSkip {
		t.Fatalf("admin step = %q, want skip", rec.Status("admin"))
	}
}

func TestRerunSkipsEveryStep(t *testing.T) {
	server := httptest.NewServer((&fakeTransmission{user: "admin", password: "secret"}).handler())
	defer server.Close()
	rec := &porttest.Recorder{}
	h := porttest.New(t, porttest.Options{App: "transmission", Service: "transmission",
		Secrets: porttest.Secrets{"ADMIN_USER": "admin", "ADMIN_PASSWORD": "secret"}}, server, rec)

	if err := (transmission.App{}).Setup(context.Background(), h); err != nil {
		t.Fatalf("Setup: %v", err)
	}
	if rec.Status("ready") != stepstatus.StepSkip || rec.Status("admin") != stepstatus.StepSkip {
		t.Fatalf("rerun should skip: ready=%q admin=%q", rec.Status("ready"), rec.Status("admin"))
	}
}

func TestTheHintNamesTheAppWhenTheSeedDidNotApply(t *testing.T) {
	server := httptest.NewServer((&fakeTransmission{user: "admin", password: "changed"}).handler())
	defer server.Close()
	rec := &porttest.Recorder{}
	h := porttest.New(t, porttest.Options{App: "transmission", Service: "transmission",
		Secrets: porttest.Secrets{"ADMIN_USER": "admin", "ADMIN_PASSWORD": "secret"}}, server, rec)

	if err := (transmission.App{}).Setup(context.Background(), h); err == nil {
		t.Fatal("Setup should fail when the seeded login is refused")
	}
	if rec.Status("admin") != stepstatus.StepManual || !strings.Contains(rec.Hint(), server.URL) {
		t.Fatalf("admin step should be manual with the App URL hint, got %q", rec.Hint())
	}
}
