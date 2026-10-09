//go:build e2e

package e2e

import (
	"net"
	"path/filepath"
	"slices"
	"testing"
	"time"

	"github.com/ajnart/self-host/internal/catalog"
)

func TestPassboltTLSReservationReleasesOnlyPublicationBeforeApply(t *testing.T) {
	reservation, err := reserveTargetPorts(catalog.Default(), targetSpec{Apps: []string{"passbolt"}})
	if err != nil {
		t.Fatal("reserve owned Passbolt primary port")
	}
	defer reservation.release()
	front, connect, err := reservePassboltFixturePorts(reservation)
	if err != nil {
		t.Fatal("reserve owned Passbolt TLS route")
	}
	defer front.Close()
	defer connect.Close()
	frontPort := front.Addr().(*net.TCPAddr).Port
	connectPort := connect.Addr().(*net.TCPAddr).Port
	if frontPort == connectPort || frontPort == reservation.primary["passbolt"] || !reservation.pool.owns(reservation, publishedPort{frontPort, "tcp"}) || !reservation.pool.owns(reservation, publishedPort{connectPort, "tcp"}) {
		t.Fatal("prerequisite ports were not independently owned")
	}
	reservation.closeSockets()
	if listener, err := net.Listen("tcp4", front.Addr().String()); err != nil {
		t.Fatal("TLS publication lease not released before Compose binds")
	} else {
		listener.Close()
	}
	connection, err := net.DialTimeout("tcp4", connect.Addr().String(), time.Second)
	if err != nil {
		t.Fatal("owned CONNECT listener closed before both project teardowns")
	}
	connection.Close()
	if !reservation.pool.owns(reservation, publishedPort{frontPort, "tcp"}) {
		t.Fatal("TLS ownership lost before teardown")
	}
}

func TestPassboltDockerObservationAndCleanupUseOwnedOverride(t *testing.T) {
	root := t.TempDir()
	project := filepath.Join(root, "project")
	override := filepath.Join(root, "passbolt-override.yml")
	r := &runner{root: root, project: project, name: "owned-fixture", fixtures: []fixtureEntry{{fixture: &fixtureHooks{override: override}}}}
	for _, operation := range []string{"ps", "images", "down"} {
		args := r.dockerArgs("compose", "-p", r.name, operation)
		for _, file := range []string{filepath.Join(project, "compose.yml"), override} {
			index := slices.Index(args, file)
			if index < 1 || args[index-1] != "-f" {
				t.Fatal("owned sidecar excluded from Compose observation/cleanup")
			}
		}
		if !slices.Contains(args, "--project-directory") || !slices.Contains(args, r.name) {
			t.Fatal("owned Compose mutation selectors missing")
		}
	}
}
