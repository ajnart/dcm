package pihole_test

import (
	"context"
	"encoding/json"
	"github.com/ajnart/self-host/internal/apps/pihole"
	"github.com/ajnart/self-host/internal/helpers"
	"github.com/ajnart/self-host/internal/system"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

type bootstrapProbe struct{ calls int }

func (p *bootstrapProbe) Exec(context.Context, string, map[string]string, ...string) (system.Result, error) {
	p.calls++
	return system.Result{Stdout: []byte("root=true\nreadable=true\nbasename=true\nexplicit=false\n")}, nil
}
func (*bootstrapProbe) LogText(context.Context, int, ...string) (string, error) {
	panic("logs out of scope")
}
func (*bootstrapProbe) Restart(context.Context, ...string) error {
	panic("password changes out of scope")
}

func TestFailureDiagnosticsSeparateAuthenticationFromLocalAPIAndBootstrap(t *testing.T) {
	for _, tc := range []struct {
		name     string
		login    int
		blocking int
		want     string
	}{
		{"password rejected", 401, 0, "login_http=401 session_valid=false sid_present=false auth_http=401 auth_valid=false"},
		{"blocking denied", 200, 403, "login_http=200 session_valid=true sid_present=true auth_http=200 auth_valid=true blocking_http=403"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				switch r.URL.Path {
				case "/api/auth":
					if r.Method == http.MethodPost {
						w.WriteHeader(tc.login)
						if tc.login == 200 {
							json.NewEncoder(w).Encode(map[string]any{"session": map[string]any{"valid": true, "sid": "private-session-value"}})
						} else {
							w.Write([]byte(`{"error":"private-response-value"}`))
						}
					} else if r.Header.Get("X-FTL-SID") == "private-session-value" {
						w.Write([]byte(`{"session":{"valid":true}}`))
					} else {
						w.WriteHeader(401)
					}
				case "/api/dns/blocking":
					w.WriteHeader(tc.blocking)
				default:
					w.WriteHeader(200)
				}
			}))
			defer srv.Close()
			var records []helpers.StepResult
			h := newH(t, srv, &records)
			probe := &bootstrapProbe{}
			h.Config.Exec = probe
			err := (pihole.App{}).Check(context.Background(), h)
			if err == nil || !strings.Contains(err.Error(), tc.want) || !strings.Contains(err.Error(), "exec_root=true password_file_readable=true file_basename_matches=true explicit_container_password_env=false") {
				t.Fatalf("diagnostic missing fixed facts: %v", err)
			}
			for _, secret := range []string{adminPass, "private-session-value", "private-response-value"} {
				if strings.Contains(err.Error(), secret) {
					t.Fatal("private response or credential escaped")
				}
			}
			if probe.calls != 1 {
				t.Fatal("failure must run only one bounded metadata probe")
			}
		})
	}
}

func TestSuccessfulAuthenticationDoesNotRunBootstrapDiagnostics(t *testing.T) {
	fake := &fakePihole{password: adminPass}
	srv := httptest.NewServer(fake.handler())
	defer srv.Close()
	var records []helpers.StepResult
	h := newH(t, srv, &records)
	probe := &bootstrapProbe{}
	h.Config.Exec = probe
	if err := (pihole.App{}).Check(context.Background(), h); err != nil {
		t.Fatal(err)
	}
	if probe.calls != 0 {
		t.Fatal("successful authentication ran failure diagnostics")
	}
}
