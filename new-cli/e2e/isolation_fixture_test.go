package e2e

import (
	"context"
	"errors"
	"github.com/ajnart/self-host/internal/app"
	"github.com/ajnart/self-host/internal/catalog"
	"net"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestSecondaryPortsAreReservedPerTargetAndPassedToInstall(t *testing.T) {
	c := catalog.Default()
	spec := targetSpec{ID: "fixture", Apps: []string{"qbittorrent", "pihole", "technitium-dns"}}
	pool := &portRegistry{}
	first, err := reserveTargetPorts(c, spec, pool)
	if err != nil {
		t.Fatal(err)
	}
	defer first.release()
	// Closing sockets before Compose starts must retain lifetime ownership.
	first.closeSockets()
	second, err := reserveTargetPorts(c, spec, pool)
	if err != nil {
		t.Fatal(err)
	}
	defer second.release()
	args := strings.Join(installArguments(spec, t.TempDir(), first.primary, first.secondary), " ")
	seen := map[int]bool{}
	for id, key := range map[string]string{"qbittorrent": "torrent-port", "pihole": "dns-port", "technitium-dns": "dns-port"} {
		port := first.secondary[id]
		if port < 1024 || port == 6881 || seen[port] || port == second.secondary[id] {
			t.Fatal("secondary ports are not independently ephemeral and retained")
		}
		seen[port] = true
		for _, protocol := range []string{"tcp", "udp"} {
			if !pool.owns(first, publishedPort{port, protocol}) {
				t.Fatal("secondary protocol reservation released before teardown")
			}
		}
		if !strings.Contains(args, "--set "+id+"."+key+"="+fmtPort(port)) {
			t.Fatal("reserved secondary port was not supplied to the actual install command")
		}
	}
	// Active reservation sockets also protect both protocols until startup.
	for _, port := range second.secondary {
		addr := net.JoinHostPort("127.0.0.1", fmtPort(port))
		if socket, err := net.Listen("tcp4", addr); err == nil {
			socket.Close()
			t.Fatal("secondary TCP socket not held")
		}
		if socket, err := net.ListenPacket("udp4", addr); err == nil {
			socket.Close()
			t.Fatal("secondary UDP socket not held")
		}
	}
}

func TestGlobalLockBoundsConcurrentRuns(t *testing.T) {
	path := filepath.Join(t.TempDir(), "lock")
	release, err := acquireGlobal(context.Background(), path)
	if err != nil {
		t.Fatal(err)
	}
	defer release()
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Millisecond)
	defer cancel()
	if unlock, err := acquireGlobal(ctx, path); err == nil {
		unlock()
		t.Fatal("second run acquired global slot")
	}
	release()
	unlock, err := acquireGlobal(context.Background(), path)
	if err != nil {
		t.Fatal(err)
	}
	unlock()
}

func TestReservedPortsAreUniqueAndReleased(t *testing.T) {
	spec := findTarget(acceptanceInventory(catalog.Default()), "ntfy")
	first, err := reserveTargetPorts(catalog.Default(), spec)
	if err != nil {
		t.Fatal(err)
	}
	defer first.release()
	second, err := reserveTargetPorts(catalog.Default(), spec)
	if err != nil {
		t.Fatal(err)
	}
	defer second.release()
	if first.primary["ntfy"] == second.primary["ntfy"] {
		t.Fatal("colliding ports")
	}
	addr := net.JoinHostPort("127.0.0.1", fmtPort(first.primary["ntfy"]))
	if listener, err := net.Listen("tcp4", addr); err == nil {
		listener.Close()
		t.Fatal("port was not reserved")
	}
	first.release()
	listener, err := net.Listen("tcp4", addr)
	if err != nil {
		t.Fatal(err)
	}
	listener.Close()
}

