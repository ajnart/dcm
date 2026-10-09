package e2e

import (
	"crypto/x509"
	"encoding/json"
	"errors"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

func TestNetBirdFixtureTLSRequiresOwnedCA(t *testing.T) {
	backend := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/instance" || r.Header.Get("X-Forwarded-Proto") != "https" {
			w.WriteHeader(http.StatusBadRequest)
			return
		}
		io.WriteString(w, "owned-management-probe")
	}))
	defer backend.Close()
	listener, err := net.Listen("tcp4", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	route, err := newNetBirdRoute(t.TempDir(), listener, backend.URL)
	if err != nil {
		t.Fatal(err)
	}
	defer route.close()
	if response, err := http.Get(route.origin + "/api/instance"); err == nil {
		response.Body.Close()
		t.Fatal("untrusted fixture TLS accepted")
	} else {
		var authority x509.UnknownAuthorityError
		if !errors.As(err, &authority) {
			t.Fatal("untrusted probe failed without proving CA rejection")
		}
	}
	response, err := route.client().Get(route.origin + "/api/instance")
	if err != nil {
		t.Fatal("owned fixture CA did not establish verified TLS")
	}
	defer response.Body.Close()
	body, _ := io.ReadAll(response.Body)
	if response.StatusCode != 200 || string(body) != "owned-management-probe" {
		t.Fatal("real reverse route did not preserve management request")
	}
	info, err := os.Stat(route.caFile)
	if err != nil || info.Mode().Perm() != 0o600 {
		t.Fatal("fixture CA file must stay private")
	}
	// Exercise Go's real child trust store, rather than only our custom client.
	child := exec.Command(os.Args[0], "-test.run=^TestNetBirdChildTLS$")
	child.Env = append(os.Environ(), "SELFHOST_FIXTURE_TLS_URL="+route.origin+"/api/instance", "SSL_CERT_FILE="+route.caFile)
	if err := child.Run(); err != nil {
		t.Fatal("child SSL_CERT_FILE did not establish verified TLS")
	}
}

func TestNetBirdChildTLS(t *testing.T) {
	endpoint := os.Getenv("SELFHOST_FIXTURE_TLS_URL")
	if endpoint == "" {
		t.Skip("child-only trust-store probe")
	}
	response, err := ownedFixtureTLSClient(t).Get(endpoint)
	if err != nil {
		t.Fatal("verified child TLS failed")
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		t.Fatal("child route did not reach backend")
	}
}

func TestNetBirdFixturePortsRemainOwnedThroughRestore(t *testing.T) {
	pool := &portRegistry{used: map[publishedPort]*portReservation{}}
	reservation := &portReservation{pool: pool, primary: map[string]int{}}
	backend, listener, err := reserveNetBirdFixturePorts(reservation)
	if err != nil {
		t.Fatal(err)
	}
	defer reservation.release()
	defer listener.Close()
	tlsPort := listener.Addr().(*net.TCPAddr).Port
	reservation.closeSockets()
	for _, port := range []int{backend, tlsPort} {
		if !pool.owns(reservation, publishedPort{port, "tcp"}) {
			t.Fatal("fixture port released before source/restore cleanup")
		}
	}
	if other, err := net.Listen("tcp4", listener.Addr().String()); err == nil {
		other.Close()
		t.Fatal("TLS route lost listener ownership before restore")
	}
	reservation.release()
	if pool.owns(reservation, publishedPort{backend, "tcp"}) || pool.owns(reservation, publishedPort{tlsPort, "tcp"}) {
		t.Fatal("fixture registry not released after cleanup")
	}
}

