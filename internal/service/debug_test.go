package service

import (
	"context"
	"errors"
	"fmt"
	"reflect"
	"strings"
	"testing"

	"github.com/ajnart/self-host/internal/app"
	"github.com/ajnart/self-host/internal/helpers"
	"github.com/ajnart/self-host/internal/system"
	"github.com/ajnart/self-host/internal/systemtest"
)

type debugApp struct {
	testApp
	manual bool
}

func (a *debugApp) Info() app.Info {
	info := a.testApp.Info()
	info.Name, info.Docs, info.Path = "Echo", "https://example.test/docs/echo", "/web"
	return info
}

func (a *debugApp) Setup(ctx context.Context, h *helpers.H) error {
	err := h.Step(ctx, "ready", "wait for echo", helpers.StepSpec{
		Check: func(context.Context) (bool, error) { return true, nil },
	})
	if err != nil {
		return err
	}
	return h.Step(ctx, "configure", "configure echo", helpers.StepSpec{
		Check: func(context.Context) (bool, error) { return false, nil },
		Do: func(context.Context) error {
			if a.manual {
				return helpers.ErrManual
			}
			return errors.New("greetings endpoint returned 500")
		},
		Hint: "Open the echo settings page and enable greetings.",
	})
}

func failedDebugHarness(t *testing.T, manual bool) *harness {
	t.Helper()
	h := newHarness(t, &debugApp{testApp: testApp{id: "one", done: map[string]bool{}}, manual: manual})
	if err := h.install("one"); err == nil {
		t.Fatal("install should report the failed step")
	}
	return h
}

func (h *harness) adminPassword() string {
	h.t.Helper()
	p, err := h.svc.Project()
	if err != nil {
		h.t.Fatal(err)
	}
	secrets, err := p.LoadSecrets()
	if err != nil || secrets["ADMIN_PASSWORD"] == "" {
		h.t.Fatalf("no admin password: %v", err)
	}
	return secrets["ADMIN_PASSWORD"]
}

func (h *harness) logsAre(text string) {
	h.runner.OnFunc("docker compose --project-directory", func(cmd system.Cmd) system.Result {
		if strings.Contains(systemtest.Line(cmd), " logs ") {
			return system.Result{Stdout: []byte(text)}
		}
		return system.Result{}
	})
}

func TestDebugReportsAFailedApp(t *testing.T) {
	h := failedDebugHarness(t, false)
	h.runner.OnFunc("docker compose --project-directory", func(cmd system.Cmd) system.Result {
		switch line := systemtest.Line(cmd); {
		case strings.Contains(line, " ps "):
			return system.Result{Stdout: []byte(`[{"Service":"one","State":"running","Health":"unhealthy"}]`)}
		case strings.Contains(line, " logs "):
			return system.Result{Stdout: []byte("one-1  | starting\none-1  | POST /greetings 500\n")}
		}
		return system.Result{}
	})

	report, err := h.svc.Debug(context.Background(), "one")
	if err != nil {
		t.Fatal(err)
	}

	want := DebugReport{
		ID: "one", Name: "Echo", Managed: true, State: "running", Health: "unhealthy", Setup: "incomplete",
		Image: "example/test:latest", Addresses: []string{"http://192.168.1.20:9000/web"},
		Docs: "https://example.test/docs/echo",
		FailedSteps: []StepStatus{{ID: "configure", Status: "fail", Msg: "configure echo",
			Error: "greetings endpoint returned 500", Hint: "Open the echo settings page and enable greetings."}},
		Logs: []string{"one-1  | starting", "one-1  | POST /greetings 500"},
		HealthCheck: DebugHealthCheck{URL: "http://192.168.1.20:9000/web",
			Working: "any answer below HTTP 500, such as the app's page or a sign-in page; HTTP 5xx, a timeout or an empty reply means it is not up"},
	}
	if !reflect.DeepEqual(report, want) {
		t.Fatalf("report = %+v\nwant   %+v", report, want)
	}
}

func TestDebugListsManualStepsWithTheirHint(t *testing.T) {
	h := failedDebugHarness(t, true)

	report, err := h.svc.Debug(context.Background(), "one")
	if err != nil {
		t.Fatal(err)
	}

	want := []StepStatus{{ID: "configure", Status: "manual", Msg: "configure echo", Hint: "Open the echo settings page and enable greetings."}}
	if !reflect.DeepEqual(report.FailedSteps, want) {
		t.Fatalf("steps = %+v, want %+v", report.FailedSteps, want)
	}
}

func TestDebugMasksKnownSecretsInLogsAndFields(t *testing.T) {
	h := failedDebugHarness(t, false)
	secret := h.adminPassword()
	h.logsAre(fmt.Sprintf("one-1  | login failed for password %s\n", secret))

	report, err := h.svc.Debug(context.Background(), "one")
	if err != nil {
		t.Fatal(err)
	}

	if strings.Contains(fmt.Sprintf("%+v", report), secret) {
		t.Fatalf("report leaks a secret: %+v", report)
	}
	if !reflect.DeepEqual(report.Logs, []string{"one-1  | login failed for password [redacted]"}) {
		t.Fatalf("logs = %q", report.Logs)
	}
}

func TestDebugKeepsOnlyTheLast100LogLines(t *testing.T) {
	h := failedDebugHarness(t, false)
	var lines []string
	for i := 1; i <= 150; i++ {
		lines = append(lines, fmt.Sprintf("line %d", i))
	}
	h.logsAre(strings.Join(lines, "\n") + "\n")

	report, err := h.svc.Debug(context.Background(), "one")
	if err != nil {
		t.Fatal(err)
	}

	if len(report.Logs) != 100 || report.Logs[0] != "line 51" || report.Logs[99] != "line 150" {
		t.Fatalf("logs = %d lines, first %q, last %q", len(report.Logs), report.Logs[0], report.Logs[len(report.Logs)-1])
	}
}

func TestDebugRejectsAnAppOutsideTheProject(t *testing.T) {
	h := failedDebugHarness(t, false)

	_, err := h.svc.Debug(context.Background(), "ghost")

	if err == nil || err.Error() != "ghost is not in the Project (see: self-host status)" {
		t.Fatalf("err = %v", err)
	}
}
