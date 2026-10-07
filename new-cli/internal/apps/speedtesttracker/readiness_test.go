package speedtesttracker_test

import (
	"context"
	"github.com/ajnart/self-host/internal/apps/speedtesttracker"
	"github.com/ajnart/self-host/internal/helpers"
	"github.com/ajnart/self-host/internal/system"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

type readinessExecutor struct {
	calls  int
	output string
}

func (p *readinessExecutor) Exec(_ context.Context, _ string, _ map[string]string, command ...string) (system.Result, error) {
	p.calls++
	if p.output != "" {
		return system.Result{Stdout: []byte(p.output)}, nil
	}
	return system.Result{Stdout: []byte("key=true\nreadable=true\nroot_pool=true\nupstream=false\nsource_match=true\nsource_exec=true\ncompiled_match=false\ncompiled_exec=true\nwanted=true\nup=false\nconfig=false\ncategory=log_open\npath=php_log\nprocess_root=true\ntarget_read=false\ntarget_write=false\ntarget_owner=false\n")}, nil
}

func TestReadiness502WithholdsUnexpectedRuntimeOutput(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(502) }))
	defer srv.Close()
	var records []helpers.StepResult
	h := newH(t, srv, fakeExecutor{}, &records)
	h.Config.Exec = &readinessExecutor{output: "private-runtime-value"}
	if err := (speedtesttracker.App{}).Setup(context.Background(), h); err == nil {
		t.Fatal("502 readiness passed")
	}
	for _, result := range records {
		if strings.Contains(result.Error, "private-runtime-value") {
			t.Fatal("runtime output escaped")
		}
		if result.ID == "ready" && result.Status == "fail" && !strings.Contains(result.Error, "php_bootstrap_metadata=unobserved") {
			t.Fatal("unexpected runtime output accepted")
		}
	}
}
func (*readinessExecutor) LogText(context.Context, int, ...string) (string, error) {
	panic("logs out of scope")
}
func (*readinessExecutor) Restart(context.Context, ...string) error { panic("restart out of scope") }
func TestReadiness502ReportsOnlyFixedPHPBootstrapFacts(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(502)
		w.Write([]byte("private-response-value"))
	}))
	defer srv.Close()
	var records []helpers.StepResult
	h := newH(t, srv, fakeExecutor{}, &records)
	probe := &readinessExecutor{}
	h.Config.Exec = probe
	if err := (speedtesttracker.App{}).Setup(context.Background(), h); err == nil {
		t.Fatal("502 readiness passed")
	}
	var failure string
	for _, r := range records {
		if r.ID == "ready" && r.Status == "fail" {
			failure = r.Error
		}
	}
	if !strings.Contains(failure, "HTTP 502") || !strings.Contains(failure, "app_key_present=true app_key_file_readable=true pool_identity_includes_root=true php_upstream_listening=false launcher_source_matches=true launcher_source_executable=true launcher_compiled_matches=false launcher_compiled_executable=true php_service_wanted=true php_service_up=false php_config_valid=false php_config_error=log_open php_failure_path=php_log process_uid_zero=true failure_path_readable=false failure_path_writable=false failure_path_owner_current=false") {
		t.Fatalf("fixed bootstrap facts missing: %s", failure)
	}
	if strings.Contains(failure, "private-response-value") || strings.Contains(failure, password) {
		t.Fatal("private data escaped")
	}
	if probe.calls != 1 {
		t.Fatal("diagnostics must run once after readiness timeout")
	}
}

func TestReadablePHPMainConfigFailureSuggestsHostReview(t *testing.T) {
	for _, tc := range []struct {
		category, path, readable string
		want                     bool
	}{
		{"config_open", "main_config", "true", true},
		{"config_open", "unrecognized", "true", false},
		{"directive", "main_config", "true", false},
		{"config_open", "main_config", "false", false},
	} {

		srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(502) }))
		var records []helpers.StepResult
		h := newH(t, srv, fakeExecutor{}, &records)
		h.Config.Exec = &readinessExecutor{output: "key=true readable=true root_pool=true upstream=false source_match=true source_exec=true compiled_match=true compiled_exec=true wanted=true up=false config=false category=" + tc.category + " path=" + tc.path + " process_root=true target_read=" + tc.readable + " target_write=true target_owner=true"}
		err := (speedtesttracker.App{}).Setup(context.Background(), h)
		srv.Close()
		if err == nil {
			t.Fatal("502 readiness passed")
		}
		if strings.Contains(err.Error(), "host administrator") != tc.want {
			t.Fatalf("unexpected host review recommendation for %s/%s/%s", tc.category, tc.path, tc.readable)
		}

	}
}