func TestNetBirdDockerWrapperRestrictsOwnedSelectors(t *testing.T) {
	// The wrapper rejects mount sources whose realpath differs. macOS temp
	// paths cross the /var -> /private/var symlink, so resolve the root first.
	root, err := filepath.EvalSymlinks(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	project := filepath.Join(root, "project")
	if err := os.Mkdir(project, 0o700); err != nil {
		t.Fatal(err)
	}
	real := filepath.Join(root, "fake-docker")
	if err := os.WriteFile(real, []byte("#!/usr/bin/env python3\nimport json,sys\nprint(json.dumps(sys.argv[1:]))\n"), 0o700); err != nil {
		t.Fatal(err)
	}
	wrapper, err := writeNetBirdDockerWrapper(root, project, "selfhost-e2e-fixture", real, 32123)
	if err != nil {
		t.Fatal(err)
	}
	for _, args := range [][]string{{"version", "--format", "{{.Server.Version}}"}, {"info", "--format", "{{json .SecurityOptions}}"}, {"compose", "version", "--short"}} {
		if err := exec.Command(wrapper, args...).Run(); err != nil {
			t.Fatal("required read-only host preflight rejected")
		}
	}
	prefix := []string{"compose", "--project-directory", project, "-p", "selfhost-e2e-fixture", "--env-file", filepath.Join(project, ".env"), "--env-file", filepath.Join(project, "secrets.env")}
	for _, files := range [][]string{nil, {"-f", filepath.Join(project, "compose.yml")}} {
		args := append(append(append([]string{}, prefix...), files...), "up", "-d")
		out, err := exec.Command(wrapper, args...).Output()
		if err != nil {
			t.Fatal("owned Compose command rejected")
		}
		var got []string
		if json.Unmarshal(out, &got) != nil {
			t.Fatal("invalid fixture output")
		}
		joined := strings.Join(got, "|")
		if !strings.Contains(joined, "-f|"+filepath.Join(project, "compose.yml")+"|-f|"+filepath.Join(root, "netbird-override.yml")+"|up|-d") {
			t.Fatal("explicit CLI file omitted fixture override")
		}
	}
	for _, args := range [][]string{
		{"compose", "-p", "other-project", "up", "-d"},
		append(append([]string{}, prefix...), "-f", "/tmp/unowned.yml", "up"),
		append(append([]string{}, prefix...), "up", "-p", "other-project"),
		{"system", "prune", "-af"},
		{"run", "--rm", "alpine", "sh"},
		{"rm", "--force", "selfhost-backup-unowned"},
	} {
		if err := exec.Command(wrapper, args...).Run(); err == nil {
			t.Fatal("unowned Docker mutation accepted")
		}
	}
	ownedDir := filepath.Join(project, "apps", "netbird")
	if err := os.MkdirAll(ownedDir, 0o700); err != nil {
		t.Fatal(err)
	}
	name := "selfhost-backup-0123456789abcdef"
	backup := []string{"run", "--rm", "--name", name, "--network", "none", "--read-only", "--user", "0:0", "--security-opt", "no-new-privileges", "--cap-drop", "ALL", "--cap-add", "DAC_OVERRIDE", "--mount", "type=bind,src=" + ownedDir + ",dst=/owned,readonly", "--entrypoint", "sh", "-i", "docker.io/library/alpine@sha256:5291449c3df73caf6ed85e649dec1b9e818b39a5d8c871e97afc13e9cd5e8fa8", "-s"}
	if err := exec.Command(wrapper, backup...).Run(); err != nil {
		t.Fatal("owned pinned backup helper rejected")
	}
	if err := exec.Command(wrapper, "rm", "--force", name).Run(); err != nil {
		t.Fatal("created owned helper cleanup rejected")
	}
	staging, err := os.MkdirTemp(project, ".restore-")
	if err != nil {
		t.Fatal(err)
	}
	for _, relative := range []string{"apps/netbird", "replaced-netbird"} {
		dir := filepath.Join(staging, relative)
		if err := os.MkdirAll(dir, 0o700); err != nil {
			t.Fatal(err)
		}
		backup[16] = "type=bind,src=" + dir + ",dst=/owned"
		if err := exec.Command(wrapper, backup...).Run(); err != nil {
			t.Fatal("owned restore metadata/cleanup helper rejected")
		}
	}
	backup[16] = "type=bind,src=/tmp/unowned,dst=/owned,readonly"
	if err := exec.Command(wrapper, backup...).Run(); err == nil {
		t.Fatal("unowned helper mount accepted")
	}
	link := filepath.Join(staging, "apps", "netbird-link")
	if err := os.Symlink(t.TempDir(), link); err != nil {
		t.Fatal(err)
	}
	if err := os.RemoveAll(filepath.Join(staging, "apps", "netbird")); err != nil {
		t.Fatal(err)
	}
	if err := os.Rename(link, filepath.Join(staging, "apps", "netbird")); err != nil {
		t.Fatal(err)
	}
	backup[16] = "type=bind,src=" + filepath.Join(staging, "apps", "netbird") + ",dst=/owned"
	if err := exec.Command(wrapper, backup...).Run(); err == nil {
		t.Fatal("owned-looking symlink helper mount accepted")
	}
}

func TestNetBirdFixtureOverrideTargetsOwnedServer(t *testing.T) {
	root := t.TempDir()
	project := filepath.Join(root, "project")
	if _, err := writeNetBirdDockerWrapper(root, project, "selfhost-e2e-fixture", "/unused/docker", 32123); err != nil {
		t.Fatal(err)
	}
	data, err := os.ReadFile(filepath.Join(root, "netbird-override.yml"))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(data), "  netbird-server:\n") || strings.Contains(string(data), "  server:\n") {
		t.Fatal("fixture override targets the old unowned server service")
	}
}
