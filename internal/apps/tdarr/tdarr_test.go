package tdarr_test

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"

	"github.com/ajnart/self-host/internal/apps/porttest"
	"github.com/ajnart/self-host/internal/apps/tdarr"
	stepstatus "github.com/ajnart/self-host/internal/status"
)

type fakeTdarr struct {
	mu       sync.Mutex
	password string
	token    string
}

func (f *fakeTdarr) handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /", func(w http.ResponseWriter, r *http.Request) { w.Write([]byte("tdarr")) })
	mux.HandleFunc("GET /api/v2/status", func(w http.ResponseWriter, r *http.Request) {
		json.NewEncoder(w).Encode(map[string]string{"status": "good", "version": "2.92.01"})
	})
	protected := func(handler http.HandlerFunc) http.HandlerFunc {
		return func(w http.ResponseWriter, r *http.Request) {
			if r.Header.Get("X-Api-Key") != "tapi_fixture_tdarr_key_seed" {
				w.WriteHeader(http.StatusUnauthorized)
				return
			}
			handler(w, r)
		}
	}
	mux.HandleFunc("POST /api/v2/is-server-alive", protected(func(w http.ResponseWriter, r *http.Request) {
		json.NewEncoder(w).Encode(map[string]bool{"isAlive": true})
	}))
	mux.HandleFunc("POST /api/v2/stats/get-pies", protected(func(w http.ResponseWriter, r *http.Request) {
		json.NewEncoder(w).Encode(map[string]any{"pieStats": map[string]any{
			"totalFiles": 0, "totalTranscodeCount": 0, "totalHealthCheckCount": 0, "sizeDiff": 0,
			"status": map[string]any{}, "video": map[string]any{}, "audio": map[string]any{},
		}})
	}))
	mux.HandleFunc("POST /api/v2/client/status-tables", protected(func(w http.ResponseWriter, r *http.Request) {
		json.NewEncoder(w).Encode(map[string]any{"array": []any{}, "totalCount": 0})
	}))
	mux.HandleFunc("GET /api/v2/get-nodes", protected(func(w http.ResponseWriter, r *http.Request) {
		json.NewEncoder(w).Encode(map[string]any{"fixture-node": map[string]any{
			"_id": "fixture-node", "nodeName": "Fixture", "nodePaused": false, "workers": map[string]any{},
		}})
	}))
	mux.HandleFunc("GET /api/v2/auth/verify-token", func(w http.ResponseWriter, r *http.Request) {
		f.mu.Lock()
		defer f.mu.Unlock()
		if f.token != "" && r.Header.Get("Authorization") == "Bearer "+f.token {
			json.NewEncoder(w).Encode(map[string]any{"roles": []string{"admin"}, "localAuth": true})
			return
		}
		w.WriteHeader(http.StatusUnauthorized)
		json.NewEncoder(w).Encode(map[string]any{"setupAdmin": f.password == ""})
	})
	mux.HandleFunc("POST /api/v2/public/auth/register", func(w http.ResponseWriter, r *http.Request) {
		f.mu.Lock()
		defer f.mu.Unlock()
		if f.password != "" {
			w.WriteHeader(http.StatusBadRequest)
			return
		}
		var body struct{ Username, Password string }
		json.NewDecoder(r.Body).Decode(&body)
		f.password, f.token = body.Password, "t1"
		w.WriteHeader(http.StatusCreated)
	})
	mux.HandleFunc("POST /api/v2/public/auth/login", func(w http.ResponseWriter, r *http.Request) {
		f.mu.Lock()
		defer f.mu.Unlock()
		var body struct{ Username, Password string }
		json.NewDecoder(r.Body).Decode(&body)
		if f.password == "" || body.Password != f.password {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		json.NewEncoder(w).Encode(map[string]any{"token": f.token})
	})
	return mux
}

func TestRegistersTheFirstOwnerThenProvesIt(t *testing.T) {
	server := httptest.NewServer((&fakeTdarr{}).handler())
	defer server.Close()
	rec := &porttest.Recorder{}
	h := porttest.New(t, porttest.Options{App: "tdarr", Service: "tdarr", Homarr: true,
		Secrets: porttest.Secrets{"ADMIN_USER": "admin", "ADMIN_PASSWORD": "secret", "TDARR_API_KEY_SEED": "fixture_tdarr_key_seed"}}, server, rec)

	if err := (tdarr.App{}).Setup(context.Background(), h); err != nil {
		t.Fatalf("Setup: %v", err)
	}
	if err := (tdarr.App{}).Check(context.Background(), h); err != nil {
		t.Fatalf("Check: %v", err)
	}
	if rec.Status("admin") != stepstatus.StepOK {
		t.Fatalf("admin step = %q, want ok", rec.Status("admin"))
	}
	if h.Secret("TDARR_HOMARR_API_KEY") != "tapi_fixture_tdarr_key_seed" || rec.Status("homarr-api-key") != stepstatus.StepOK {
		t.Fatal("Setup must save and verify only its native seeded key")
	}
}

func TestRerunSkipsEveryStep(t *testing.T) {
	server := httptest.NewServer((&fakeTdarr{password: "secret", token: "t1"}).handler())
	defer server.Close()
	rec := &porttest.Recorder{}
	h := porttest.New(t, porttest.Options{App: "tdarr", Service: "tdarr", Homarr: true,
		Secrets: porttest.Secrets{"ADMIN_USER": "admin", "ADMIN_PASSWORD": "secret", "TDARR_API_KEY_SEED": "fixture_tdarr_key_seed", "TDARR_HOMARR_API_KEY": "tapi_fixture_tdarr_key_seed"}}, server, rec)

	if err := (tdarr.App{}).Setup(context.Background(), h); err != nil {
		t.Fatalf("Setup: %v", err)
	}
	if rec.Status("admin") != stepstatus.StepSkip {
		t.Fatalf("admin step = %q, want skip", rec.Status("admin"))
	}
	if h.Secret("TDARR_HOMARR_API_KEY") != "tapi_fixture_tdarr_key_seed" || rec.Status("homarr-api-key") != stepstatus.StepSkip {
		t.Fatal("a valid native key must be reused on rerun")
	}
}

func TestTheHintNamesTheFirstRunPage(t *testing.T) {
	server := httptest.NewServer((&fakeTdarr{password: "changed", token: "t1"}).handler())
	defer server.Close()
	rec := &porttest.Recorder{}
	h := porttest.New(t, porttest.Options{App: "tdarr", Service: "tdarr", Homarr: true,
		Secrets: porttest.Secrets{"ADMIN_USER": "admin", "ADMIN_PASSWORD": "secret"}}, server, rec)

	if err := (tdarr.App{}).Setup(context.Background(), h); err == nil {
		t.Fatal("Setup should fail against a different owner")
	}
	if rec.Status("admin") != stepstatus.StepFail || !strings.Contains(rec.Hint(), server.URL) {
		t.Fatalf("admin step should fail with the App URL hint, got %q", rec.Hint())
	}
}