func TestFixedAndSecondaryPortsAreDiscovered(t *testing.T) {
	ports, err := publishedPorts("services:\n  dns:\n    ports:\n      - ${BIND_IP}:53:53/udp\n      - ${BIND_IP}:53:53/tcp\n      - ${BIND_IP}:30001:80\n")
	if err != nil || len(ports) != 3 {
		t.Fatalf("ports=%v error=%v", ports, err)
	}
	if _, err := publishedPorts("services:\n  app:\n    ports: [\"0.0.0.0:8000:80\"]\n"); err == nil {
		t.Fatal("non-loopback source accepted")
	}
}

func TestFailedTeardownRetainsProjectAndStopsSweep(t *testing.T) {
	guard := &sweepGuard{}
	removed := false
	err := cleanupOwned(func() error { return errors.New("owned down failed") }, func() { removed = true }, guard, "/tmp/owned-project")
	if err == nil || removed || !guard.Blocked || guard.RetainedProject != "/tmp/owned-project" {
		t.Fatal("failed teardown did not retain and block")
	}
	if guard.CanRunNext() {
		t.Fatal("next environment can run after failed teardown")
	}
}

func TestSuccessfulTeardownRemovesOwnedRoot(t *testing.T) {
	guard := &sweepGuard{}
	removed := false
	if err := cleanupOwned(func() error { return nil }, func() { removed = true }, guard, "/tmp/owned-project"); err != nil || !removed || !guard.CanRunNext() {
		t.Fatal("successful cleanup blocked")
	}
}

func TestFailedProjectIsNotDeletedByCleanupRetry(t *testing.T) {
	guard := &sweepGuard{Blocked: true, RetainedProject: "/tmp/owned-project"}
	downCalled, removed := false, false
	if err := cleanupOwned(func() error { downCalled = true; return nil }, func() { removed = true }, guard, "/tmp/owned-project"); err == nil || downCalled || removed {
		t.Fatal("retained recovery project was retried or deleted")
	}
}

func TestComposeIsolationRejectsGlobalResources(t *testing.T) {
	for _, source := range []string{
		"services:\n  app:\n    container_name: global-app\n",
		"services:\n  app:\n    network_mode: host\n",
		"services:\n  app:\n    volumes: [/var/run/docker.sock:/socket]\n",
		"services:\n  app:\n    labels: {com.docker.compose.project: unowned}\n",
		"services:\n  app: {}\nnetworks:\n  global: {external: true}\n",
		"services:\n  app: {}\nvolumes:\n  data: {name: global-data}\n",
	} {
		if validateComposeIsolation(source) == nil {
			t.Fatal("global resource accepted")
		}
	}
	if err := validateComposeIsolation("services:\n  app:\n    image: example/app\n    ports: [\"${BIND_IP}:30001:80\"]\n"); err != nil {
		t.Fatal(err)
	}
}

func TestEveryCatalogSourceKeepsProjectIsolation(t *testing.T) {
	for _, a := range catalog.Default().Apps() {
		source := a.Compose(app.RenderContext{Port: 30001, Inputs: localInputs[a.Info().ID]})
		if err := validateComposeIsolation(source); err != nil {
			t.Errorf("%s: %v", a.Info().ID, err)
		}
		if _, err := publishedPorts(source); err != nil {
			t.Errorf("%s: unsupported loopback port isolation", a.Info().ID)
		}
	}
}

func TestPortRegistrySurvivesSocketReleaseUntilTeardown(t *testing.T) {
	pool := &portRegistry{used: map[publishedPort]*portReservation{}}
	spec := findTarget(acceptanceInventory(catalog.Default()), "ntfy")
	first, err := reserveTargetPorts(catalog.Default(), spec, pool)
	if err != nil {
		t.Fatal(err)
	}
	defer first.release()
	port := publishedPort{first.primary["ntfy"], "tcp"}
	first.closeSockets()
	if !pool.owns(first, port) {
		t.Fatal("socket release freed lifetime reservation")
	}
	second, err := reserveTargetPorts(catalog.Default(), spec, pool)
	if err != nil {
		t.Fatal(err)
	}
	defer second.release()
	if first.primary["ntfy"] == second.primary["ntfy"] {
		t.Fatal("active target reused a released socket port")
	}
	first.release()
	if pool.owns(first, port) {
		t.Fatal("successful teardown retained port")
	}
}
