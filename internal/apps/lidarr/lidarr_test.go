package lidarr_test

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"

	"github.com/ajnart/self-host/internal/apps/lidarr"
	"github.com/ajnart/self-host/internal/apps/porttest"
	"github.com/ajnart/self-host/internal/helpers"
	stepstatus "github.com/ajnart/self-host/internal/status"
)

type fakeLidarr struct {
	mu         sync.Mutex
	key        string
	forms      bool
	user       string
	password   string
	rejectPut  bool
	statusBody string
	hostBody   string
	configPuts int
}

func (f *fakeLidarr) host() map[string]any {
	method, required, user := "none", "enabled", ""
	if f.forms {
		method, required, user = "forms", "enabled", f.user
	}
	return map[string]any{
		"id": 1, "authenticationMethod": method, "authenticationRequired": required,
		"username": user, "password": f.password, "passwordConfirmation": "", "apiKey": f.key,
		"instanceName": "Preserved Lidarr",
	}
}

func (f *fakeLidarr) handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /ping", func(w http.ResponseWriter, r *http.Request) { w.Write([]byte("pong")) })
	mux.HandleFunc("GET /api", func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("X-Api-Key") != f.key {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		w.Write([]byte(`{"current":"v1","deprecated":[]}`))
	})
	mux.HandleFunc("GET /api/v1/system/status", func(w http.ResponseWriter, r *http.Request) {
		f.mu.Lock()
		defer f.mu.Unlock()
		if r.Header.Get("X-Api-Key") != f.key {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		if f.statusBody != "" {
			w.Write([]byte(f.statusBody))
			return
		}
		w.Write([]byte(`{"appName":"Lidarr","version":"3.1.0.4875"}`))
	})
	mux.HandleFunc("GET /api/v1/config/host", func(w http.ResponseWriter, r *http.Request) {
		f.mu.Lock()
		defer f.mu.Unlock()
		if r.Header.Get("X-Api-Key") != f.key {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		if f.hostBody != "" {
			w.Write([]byte(f.hostBody))
			return
		}
		json.NewEncoder(w).Encode(f.host())
	})
	mux.HandleFunc("PUT /api/v1/config/host/1", func(w http.ResponseWriter, r *http.Request) {
		f.mu.Lock()
		defer f.mu.Unlock()
		f.configPuts++
		if f.rejectPut {
			w.WriteHeader(http.StatusInternalServerError)
			return
		}
		var body struct{ Username, Password, InstanceName string }
		json.NewDecoder(r.Body).Decode(&body)
		if body.InstanceName != "Preserved Lidarr" {
			w.WriteHeader(http.StatusBadRequest)
			return
		}
		f.forms, f.user, f.password = true, body.Username, body.Password
		w.Write([]byte("{}"))
	})
	mux.HandleFunc("POST /login", func(w http.ResponseWriter, r *http.Request) {
		f.mu.Lock()
		defer f.mu.Unlock()
		r.ParseForm()
		if f.forms && r.PostForm.Get("username") == f.user && r.PostForm.Get("password") == f.password {
			w.Header().Set("Location", "/")
		} else {
			w.Header().Set("Location", "/login?loginFailed=true")
		}
		w.WriteHeader(http.StatusFound)
	})
	return mux
}

func writeConfig(t *testing.T, dir, key string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Join(dir, "config"), 0o755); err != nil {
		t.Fatal(err)
	}
	content := "<Config><ApiKey>" + key + "</ApiKey></Config>"
	if err := os.WriteFile(filepath.Join(dir, "config", "config.xml"), []byte(content), 0o644); err != nil {
		t.Fatal(err)
	}
}

func TestReadsTheAPIKeyAndRequiresFormsAuth(t *testing.T) {
	dir := t.TempDir()
	writeConfig(t, dir, "0123456789abcdef0123456789abcdef")
	fake := &fakeLidarr{key: "0123456789abcdef0123456789abcdef"}
	server := httptest.NewServer(fake.handler())
	defer server.Close()
	rec := &porttest.Recorder{}
	h := porttest.New(t, porttest.Options{App: "lidarr", Service: "lidarr", Dir: dir,
		Secrets: porttest.Secrets{"ADMIN_USER": "admin", "ADMIN_PASSWORD": "secret"}}, server, rec)

	if err := (lidarr.App{}).Setup(context.Background(), h); err != nil {
		t.Fatalf("Setup: %v", err)
	}
	if err := (lidarr.App{}).Check(context.Background(), h); err != nil {
		t.Fatalf("Check: %v", err)
	}
	if rec.Status("api-key") != stepstatus.StepOK || rec.Status("auth") != stepstatus.StepOK {
		t.Fatalf("api-key=%q auth=%q, want ok", rec.Status("api-key"), rec.Status("auth"))
	}
	for _, body := range []struct {
		status string
		config string
		manual bool
	}{
		{status: `{}`},
		{status: `{"appName":"Lidarr","version":"garbage"}`},
		{status: `{"appName":"Lidarr","version":"4.0.0.1"}`, manual: true},
		{config: `{"id":0,"authenticationMethod":"none","authenticationRequired":"enabled","username":"","password":"","passwordConfirmation":"","apiKey":"0123456789abcdef0123456789abcdef"}`},
		{config: `{"id":1,"authenticationMethod":2,"authenticationRequired":"enabled","username":"","password":"","passwordConfirmation":"","apiKey":"0123456789abcdef0123456789abcdef"}`},
		{config: `{"id":1,"authenticationMethod":"none","authenticationRequired":"disabled","username":"","password":"","passwordConfirmation":"","apiKey":"0123456789abcdef0123456789abcdef"}`, manual: true},
	} {
		fake.mu.Lock()
		fake.statusBody, fake.hostBody, fake.forms = body.status, body.config, false
		before := fake.configPuts
		fake.mu.Unlock()
		if err := (lidarr.App{}).Check(context.Background(), h); err == nil {
			t.Fatal("Check accepted an unsupported API/authentication contract")
		}
		blocked := &porttest.Recorder{}
		h.Record = blocked.Record
		err := (lidarr.App{}).Setup(context.Background(), h)
		fake.mu.Lock()
		puts := fake.configPuts
		fake.mu.Unlock()
		if puts != before {
			t.Fatal("Setup changed host configuration before verifying API/authentication support")
		}
		if err == nil || errors.Is(err, helpers.ErrManual) != body.manual {
			t.Fatalf("Setup must distinguish malformed responses from unsupported contracts: %v", err)
		}
		if body.manual && (blocked.Status("api-key") != stepstatus.StepManual && blocked.Status("auth") != stepstatus.StepManual || !strings.Contains(blocked.Hint(), "self-host setup lidarr")) {
			t.Fatal("unsupported contract did not retain an actionable Manual step")
		}
	}
	fake.mu.Lock()
	fake.statusBody, fake.hostBody, fake.forms = "", "", false
	fake.mu.Unlock()
	if err := (lidarr.App{}).Check(context.Background(), h); err == nil {
		t.Fatal("Check accepted disabled Forms authentication")
	}
}

