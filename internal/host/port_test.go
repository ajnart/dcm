package host_test

import (
	"context"
	"testing"

	"github.com/ajnart/self-host/internal/host"
	"github.com/ajnart/self-host/internal/system"
	"github.com/ajnart/self-host/internal/systemtest"
)

func holder(t *testing.T, goos, prefix, stdout string) string {
	t.Helper()
	deps := systemtest.NewDeps(t)
	deps.GOOS = goos
	deps.Runner.(*systemtest.Runner).On(prefix, system.Result{Stdout: []byte(stdout)})
	return host.PortHolder(context.Background(), deps, 80)
}

func TestOnMacTheProgramHoldingAPortIsNamedByItsFriendlyName(t *testing.T) {
	if got := holder(t, "darwin", "lsof -nP -iTCP:80", "p1027\ncOrbStack\nf153\n"); got != "OrbStack" {
		t.Fatalf("holder %q, want OrbStack", got)
	}
	if got := holder(t, "darwin", "lsof", "p9\nccom.docker.backend\n"); got != "Docker Desktop" {
		t.Fatalf("holder %q, want Docker Desktop", got)
	}
}

func TestOnLinuxTheProgramHoldingAPortComesFromSS(t *testing.T) {
	out := "LISTEN 0 511 0.0.0.0:80 0.0.0.0:* users:((\"nginx\",pid=812,fd=6),(\"nginx\",pid=811,fd=6))\n"
	if got := holder(t, "linux", "ss -ltnpH sport = :80", out); got != "nginx" {
		t.Fatalf("holder %q, want nginx", got)
	}
	if got := holder(t, "linux", "ss", "LISTEN 0 4096 0.0.0.0:80 0.0.0.0:* users:((\"docker-proxy\",pid=1,fd=4))\n"); got != "another Docker container" {
		t.Fatalf("holder %q, want another Docker container", got)
	}
}

func TestWhenNothingCanBeSeenTheHolderIsUnknown(t *testing.T) {
	if got := holder(t, "linux", "ss", "LISTEN 0 511 0.0.0.0:80 0.0.0.0:*\n"); got != "" {
		t.Fatalf("holder %q, want unknown", got)
	}
}
