package wud_test

import (
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/json"
	"encoding/pem"
	"math/big"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/ajnart/self-host/internal/app"
	"github.com/ajnart/self-host/internal/apps/wud"
	"github.com/ajnart/self-host/internal/events"
	"github.com/ajnart/self-host/internal/helpers"
	stepstatus "github.com/ajnart/self-host/internal/status"
	"github.com/ajnart/self-host/internal/systemtest"
	"go.yaml.in/yaml/v3"
)

func TestComposeUsesOwnedTLSFiles(t *testing.T) {
	for _, client := range []bool{false, true} {
		t.Run(map[bool]string{false: "server trust", true: "client authentication"}[client], func(t *testing.T) {
			inputs := map[string]string{"WUD_DOCKER_HOST": "docker.internal", "WUD_DOCKER_PORT": "2376"}
			if client {
				inputs["WUD_DOCKER_TLS_CLIENT_AUTH"] = "true"
			}
			var doc struct {
				Services map[string]struct {
					Environment map[string]string `yaml:"environment"`
					Volumes     []string          `yaml:"volumes"`
				} `yaml:"services"`
			}
			if err := yaml.Unmarshal([]byte((wud.App{}).Compose(app.RenderContext{Port: 18083, Inputs: inputs})), &doc); err != nil {
				t.Fatal(err)
			}
			service := doc.Services["wud"]
			want := map[string]string{"CAFILE": "ca.pem"}
			if client {
				want["CERTFILE"] = "client-cert.pem"
				want["KEYFILE"] = "client-key.pem"
			}
			for key, file := range want {
				if service.Environment["WUD_WATCHER_DOCKER_APPROVED_"+key] != "/tls/"+file {
					t.Fatalf("watcher %s does not use its owned TLS file", key)
				}
				mounted := false
				for _, volume := range service.Volumes {
					if volume == "./tls/"+file+":/tls/"+file+":ro" {
						mounted = true
					}
				}
				if !mounted {
					t.Fatalf("TLS file %s lacks its confined read-only bind", file)
				}
			}
			if !client && service.Environment["WUD_WATCHER_DOCKER_APPROVED_KEYFILE"] != "" {
				t.Fatal("client key must be opt-in")
			}
			for key := range service.Environment {
				if strings.Contains(key, "REJECT_UNAUTHORIZED") {
					t.Fatal("TLS verification cannot be disabled")
				}
			}
		})
	}
}

func writeTLSFixture(t *testing.T, dir string, client bool) {
	t.Helper()
	public, private, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	cert := &x509.Certificate{SerialNumber: big.NewInt(1), Subject: pkix.Name{CommonName: "owned fixture CA"}, NotBefore: time.Unix(0, 0), NotAfter: time.Now().Add(time.Hour), IsCA: true, BasicConstraintsValid: true, KeyUsage: x509.KeyUsageCertSign | x509.KeyUsageDigitalSignature, ExtKeyUsage: []x509.ExtKeyUsage{x509.ExtKeyUsageClientAuth}}
	der, err := x509.CreateCertificate(rand.Reader, cert, cert, public, private)
	if err != nil {
		t.Fatal(err)
	}
	if err = os.MkdirAll(filepath.Join(dir, "tls"), 0o700); err != nil {
		t.Fatal(err)
	}
	certPEM := pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: der})
	if err = os.WriteFile(filepath.Join(dir, "tls", "ca.pem"), certPEM, 0o644); err != nil {
		t.Fatal(err)
	}
	if client {
		encoded, err := x509.MarshalPKCS8PrivateKey(private)
		if err != nil {
			t.Fatal(err)
		}
		if err = os.WriteFile(filepath.Join(dir, "tls", "client-cert.pem"), certPEM, 0o644); err != nil {
			t.Fatal(err)
		}
		if err = os.WriteFile(filepath.Join(dir, "tls", "client-key.pem"), pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: encoded}), 0o600); err != nil {
			t.Fatal(err)
		}
	}
}

type handlerTransport struct {
	handler http.Handler
	calls   int
}

