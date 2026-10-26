package dockge_test

import (
	"context"
	"net/http/httptest"
	"testing"

	"github.com/ajnart/self-host/internal/apps/dockge"
	"github.com/ajnart/self-host/internal/apps/porttest"
	stepstatus "github.com/ajnart/self-host/internal/status"
)

func TestAdministratorIsCreatedOverSocketIO(t *testing.T) {
	fake := porttest.NewSocketIO("", "")
	server := httptest.NewServer(fake.Handler())
	t.Cleanup(server.Close)
	rec := &porttest.Recorder{}
	h := porttest.New(t, porttest.Options{App: "dockge", Service: "dockge",
		Secrets: porttest.Secrets{"ADMIN_USER": "admin", "ADMIN_PASSWORD": "fixture-only-password"}}, server, rec)

	if err := (dockge.App{}).Setup(context.Background(), h); err != nil {
		t.Fatalf("Setup: %v", err)
	}
	if fake.User != "admin" || rec.Status("admin") != stepstatus.StepOK {
		t.Fatalf("admin not created: user=%q step=%q", fake.User, rec.Status("admin"))
	}
	if err := (dockge.App{}).Check(context.Background(), h); err != nil {
		t.Fatalf("Check: %v", err)
	}
	if err := (dockge.App{}).Setup(context.Background(), h); err != nil || rec.Steps[len(rec.Steps)-1].Status != stepstatus.StepSkip {
		t.Fatalf("rerun = %v, steps %+v", err, rec.Steps)
	}
}

func TestExistingAdministratorWithAnotherPasswordIsNotReplaced(t *testing.T) {
	fake := porttest.NewSocketIO("admin", "someone-elses")
	server := httptest.NewServer(fake.Handler())
	t.Cleanup(server.Close)
	rec := &porttest.Recorder{}
	h := porttest.New(t, porttest.Options{App: "dockge", Service: "dockge",
		Secrets: porttest.Secrets{"ADMIN_USER": "admin", "ADMIN_PASSWORD": "fixture-only-password"}}, server, rec)

	if err := (dockge.App{}).Setup(context.Background(), h); err == nil {
		t.Fatal("Setup should fail when the administrator is not the saved login")
	}
	if fake.Password != "someone-elses" {
		t.Fatal("existing administrator was replaced")
	}
}