func TestRerunSkipsTheConfigurationSteps(t *testing.T) {
	dir := t.TempDir()
	writeConfig(t, dir, "0123456789abcdef0123456789abcdef")
	fake := &fakeLidarr{key: "0123456789abcdef0123456789abcdef",
		statusBody: `{"appName":"Lidarr","version":"3.0.1.4866"}`}
	server := httptest.NewServer(fake.handler())
	defer server.Close()
	rec := &porttest.Recorder{}
	h := porttest.New(t, porttest.Options{App: "lidarr", Service: "lidarr", Dir: dir,
		Secrets: porttest.Secrets{"ADMIN_USER": "admin", "ADMIN_PASSWORD": "secret",
			"LIDARR_API_KEY": "0123456789abcdef0123456789abcdef"}}, server, rec)

	if err := (lidarr.App{}).Setup(context.Background(), h); err != nil {
		t.Fatalf("Setup: %v", err)
	}
	fake.mu.Lock()
	puts := fake.configPuts
	fake.mu.Unlock()
	if puts != 1 || rec.Status("auth") != stepstatus.StepOK {
		t.Fatal("a compatible different minor did not configure required Forms authentication")
	}
	rec.Steps = nil
	if err := (lidarr.App{}).Setup(context.Background(), h); err != nil {
		t.Fatalf("rerun Setup: %v", err)
	}
	if rec.Status("api-key") != stepstatus.StepSkip || rec.Status("auth") != stepstatus.StepSkip {
		t.Fatalf("rerun should skip config steps: api-key=%q auth=%q", rec.Status("api-key"), rec.Status("auth"))
	}
}

func TestTheHintNamesTheSecurityPage(t *testing.T) {
	dir := t.TempDir()
	writeConfig(t, dir, "0123456789abcdef0123456789abcdef")
	fake := &fakeLidarr{key: "0123456789abcdef0123456789abcdef", rejectPut: true,
		hostBody: `{"id":1,"authenticationMethod":"external","authenticationRequired":"enabled","username":"","password":"","passwordConfirmation":"","apiKey":"0123456789abcdef0123456789abcdef"}`}
	server := httptest.NewServer(fake.handler())
	defer server.Close()
	rec := &porttest.Recorder{}
	h := porttest.New(t, porttest.Options{App: "lidarr", Service: "lidarr", Dir: dir,
		Secrets: porttest.Secrets{"ADMIN_USER": "admin", "ADMIN_PASSWORD": "secret"}}, server, rec)

	if err := (lidarr.App{}).Setup(context.Background(), h); !errors.Is(err, helpers.ErrManual) {
		t.Fatal("Setup should leave externally managed authentication as Manual")
	}
	fake.mu.Lock()
	puts := fake.configPuts
	fake.mu.Unlock()
	if puts != 0 || rec.Status("auth") != stepstatus.StepManual || !strings.Contains(rec.Hint(), "Security") {
		t.Fatal("auth step must retain its Security-page hint without changing external authentication")
	}
}

func TestAKeyLidarrRejectsFailsTheKeyStepWithTheRecoveryHint(t *testing.T) {
	dir := t.TempDir()
	writeConfig(t, dir, "stale-key-from-the-config-file")
	server := httptest.NewServer((&fakeLidarr{key: "the-key-lidarr-uses"}).handler())
	defer server.Close()
	rec := &porttest.Recorder{}
	h := porttest.New(t, porttest.Options{App: "lidarr", Service: "lidarr", Dir: dir,
		Secrets: porttest.Secrets{"ADMIN_USER": "admin", "ADMIN_PASSWORD": "secret"}}, server, rec)

	if err := (lidarr.App{}).Setup(context.Background(), h); err == nil {
		t.Fatal("Setup should fail when Lidarr rejects the key in its config file")
	}

	want := "Run self-host setup lidarr to reread its generated API key"
	if rec.Status("api-key") != stepstatus.StepFail || !strings.Contains(rec.Hint(), want) {
		t.Fatalf("api-key=%q hint=%q, want a failed step with %q", rec.Status("api-key"), rec.Hint(), want)
	}
}
