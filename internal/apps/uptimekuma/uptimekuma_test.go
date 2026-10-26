package uptimekuma_test

import (
	"context"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/ajnart/self-host/internal/apps/porttest"
	"github.com/ajnart/self-host/internal/apps/uptimekuma"
	stepstatus "github.com/ajnart/self-host/internal/status"
)

func TestTheAdminLoginIsCreatedOverSocketIO(t *testing.T) {
	fake := porttest.NewSocketIO("", "")
	server := httptest.NewServer(fake.Handler())
	defer server.Close()
	rec := &porttest.Recorder{}
	h := porttest.New(t, porttest.Options{App: "uptime-kuma", Service: "uptime-kuma",
		Secrets: porttest.Secrets{"ADMIN_USER": "admin", "ADMIN_PASSWORD": "secret"}}, server, rec)

	if err := (uptimekuma.App{}).Setup(context.Background(), h); err != nil {
		t.Fatalf("Setup: %v", err)
	}
	if fake.User != "admin" || fake.Password != "secret" || rec.Status("admin") != stepstatus.StepOK {
		t.Fatalf("admin not created: user=%q step=%q", fake.User, rec.Status("admin"))
	}
	if err := (uptimekuma.App{}).Check(context.Background(), h); err != nil {
		t.Fatalf("Check: %v", err)
	}
}

func TestRerunSkipsEveryStep(t *testing.T) {
	server := httptest.NewServer(porttest.NewSocketIO("admin", "secret").Handler())
	defer server.Close()
	rec := &porttest.Recorder{}
	h := porttest.New(t, porttest.Options{App: "uptime-kuma", Service: "uptime-kuma",
		Secrets: porttest.Secrets{"ADMIN_USER": "admin", "ADMIN_PASSWORD": "secret"}}, server, rec)

	if err := (uptimekuma.App{}).Setup(context.Background(), h); err != nil {
		t.Fatalf("Setup: %v", err)
	}
	if rec.Status("ready") != stepstatus.StepSkip || rec.Status("admin") != stepstatus.StepSkip {
		t.Fatalf("rerun should skip: ready=%q admin=%q", rec.Status("ready"), rec.Status("admin"))
	}
}

func TestTheHintNamesTheAppPage(t *testing.T) {
	server := httptest.NewServer(porttest.NewSocketIO("admin", "changed").Handler())
	defer server.Close()
	rec := &porttest.Recorder{}
	h := porttest.New(t, porttest.Options{App: "uptime-kuma", Service: "uptime-kuma",
		Secrets: porttest.Secrets{"ADMIN_USER": "admin", "ADMIN_PASSWORD": "secret"}}, server, rec)

	if err := (uptimekuma.App{}).Setup(context.Background(), h); err == nil {
		t.Fatal("Setup should fail when the administrator is not the saved login")
	}
	if rec.Status("admin") != stepstatus.StepFail || !strings.Contains(rec.Hint(), server.URL) {
		t.Fatalf("admin step should fail with the App URL hint, got %q", rec.Hint())
	}
}
