package deluge_test

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/cookiejar"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"

	"github.com/ajnart/self-host/internal/apps/deluge"
	"github.com/ajnart/self-host/internal/events"
	"github.com/ajnart/self-host/internal/helpers"
	stepstatus "github.com/ajnart/self-host/internal/status"
	"github.com/ajnart/self-host/internal/systemtest"
)

type fakeSecrets map[string]string

func (s fakeSecrets) Get(key string) string       { return s[key] }
func (s fakeSecrets) Set(key, value string) error { s[key] = value; return nil }

const (
	adminUser = "admin"
	adminPass = "correct-horse-battery"
)

type fakeDeluge struct {
	mu             sync.Mutex
	password       string
	connected      bool
	defaultDaemon  string
	activeDaemon   string
	connectOnHosts string
	connects       int
	configWrites   int
	missingRates   bool
	rotations      int
	sessions       map[string]bool
	sessionCount   int
}

func (f *fakeDeluge) handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /", func(w http.ResponseWriter, r *http.Request) { w.Write([]byte("<html>Deluge</html>")) })
	mux.HandleFunc("POST /json", func(w http.ResponseWriter, r *http.Request) {
		f.mu.Lock()
		defer f.mu.Unlock()
		var req struct {
			Method string            `json:"method"`
			Params []json.RawMessage `json:"params"`
			ID     int               `json:"id"`
		}
		json.NewDecoder(r.Body).Decode(&req)
		session, _ := r.Cookie("_session_id")
		validSession := session != nil && f.sessions[session.Value]
		if req.Method != "auth.login" && req.Method != "auth.check_session" && !validSession {
			json.NewEncoder(w).Encode(map[string]any{"result": nil, "error": map[string]any{"code": 1, "message": "Not authenticated"}, "id": req.ID})
			return
		}
		var result any = false
		switch req.Method {
		case "auth.login":
			var password string
			if len(req.Params) == 1 && json.Unmarshal(req.Params[0], &password) == nil && password == f.password {
				result = true
				if f.sessions == nil {
					f.sessions = map[string]bool{}
				}
				f.sessionCount++
				id := fmt.Sprintf("session-%d", f.sessionCount)
				f.sessions[id] = true
				http.SetCookie(w, &http.Cookie{Name: "_session_id", Value: id})
			}
		case "auth.check_session":
			result = validSession
		case "auth.delete_session":
			delete(f.sessions, session.Value)
			result = true
		case "auth.change_password":
			var oldPassword, newPassword string
			if len(req.Params) == 2 && json.Unmarshal(req.Params[0], &oldPassword) == nil &&
				json.Unmarshal(req.Params[1], &newPassword) == nil && oldPassword == f.password && validSession {
				f.password = newPassword
				f.rotations++
				result = true
			}
		case "web.connected":
			result = f.connected
		case "web.get_config":
			result = map[string]any{"default_daemon": f.defaultDaemon}
		case "web.get_hosts":
			if f.connectOnHosts != "" {
				f.connected = true
				f.activeDaemon = f.connectOnHosts
			}
			result = [][]any{{"local-daemon", "127.0.0.1", 58846, "localclient"}}
		case "web.connect":
			f.connects++
			var id string
			if len(req.Params) == 1 && json.Unmarshal(req.Params[0], &id) == nil && id == "local-daemon" {
				f.connected = true
				f.activeDaemon = id
				result = []string{"core.get_session_status"}
			}
		case "web.set_config":
			f.configWrites++
			var config struct {
				DefaultDaemon string `json:"default_daemon"`
			}
			if len(req.Params) == 1 && json.Unmarshal(req.Params[0], &config) == nil {
				f.defaultDaemon = config.DefaultDaemon
				result = nil
			}
		case "web.update_ui":
			stats := map[string]any{"download_rate": 0, "upload_rate": 0}
			if f.missingRates {
				delete(stats, "download_rate")
			}
			result = map[string]any{"connected": f.connected, "torrents": map[string]any{},
				"stats": stats}
		}
		json.NewEncoder(w).Encode(map[string]any{"result": result, "error": nil, "id": req.ID})
	})
	return mux
}

func newH(t *testing.T, srv *httptest.Server, records *[]helpers.StepResult) *helpers.H {
	t.Helper()
	deps := systemtest.NewDeps(t)
	return helpers.New(helpers.Config{
		App: "deluge", Service: "deluge",
		BaseURL: srv.URL, URL: srv.URL, HTTP: srv.Client(),
		Secrets: fakeSecrets{"ADMIN_USER": adminUser, "ADMIN_PASSWORD": adminPass},
		Log:     events.Discard(), Now: deps.Now, Sleep: deps.Sleep,
		Record: func(r helpers.StepResult) { *records = append(*records, r) },
	})
}

