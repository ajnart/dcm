package e2e

import (
	"crypto/x509"
	"errors"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"strings"
	"testing"
	"time"
)

func TestAutheliaFixtureVerifiedChildTLSAndBoundedRoute(t *testing.T) {
	backend := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !strings.HasPrefix(r.Host, "auth.e2e.selfhost.test:") || r.Header.Get("X-Forwarded-Proto") != "https" || r.URL.Path != "/api/state" {
			w.WriteHeader(400)
			return
		}
		io.WriteString(w, "owned-authelia-backend")
	}))
	defer backend.Close()
	listen := func() net.Listener {
		l, e := net.Listen("tcp4", "127.0.0.1:0")
		if e != nil {
			t.Fatal(e)
		}
		return l
	}
	route, err := newAutheliaRoute(t.TempDir(), listen(), listen(), backend.URL)
	if err != nil {
		t.Fatal(err)
	}
	defer route.close()
	run := func(trusted bool, target, expected string) error {
		child := exec.Command(os.Args[0], "-test.run=^TestAutheliaFixtureChildTLS$")
		for _, v := range os.Environ() {
			k, _, _ := strings.Cut(v, "=")
			switch strings.ToUpper(k) {
			case "HTTPS_PROXY", "HTTP_PROXY", "ALL_PROXY", "NO_PROXY", "SSL_CERT_FILE", "SSL_CERT_DIR", "SELFHOST_AUTHELIA_FIXTURE_URL", "SELFHOST_AUTHELIA_FIXTURE_EXPECT":
				continue
			}
			child.Env = append(child.Env, v)
		}
		child.Env = append(child.Env, "HTTPS_PROXY="+route.proxyURL, "NO_PROXY=", "SELFHOST_AUTHELIA_FIXTURE_URL="+target, "SELFHOST_AUTHELIA_FIXTURE_EXPECT="+expected)
		if trusted {
			child.Env = append(child.Env, "SSL_CERT_FILE="+route.caFile)
		}
		return child.Run()
	}
	if err := run(false, route.origin+"/api/state", "untrusted"); err != nil {
		t.Fatal("child did not prove untrusted CA rejection")
	}
	if err := run(true, route.origin+"/api/state", "backend"); err != nil {
		t.Fatal("trusted child did not reach genuine TLS backend")
	}
	for _, target := range []string{"https://other.e2e.selfhost.test/api/state", "https://auth.e2e.selfhost.test/api/state", "https://192.0.2.1:1/api/state"} {
		if err := run(true, target, "forbidden"); err != nil {
			t.Fatal("CONNECT route did not explicitly reject unauthorized destination")
		}
	}
	info, err := os.Stat(route.caFile)
	if err != nil || info.Mode().Perm() != 0600 {
		t.Fatal("fixture CA must be private")
	}
}

func TestAutheliaFixtureChildTLS(t *testing.T) {
	target := os.Getenv("SELFHOST_AUTHELIA_FIXTURE_URL")
	if target == "" {
		t.Skip("child-only HTTPS probe")
	}
	client := &http.Client{Timeout: 10 * time.Second}
	resp, err := client.Get(target)
	expected := os.Getenv("SELFHOST_AUTHELIA_FIXTURE_EXPECT")
	if expected == "untrusted" {
		var authority x509.UnknownAuthorityError
		if !errors.As(err, &authority) {
			t.Fatal("expected certificate authority rejection")
		}
		return
	}
	if expected == "forbidden" {
		if err == nil || !strings.Contains(err.Error(), "Forbidden") {
			if resp != nil {
				resp.Body.Close()
			}
			t.Fatal("expected explicit CONNECT rejection")
		}
		return
	}
	if err != nil {
		t.Fatal("verified child HTTPS failed")
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(resp.Body)
	if err != nil || resp.StatusCode != 200 || string(body) != "owned-authelia-backend" {
		t.Fatal("child did not reach owned backend")
	}
}
