package host_test

import (
	"syscall"
	"testing"

	"github.com/ajnart/self-host/internal/host"
	"github.com/ajnart/self-host/internal/systemtest"
)

func TestPortProbeReportsEveryAddressAndRawErrorClass(t *testing.T) {
	deps := systemtest.NewDeps(t)
	deps.BindTCP = func(network, address string) error {
		switch address {
		case "0.0.0.0:80":
			return syscall.EADDRINUSE
		case "127.0.0.1:80":
			return syscall.EACCES
		default:
			return syscall.EAFNOSUPPORT
		}
	}

	got := host.ProbePort(deps, 80)
	want := []host.PortProbe{
		{Network: "tcp4", Address: "0.0.0.0", Port: 80, Result: host.PortInUse, ErrorClass: "EADDRINUSE"},
		{Network: "tcp4", Address: "127.0.0.1", Port: 80, Result: host.PortPermission, ErrorClass: "EACCES"},
		{Network: "tcp6", Address: "::", Port: 80, Result: host.PortUnsupported, ErrorClass: "EAFNOSUPPORT"},
	}
	if len(got) != len(want) {
		t.Fatalf("got %d probes, want %d: %+v", len(got), len(want), got)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("probe %d = %+v, want %+v", i, got[i], want[i])
		}
	}
	if host.PortAvailable(got) {
		t.Fatal("port reported available despite an address already being in use")
	}
}

func TestPortProbeTreatsPermissionAndUnsupportedAsInconclusive(t *testing.T) {
	probes := []host.PortProbe{
		{Result: host.PortPermission},
		{Result: host.PortUnsupported},
		{Result: host.PortOK},
	}
	if !host.PortAvailable(probes) {
		t.Fatal("permission or unsupported binds do not prove that a port is held")
	}
}