func TestSetupRotatesTheInitialPasswordThenCheckAndRerunSkip(t *testing.T) {
	fake := &fakeDeluge{password: "deluge"}
	srv := httptest.NewServer(fake.handler())
	t.Cleanup(srv.Close)
	var records []helpers.StepResult
	h := newH(t, srv, &records)
	ctx := context.Background()

	if err := (deluge.App{}).Setup(ctx, h); err != nil {
		t.Fatalf("Setup: %v", err)
	}
	if fake.password != adminPass {
		t.Fatalf("Setup did not rotate the Web password, got %q", fake.password)
	}
	if deluge.WebPassword(h) != adminPass || !fake.connected || fake.defaultDaemon != "local-daemon" || fake.rotations != 1 {
		t.Fatal("Setup did not save the verified Web password and persistent local daemon connection")
	}
	if err := (deluge.App{}).Check(ctx, h); err != nil {
		t.Fatalf("Check: %v", err)
	}

	records = nil
	if err := (deluge.App{}).Setup(ctx, h); err != nil {
		t.Fatalf("rerun Setup: %v", err)
	}
	for _, r := range records {
		if r.Status != stepstatus.StepSkip {
			t.Errorf("rerun step %s = %s, want skip", r.ID, r.Status)
		}
	}
	if fake.rotations != 1 {
		t.Fatal("rerun Setup rotated the valid Web password")
	}
	if err := h.SetSecret("ADMIN_PASSWORD", "replacement-admin-password"); err != nil {
		t.Fatal(err)
	}
	if err := (deluge.App{}).Setup(ctx, h); err != nil || fake.rotations != 1 || deluge.WebPassword(h) != adminPass {
		t.Fatal("Setup did not reuse the valid saved Web password after an Admin login change")
	}
	fake.connected = false
	if err := (deluge.App{}).Check(ctx, h); err == nil {
		t.Fatal("Check accepted a disconnected daemon")
	}
	if err := (deluge.App{}).Setup(ctx, h); err != nil || !fake.connected {
		t.Fatal("Setup did not restore the saved local daemon connection")
	}
	fake.activeDaemon = "remote-daemon"
	fake.defaultDaemon = ""
	fake.missingRates = true
	connects, configWrites := fake.connects, fake.configWrites
	if err := (deluge.App{}).Setup(ctx, h); err == nil || !strings.Contains(err.Error(), "valid transfer rates") {
		t.Fatal("Setup did not retain the connected daemon's queue error")
	}
	if fake.connects != connects || fake.configWrites != configWrites || fake.activeDaemon != "remote-daemon" || fake.defaultDaemon != "" {
		t.Fatal("Setup switched the active remote daemon or adopted a local default after a queue error")
	}
	fake.connected = false
	fake.connectOnHosts = "remote-daemon"
	if err := (deluge.App{}).Setup(ctx, h); err == nil || !strings.Contains(err.Error(), "valid transfer rates") {
		t.Fatal("Setup did not recheck the daemon selected during connection discovery")
	}
	if fake.connects != connects || fake.configWrites != configWrites || fake.activeDaemon != "remote-daemon" || fake.defaultDaemon != "" {
		t.Fatal("Setup replaced a daemon connected during discovery or persisted a different default")
	}
	fake.connectOnHosts = ""
	fake.missingRates = false
	fake.connected = false
	fake.defaultDaemon = "remote-daemon"
	if err := (deluge.App{}).Setup(ctx, h); !errors.Is(err, helpers.ErrManual) {
		t.Fatal("Setup must leave an unknown configured remote daemon Manual")
	}
	if fake.connects != connects || fake.configWrites != configWrites || fake.defaultDaemon != "remote-daemon" {
		t.Fatal("Setup replaced the configured remote daemon")
	}
	jar, err := cookiejar.New(nil)
	if err != nil {
		t.Fatal(err)
	}
	h.Config.HTTP.Jar = jar
	if _, err := h.HTTP(ctx, helpers.Request{Method: http.MethodPost, Path: "/json",
		JSON: map[string]any{"method": "auth.login", "params": []string{adminPass}, "id": 1}}); err != nil {
		t.Fatal(err)
	}
	if err := h.SetSecret(h.Key("web_password"), "rejected-password"); err != nil {
		t.Fatal(err)
	}
	if err := (deluge.App{}).Check(ctx, h); err == nil {
		t.Fatal("Check accepted a rejected Web password through an existing session")
	}
}

func TestFailingStepHintNamesTheSetupCommand(t *testing.T) {
	fake := &fakeDeluge{password: "changed-outside-setup"}
	srv := httptest.NewServer(fake.handler())
	t.Cleanup(srv.Close)
	var records []helpers.StepResult
	h := newH(t, srv, &records)

	if err := (deluge.App{}).Setup(context.Background(), h); err == nil {
		t.Fatal("Setup should fail when neither password works")
	}
	var hint string
	for _, r := range records {
		if r.Status == stepstatus.StepFail {
			hint = r.Hint
		}
	}
	if !strings.Contains(hint, "self-host setup deluge") {
		t.Errorf("hint should name the setup command, got %q", hint)
	}
}
