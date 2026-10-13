package service

import (
	"context"
	"strings"
	"testing"

	"github.com/ajnart/self-host/internal/system"
)

func TestOnboardingChecksSelectedPortsAndHomeFolderSpace(t *testing.T) {
	h := newHarness(t, &testApp{id: "homarr"}, &testApp{id: "ntfy"})
	h.deps.DiskFree = func(path string) (uint64, error) {
		if path != h.root() {
			t.Fatalf("disk checked at %q, want Home folder %q", path, h.root())
		}
		return 12 << 30, nil
	}
	h.deps.PortFree = func(int) bool { return false }

	checks := h.svc.OnboardingChecks(context.Background(), []string{"homarr", "ntfy"})
	if len(checks) != 3 {
		t.Fatalf("checks = %+v, want disk and two selected App ports", checks)
	}
	if checks[0].ID != "disk" || checks[0].Level != "ok" || !strings.Contains(checks[0].Detail, "12 GiB free") {
		t.Fatalf("disk check = %+v", checks[0])
	}
	if checks[1].ID != "port" || checks[1].App != "homarr" || checks[1].Level != "fail" {
		t.Fatalf("Homarr port check = %+v", checks[1])
	}
	if checks[2].ID != "port" || checks[2].App != "ntfy" || checks[2].Level != "fail" ||
		!strings.Contains(checks[2].Detail, "9000") || checks[2].Hint == "" {
		t.Fatalf("ntfy port check = %+v", checks[2])
	}
}

func TestOnboardingChecksDoNotChangeDoctor(t *testing.T) {
	h := newHarness(t)
	h.deps.DiskFree = func(string) (uint64, error) { return 12 << 30, nil }
	h.deps.PortFree = func(int) bool { return false }
	h.runner.On("docker version --format {{.Server.Version}}", system.Result{Stdout: []byte("27.3.1")})
	h.runner.On("docker compose version --short", system.Result{Stdout: []byte("2.29.7")})
	h.runner.On("docker info --format {{json .SecurityOptions}}", system.Result{Stdout: []byte("[]")})

	for _, check := range h.svc.Doctor(context.Background()) {
		if check.ID == "disk" || check.ID == "port" {
			t.Fatalf("Doctor gained onboarding-only check %+v", check)
		}
	}
}