func (h *handlerTransport) RoundTrip(req *http.Request) (*http.Response, error) {
	h.calls++
	record := httptest.NewRecorder()
	h.handler.ServeHTTP(record, req)
	return record.Result(), nil
}

func tlsH(t *testing.T, dir string, inputs map[string]string, transport *handlerTransport) *helpers.H {
	t.Helper()
	deps := systemtest.NewDeps(t)
	return helpers.New(helpers.Config{App: "wud", Dir: dir, BaseURL: "http://wud.fixture", Inputs: inputs, HTTP: &http.Client{Transport: transport}, Secrets: fakeSecrets{"ADMIN_USER": adminUser, "ADMIN_PASSWORD": adminPass}, Log: events.Discard(), Now: deps.Now, Sleep: deps.Sleep})
}

func TestSetupRejectsMissingOrUnsafeTLSBeforeUIReadiness(t *testing.T) {
	for _, name := range []string{"missing CA", "invalid CA", "outside symlink", "outside TLS directory", "missing client certificate", "missing client key", "mismatched client key", "invalid client key", "public client key", "invalid client choice"} {
		t.Run(name, func(t *testing.T) {
			dir := t.TempDir()
			inputs := map[string]string{"WUD_DOCKER_HOST": "docker.internal", "WUD_DOCKER_PORT": "2376"}
			if strings.Contains(name, "client") && name != "invalid client choice" {
				inputs["WUD_DOCKER_TLS_CLIENT_AUTH"] = "true"
			}
			if name != "missing CA" {
				writeTLSFixture(t, dir, true)
			}
			switch name {
			case "invalid CA":
				os.WriteFile(filepath.Join(dir, "tls", "ca.pem"), []byte("not a certificate"), 0o644)
			case "outside symlink":
				outside := filepath.Join(t.TempDir(), "outside-ca.pem")
				os.WriteFile(outside, []byte("outside fixture"), 0o644)
				os.Remove(filepath.Join(dir, "tls", "ca.pem"))
				if err := os.Symlink(outside, filepath.Join(dir, "tls", "ca.pem")); err != nil {
					t.Fatal(err)
				}
			case "outside TLS directory":
				outside := t.TempDir()
				writeTLSFixture(t, outside, false)
				if err := os.RemoveAll(filepath.Join(dir, "tls")); err != nil {
					t.Fatal(err)
				}
				if err := os.Symlink(filepath.Join(outside, "tls"), filepath.Join(dir, "tls")); err != nil {
					t.Fatal(err)
				}
			case "missing client certificate":
				os.Remove(filepath.Join(dir, "tls", "client-cert.pem"))
			case "mismatched client key":
				other := t.TempDir()
				writeTLSFixture(t, other, true)
				key, err := os.ReadFile(filepath.Join(other, "tls", "client-key.pem"))
				if err != nil {
					t.Fatal(err)
				}
				if err := os.WriteFile(filepath.Join(dir, "tls", "client-key.pem"), key, 0o600); err != nil {
					t.Fatal(err)
				}
			case "missing client key":
				os.Remove(filepath.Join(dir, "tls", "client-key.pem"))
			case "invalid client key":
				os.WriteFile(filepath.Join(dir, "tls", "client-key.pem"), []byte("bad fixture key"), 0o600)
			case "public client key":
				os.Chmod(filepath.Join(dir, "tls", "client-key.pem"), 0o644)
			case "invalid client choice":
				inputs["WUD_DOCKER_TLS_CLIENT_AUTH"] = "perhaps"
			}
			transport := &handlerTransport{handler: handler()}
			if err := (wud.App{}).Setup(context.Background(), tlsH(t, dir, inputs, transport)); err == nil {
				t.Fatal("invalid TLS prerequisites passed Setup")
			}
			if transport.calls != 0 {
				t.Fatal("Setup reached UI readiness before validating owned TLS files")
			}
		})
	}
}

