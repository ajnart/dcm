package nextcloud_test

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/ajnart/self-host/internal/app"
	"github.com/ajnart/self-host/internal/apps/nextcloud"
	"github.com/ajnart/self-host/internal/catalog"
	"github.com/ajnart/self-host/internal/clitest"
	"github.com/ajnart/self-host/internal/events"
	"github.com/ajnart/self-host/internal/helpers"
	stepstatus "github.com/ajnart/self-host/internal/status"
	"github.com/ajnart/self-host/internal/system"
	"github.com/ajnart/self-host/internal/systemtest"
)

type fakeNextcloud struct {
	reject bool
}

func (f *fakeNextcloud) handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /status.php", func(w http.ResponseWriter, r *http.Request) {
		json.NewEncoder(w).Encode(map[string]any{"installed": true, "maintenance": false, "needsDbUpgrade": false, "versionstring": "35.0.1"})
	})
	mux.HandleFunc("GET /ocs/v2.php/cloud/user", func(w http.ResponseWriter, r *http.Request) {
		user, pass, ok := r.BasicAuth()
		if f.reject || !ok || user != "admin" || pass != "adminpass" && pass != "homarr-test-password" && pass != "another-app-password" || r.Header.Get("OCS-APIRequest") != "true" {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		json.NewEncoder(w).Encode(map[string]any{"ocs": map[string]any{
			"meta": map[string]any{"status": "ok", "statuscode": 200},
			"data": map[string]any{"id": "admin", "groups": []string{"admin"}},
		}})
	})
	mux.HandleFunc("GET /ocs/v2.php/apps/notifications/api/v2/notifications", func(w http.ResponseWriter, r *http.Request) {
		user, pass, ok := r.BasicAuth()
		if f.reject || !ok || user != "admin" || pass != "homarr-test-password" && pass != "adminpass" && pass != "another-app-password" || r.Header.Get("OCS-APIRequest") != "true" {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		json.NewEncoder(w).Encode(map[string]any{"ocs": map[string]any{
			"meta": map[string]any{"status": "ok", "statuscode": 200}, "data": []any{},
		}})
	})
	mux.HandleFunc("PROPFIND /remote.php/dav/principals/users/admin/", func(w http.ResponseWriter, r *http.Request) {
		user, pass, ok := r.BasicAuth()
		if f.reject || !ok || user != "admin" || pass != "homarr-test-password" && pass != "adminpass" && pass != "another-app-password" || r.Header.Get("Depth") != "0" {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		w.WriteHeader(http.StatusMultiStatus)
		w.Write([]byte(`<d:multistatus xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav"><d:response><d:propstat><d:prop><c:calendar-home-set><d:href>/remote.php/dav/calendars/admin/</d:href></c:calendar-home-set></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response></d:multistatus>`))
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
		App: "nextcloud", Service: "nextcloud",
		BaseURL: srv.URL, URL: srv.URL, HTTP: srv.Client(),
		Secrets: fakeSecrets{"ADMIN_USER": "admin", "ADMIN_PASSWORD": "adminpass", "NEXTCLOUD_HOMARR_APP_PASSWORD": "homarr-test-password", "NEXTCLOUD_HOMARR_APP_PASSWORD_ID": "7"},
		Exec:    &trustedExec{domains: []string{"127.0.0.1", "nextcloud"}},
		Log:     events.Discard(), Now: deps.Now, Sleep: deps.Sleep,
		Record: func(r helpers.StepResult) { recorded = append(recorded, r) },
	})
	return h, &recorded
}

func TestSetupThenCheckPass(t *testing.T) {
	srv := httptest.NewServer((&fakeNextcloud{}).handler())
	defer srv.Close()
	h, recorded := newH(t, srv)
	ctx := context.Background()

	if err := (nextcloud.App{}).Setup(ctx, h); err != nil {
		t.Fatalf("Setup: %v", err)
	}
	if err := (nextcloud.App{}).Check(ctx, h); err != nil {
		t.Fatalf("Check: %v", err)
	}
	for _, r := range *recorded {
		if r.Status == stepstatus.StepFail {
			t.Errorf("step %s failed: %s", r.ID, r.Error)
		}
	}
	inputs := (nextcloud.App{}).Inputs()
	if len(inputs) != 2 || inputs[0].Key != "homarr_app_password" || inputs[1].Key != "homarr_app_password_id" {
		t.Fatal("recovery must declare only the owned app password and matching token ID")
	}
	for _, input := range inputs {
		if !input.Private || !input.RecoveryOnly || input.Required || input.Default != "" {
			t.Fatal("recovery inputs must remain recovery-only, private, optional and without defaults")
		}
	}
	deps := systemtest.NewDeps(t)
	systemtest.SetEnv(deps, map[string]string{"SELF_HOST_ADMIN_PASSWORD": "adminpass"})
	deps.Runner.(*systemtest.Runner).OnFunc("docker compose --project-directory", func(cmd system.Cmd) system.Result {
		line := systemtest.Line(cmd)
		if strings.Contains(line, " ps ") {
			return system.Result{Stdout: []byte(`[{"Service":"nextcloud","State":"running"},{"Service":"nextcloud-db","State":"running"},{"Service":"nextcloud-redis","State":"running"},{"Service":"nextcloud-cron","State":"running"}]`)}
		}
		if strings.Contains(line, "config:system:get trusted_domains") {
			return system.Result{Stdout: []byte("127.0.0.1\nnextcloud\n192.168.1.20\n")}
		}
		if strings.Contains(line, "user:auth-tokens:list") {
			return system.Result{Stdout: []byte(`[{"id":7,"name":"self-host Homarr","type":1,"scope":{"filesystem":false}}]`)}
		}
		return system.Result{}
	})
	cat := catalog.New([]app.App{nextcloud.App{}}, nil)
	deps.In = strings.NewReader("7\r\n")
	r := clitest.Run(t, deps, cat, "install", "nextcloud", "--yes", "--json", "--set", "nextcloud.port="+clitest.Port(srv), "--set-file", "nextcloud.homarr_app_password_id=-")
	if r.Code == 0 || r.StepEvent("nextcloud", "homarr-password") != "step.manual" {
		t.Fatal("restoring an ID alone must remain Manual")
	}
	deps.In = strings.NewReader("homarr-test-password\r\n")
	r = clitest.Run(t, deps, cat, "install", "nextcloud", "--yes", "--json", "--set-file", "nextcloud.homarr_app_password=-")
	if r.Code != 0 || strings.Contains(r.Out, "homarr-test-password") {
		t.Fatalf("private recovery failed or leaked its credential: exit %d", r.Code)
	}
	deps.In = strings.NewReader("")
	r = clitest.Run(t, deps, cat, "install", "nextcloud", "--yes", "--json", "--set-file", "nextcloud.homarr_app_password=-")
	if r.Code != 0 {
		t.Fatal("an empty optional private input must preserve the saved credential")
	}
	for _, command := range deps.Runner.(*systemtest.Runner).Calls() {
		if strings.Contains(command, "homarr-test-password") || strings.Contains(command, "user:auth-tokens:add") {
			t.Fatal("private recovery leaked or reissued the credential")
		}
	}
}

func TestRerunSkipsEveryStep(t *testing.T) {
	srv := httptest.NewServer((&fakeNextcloud{}).handler())
	defer srv.Close()
	h, recorded := newH(t, srv)
	ctx := context.Background()
	if err := (nextcloud.App{}).Setup(ctx, h); err != nil {
		t.Fatalf("first Setup: %v", err)
	}

	*recorded = nil
	if err := (nextcloud.App{}).Setup(ctx, h); err != nil {
		t.Fatalf("second Setup: %v", err)
	}
	if len(*recorded) == 0 {
		t.Fatal("no steps recorded on rerun")
	}
	for _, r := range *recorded {
		if r.Status != stepstatus.StepSkip {
			t.Errorf("step %s = %s on rerun, want skip", r.ID, r.Status)
		}
	}
	exec := h.Config.Exec.(*trustedExec)
	exec.tokens = `[{"id":7,"name":"self-host Homarr","type":1,"scope":{"filesystem":false}}]`
	if err := (nextcloud.App{}).Setup(ctx, h); err != nil || exec.creates != 0 {
		t.Fatal("a working fully recorded credential with narrower scope must be reused")
	}
	for _, password := range []string{"homarr-test-password", "adminpass", "another-app-password", ""} {
		secrets := h.Secrets.(fakeSecrets)
		secrets["NEXTCLOUD_HOMARR_APP_PASSWORD"] = password
		secrets["NEXTCLOUD_HOMARR_APP_PASSWORD_ID"] = ""
		if err := nextcloud.VerifyHomarr(ctx, h); !errors.Is(err, helpers.ErrManual) {
			t.Fatal("missing recorded token ID must remain Manual even with a working administrator credential")
		}
		if err := (nextcloud.App{}).Setup(ctx, h); !errors.Is(err, helpers.ErrManual) {
			t.Fatal("Setup must not adopt a named token without its recorded ID")
		}
		if secrets["NEXTCLOUD_HOMARR_APP_PASSWORD_ID"] != "" || secrets["NEXTCLOUD_HOMARR_APP_PASSWORD"] != password || exec.creates != 0 {
			t.Fatal("Manual recovery changed or reissued a credential")
		}
	}
	secrets := h.Secrets.(fakeSecrets)
	secrets["NEXTCLOUD_HOMARR_APP_PASSWORD"] = "clear"
	secrets["NEXTCLOUD_HOMARR_APP_PASSWORD_ID"] = "clear"
	h.Log.Secret("clear")
	if err := (nextcloud.App{}).Setup(ctx, h); !errors.Is(err, helpers.ErrManual) || exec.creates != 0 {
		t.Fatal("clearing must remain Manual while the owned token still exists")
	}
	if hint := (*recorded)[len(*recorded)-1].Hint; !strings.Contains(hint, "c-l-e-a-r (without hyphens)") {
		t.Fatal("private-input redaction hid the explicit recovery marker instructions")
	}
	exec.tokens = `[]`
	if err := (nextcloud.App{}).Setup(ctx, h); err == nil || exec.creates != 1 {
		t.Fatal("explicit clearing after revocation must reach the fixture's unavailable issuance boundary")
	}
	if secrets["NEXTCLOUD_HOMARR_APP_PASSWORD"] != "" || secrets["NEXTCLOUD_HOMARR_APP_PASSWORD_ID"] != "" {
		t.Fatal("explicit clearing must discard only the obsolete owned credential pair")
	}
}

func TestFailedLoginHintNamesTheApp(t *testing.T) {
	srv := httptest.NewServer((&fakeNextcloud{reject: true}).handler())
	defer srv.Close()
	h, recorded := newH(t, srv)

	err := (nextcloud.App{}).Setup(context.Background(), h)
	if err == nil {
		t.Fatal("Setup should fail when the administrator login is rejected")
	}
	var fail *helpers.StepResult
	for i := range *recorded {
		if (*recorded)[i].Status == stepstatus.StepFail {
			fail = &(*recorded)[i]
		}
	}
	if fail == nil || !strings.Contains(fail.Hint, srv.URL) {
		t.Fatalf("failing step hint should name the App page, got %+v", fail)
	}
	for _, required := range []string{"--set-file nextcloud.homarr_app_password=", "--set-file nextcloud.homarr_app_password_id=", "separate approval", "authentication, mounts and ports", "there is no credentials-only ingestion command", "empty files do not erase", "Never disable two-factor authentication", "not read-only"} {
		if !strings.Contains(fail.Hint, required) {
			t.Fatalf("recovery hint lacks %q", required)
		}
	}
	h.Config.Exec.(*trustedExec).twoFactor = true
	if err := (nextcloud.App{}).Setup(context.Background(), h); !errors.Is(err, helpers.ErrManual) {
		t.Fatal("two-factor credential recovery must remain Manual")
	}
}

type trustedExec struct {
	helpers.Executor
	domains   []string
	reads     int
	tokens    string
	creates   int
	twoFactor bool
}

func (e *trustedExec) Exec(_ context.Context, _ string, env map[string]string, command ...string) (system.Result, error) {
	if strings.Contains(strings.Join(command, " "), "config:system:get trusted_domains") {
		e.reads++
		return system.Result{Stdout: []byte(strings.Join(e.domains, "\n") + "\n")}, nil
	}
	if strings.Contains(strings.Join(command, " "), "user:auth-tokens:list") {
		if e.tokens != "" {
			return system.Result{Stdout: []byte(e.tokens)}, nil
		}
		return system.Result{Stdout: []byte(`[{"id":7,"name":"self-host Homarr","type":1,"scope":{"filesystem":true}}]`)}, nil
	}
	if strings.Contains(strings.Join(command, " "), "user:auth-tokens:add") {
		e.creates++
		return system.Result{}, errors.New("fixture issuance unavailable")
	}
	if strings.Contains(strings.Join(command, " "), "twofactorauth:state") {
		if e.twoFactor {
			return system.Result{Stdout: []byte("Two-factor authentication is enabled for user admin\n")}, nil
		}
		return system.Result{Stdout: []byte("Two-factor authentication is not enabled for user admin\n")}, nil
	}
	if err := json.Unmarshal([]byte(env["SELF_HOST_TRUSTED_DOMAINS"]), &e.domains); err != nil {
		return system.Result{}, err
	}
	return system.Result{}, nil
}

func TestEasyNamesSetupPreservesTrustedHostsAndCheckProbesAfresh(t *testing.T) {
	srv := httptest.NewServer((&fakeNextcloud{}).handler())
	defer srv.Close()
	h, _ := newH(t, srv)
	h.Settings = map[string]string{"EASY_NAMES": "on", "LAN_IP": "192.168.1.20"}
	exec := &trustedExec{domains: []string{"127.0.0.1", "existing.example.com"}}
	h.Config.Exec = exec
	if err := (nextcloud.App{}).Setup(context.Background(), h); err != nil {
		t.Fatal(err)
	}
	want := "127.0.0.1,existing.example.com,192.168.1.20,nextcloud.192-168-1-20.sslip.io,nextcloud"
	if strings.Join(exec.domains, ",") != want {
		t.Fatalf("domains %v", exec.domains)
	}
	before := exec.reads
	if err := (nextcloud.App{}).Check(context.Background(), h); err != nil || exec.reads <= before {
		t.Fatalf("Check error %v reads %d before %d", err, exec.reads, before)
	}
	exec.domains = []string{"127.0.0.1"}
	if err := (nextcloud.App{}).Check(context.Background(), h); err == nil {
		t.Fatal("Check must notice the missing trusted hosts")
	}
}
