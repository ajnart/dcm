package service

import (
	"context"
	"strings"
	"testing"

	"github.com/ajnart/self-host/internal/system"
	"github.com/ajnart/self-host/internal/systemtest"
)

func TestStatusAcceptsDeclaredCompletedInit(t *testing.T) {
	status := statusWithInitFixture(t, "service_completed_successfully", `[{"Service":"one","State":"running","Health":"healthy"},{"Service":"bootstrap","State":"exited","ExitCode":0}]`)
	if status.State != "running" || status.Health != "healthy" {
		t.Fatalf("completed initialization degraded a running App: %+v", status)
	}
}

func TestStatusRequiresExplicitInitSuccessAndRunningMain(t *testing.T) {
	for _, tc := range []struct{ name, condition, containers string }{
		{"failed", "service_completed_successfully", `[{"Service":"one","State":"running"},{"Service":"bootstrap","State":"exited","ExitCode":1}]`},
		{"omitted-exit", "service_completed_successfully", `[{"Service":"one","State":"running"},{"Service":"bootstrap","State":"exited"}]`},
		{"missing-init", "service_completed_successfully", `[{"Service":"one","State":"running"}]`},
		{"unfinished-init", "service_completed_successfully", `[{"Service":"one","State":"running"},{"Service":"bootstrap","State":"running","ExitCode":0}]`},
		{"missing-main", "service_completed_successfully", `[{"Service":"bootstrap","State":"running","ExitCode":0}]`},
		{"exited-main", "service_completed_successfully", `[{"Service":"one","State":"exited","ExitCode":0},{"Service":"bootstrap","State":"exited","ExitCode":0}]`},
		{"ordinary-sidecar", "service_started", `[{"Service":"one","State":"running"},{"Service":"bootstrap","State":"exited","ExitCode":0}]`},
	} {
		t.Run(tc.name, func(t *testing.T) {
			if status := statusWithInitFixture(t, tc.condition, tc.containers); status.State == "running" {
				t.Fatalf("App reported running without completed init and running main: %+v", status)
			}
		})
	}
}

func statusWithInitFixture(t *testing.T, condition, containers string) AppStatus {
	t.Helper()
	h := newHarness(t, &testApp{id: "one", done: map[string]bool{}})
	if err := h.install("one"); err != nil {
		t.Fatal(err)
	}
	p, err := h.svc.Project()
	if err != nil {
		t.Fatal(err)
	}
	if err := p.WriteFragment("one", `services:
  one:
    image: example/test:fixed
    depends_on:
      bootstrap:
        condition: `+condition+`
  bootstrap:
    image: example/test:fixed
`); err != nil {
		t.Fatal(err)
	}
	h.runner.OnFunc("docker compose --project-directory", func(cmd system.Cmd) system.Result {
		if strings.Contains(systemtest.Line(cmd), " ps ") {
			return system.Result{Stdout: []byte(containers)}
		}
		return system.Result{}
	})
	status, err := h.svc.Status(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if len(status.Apps) != 1 {
		t.Fatalf("App inventory = %+v", status.Apps)
	}
	if len(status.Apps[0].Services) != 2 {
		t.Fatal("fixture fragment did not declare both services")
	}
	return status.Apps[0]
}