func TestSetupAcceptsOwnedServerTrustAndOptionalClientPair(t *testing.T) {
	for _, client := range []bool{false, true} {
		dir := t.TempDir()
		writeTLSFixture(t, dir, client)
		inputs := map[string]string{"WUD_DOCKER_HOST": "docker.internal", "WUD_DOCKER_PORT": "2376"}
		if client {
			inputs["WUD_DOCKER_TLS_CLIENT_AUTH"] = "true"
		}
		transport := &handlerTransport{handler: handler()}
		if err := (wud.App{}).Setup(context.Background(), tlsH(t, dir, inputs, transport)); err != nil {
			t.Fatal(err)
		}
	}
}

func TestCheckRequiresAuthenticatedApprovedWatcherInventory(t *testing.T) {
	for _, tc := range []struct {
		name, body string
		pass       bool
	}{
		{name: "empty", body: `[]`},
		{name: "unapproved watcher", body: `[{"id":"owned-container","watcher":"other"}]`},
		{name: "watcher error", body: `[{"id":"owned-container","watcher":"approved","error":{"message":"fixture failure"}}]`},
		{name: "approved inventory", body: `[{"id":"owned-container","watcher":"approved"}]`, pass: true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			dir := t.TempDir()
			writeTLSFixture(t, dir, false)
			base := handler()
			transport := &handlerTransport{handler: http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if strings.HasSuffix(r.URL.Path, "/watch") && authOK(r) {
					var entries []map[string]any
					if err := json.Unmarshal([]byte(tc.body), &entries); err != nil {
						t.Fatal(err)
					}
					if len(entries) == 0 {
						t.Fatal("empty inventory must not trigger a scan")
					}
					json.NewEncoder(w).Encode(entries[0])
					return
				}
				if r.URL.Path == "/api/containers" && authOK(r) {
					w.Header().Set("Content-Type", "application/json")
					w.Write([]byte(tc.body))
					return
				}
				base.ServeHTTP(w, r)
			})}
			inputs := map[string]string{"WUD_DOCKER_HOST": "docker.internal", "WUD_DOCKER_PORT": "2376"}
			err := (wud.App{}).Check(context.Background(), tlsH(t, dir, inputs, transport))
			if (err == nil) != tc.pass {
				t.Fatalf("authenticated inventory acceptance = %v, want %v", err == nil, tc.pass)
			}
		})
	}
}

func TestRecoveryHintUsesSupportedInstallCommand(t *testing.T) {
	var hint string
	h := tlsH(t, t.TempDir(), nil, &handlerTransport{handler: handler()})
	h.Record = func(result helpers.StepResult) {
		if result.Status == stepstatus.StepFail {
			hint = result.Hint
		}
	}
	if err := (wud.App{}).Setup(context.Background(), h); err == nil {
		t.Fatal("missing endpoint passed")
	}
	if !strings.Contains(hint, "self-host install wud --yes --set") || strings.Contains(hint, "self-host setup") {
		t.Fatal("recovery hint must use the CLI command that accepts inputs")
	}
}

func TestCheckRejectsStoredInventoryWhenFreshScanFails(t *testing.T) {
	dir := t.TempDir()
	writeTLSFixture(t, dir, false)
	scans := 0
	transport := &handlerTransport{handler: http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !authOK(r) {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		if r.URL.Path == "/auth/user" {
			w.Write([]byte(`{"username":"admin","role":"admin"}`))
			return
		}
		if r.URL.Path == "/api/containers" {
			w.Write([]byte(`[{"id":"owned-container","watcher":"approved"}]`))
			return
		}
		if r.Method == http.MethodPost && r.URL.Path == "/api/containers/owned-container/watch" {
			scans++
			if _, ok := r.Context().Deadline(); !ok {
				t.Fatal("fresh watcher scan is not bounded")
			}
			w.WriteHeader(http.StatusInternalServerError)
			return
		}
		t.Fatal("unexpected watcher scan route")
	})}
	h := tlsH(t, dir, map[string]string{"WUD_DOCKER_HOST": "docker.internal"}, transport)
	if err := (wud.App{}).Check(context.Background(), h); err == nil {
		t.Fatal("stored inventory bypassed failed current TLS scan")
	}
	if scans != 1 {
		t.Fatal("Check must run exactly one approved-container scan")
	}
}
