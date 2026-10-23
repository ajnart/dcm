package service

import (
	"context"
	"fmt"
	"strings"
	"syscall"
	"testing"

	"github.com/ajnart/self-host/internal/app"
	"github.com/ajnart/self-host/internal/host"
	"github.com/ajnart/self-host/internal/system"
)

func TestOnboardingChecksUsePlannedPrimaryAndProtocolPorts(t *testing.T) {
	primary := &testApp{id: "primary"}
	paired := &portInputApp{testApp: testApp{id: "paired"}}
	h := newHarness(t, primary, paired)
	h.deps.DiskUsage = func(path string) (system.DiskUsage, error) {
		if path != h.root() {
			t.Fatalf("disk checked at %q, want Home folder %q", path, h.root())
		}
		return system.DiskUsage{AvailableBytes: 20 << 30}, nil
	}
	h.deps.BindTCP = busyPorts(19000)
	h.deps.BindUDP = busyPorts(16900)

	checks := h.svc.OnboardingChecks(context.Background(), InstallOptions{
		Targets: []string{"primary", "paired"},
		Sets:    []string{"primary.port=19000", "paired.peer-port=16900"},
	})
	joined := checksText(checks)
	for _, want := range []string{"primary", "19000", "paired Peer port", "16900", "TCP and UDP"} {
		if !strings.Contains(joined, want) {
			t.Fatalf("checks lack %q: %+v", want, checks)
		}
	}
}

func TestOnboardingDefaultPortConflictWarnsWithAllocatedAlternative(t *testing.T) {
	h := newHarness(t, &testApp{id: "homarr"}, &portInputApp{testApp: testApp{id: "paired"}})
	h.deps.DiskUsage = func(string) (system.DiskUsage, error) {
		return system.DiskUsage{AvailableBytes: 20 << 30}, nil
	}
	h.deps.BindTCP = busyPorts(9000)
	h.deps.BindUDP = busyPorts(6881)

	checks := h.svc.OnboardingChecks(context.Background(), InstallOptions{Targets: []string{"homarr", "paired"}})
	if len(checks) != 4 || checks[1].Level != host.Warn ||
		!strings.Contains(checks[1].Detail, "install will use 9001 instead") || checks[1].Hint != "" ||
		checks[1].Input != "port" || checks[1].Port != 9001 {
		t.Fatalf("default conflict = %+v", checks)
	}
	if checks[3].Level != host.Warn || !strings.Contains(checks[3].Detail, "install will use 6882 instead") ||
		checks[3].Input != "peer-port" || checks[3].Port != 6882 {
		t.Fatalf("paired default conflict = %+v", checks[3])
	}
}

func TestOnboardingChecksDoNotChangeDoctor(t *testing.T) {
	h := newHarness(t)
	h.runner.On("docker version --format {{.Server.Version}}", system.Result{Stdout: []byte("27.3.1")})
	h.runner.On("docker compose version --short", system.Result{Stdout: []byte("2.29.7")})
	h.runner.On("docker info --format {{json .SecurityOptions}}", system.Result{Stdout: []byte("[]")})

	for _, check := range h.svc.Doctor(context.Background()) {
		if check.ID == "disk" || check.ID == "port" {
			t.Fatalf("Doctor gained onboarding-only check %+v", check)
		}
	}
}

type portInputApp struct{ testApp }

func (a *portInputApp) Inputs() []app.Input {
	return []app.Input{{Key: "peer-port", Prompt: "Peer port", Default: "6881", HostPortProtocols: []string{"tcp", "udp"}}}
}

func busyPorts(ports ...int) func(string, string) error {
	return func(_ string, address string) error {
		for _, port := range ports {
			if strings.HasSuffix(address, ":"+fmt.Sprint(port)) {
				return syscall.EADDRINUSE
			}
		}
		return nil
	}
}

func checksText(checks []host.Check) string {
	var lines []string
	for _, check := range checks {
		lines = append(lines, check.App, check.Title, check.Detail, check.Hint)
	}
	return strings.Join(lines, " ")
}
