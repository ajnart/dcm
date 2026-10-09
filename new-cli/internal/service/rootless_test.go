package service_test

import (
	"testing"

	"github.com/ajnart/self-host/internal/events"
	"github.com/ajnart/self-host/internal/service"
	"github.com/ajnart/self-host/internal/system"
	"github.com/ajnart/self-host/internal/systemtest"
)

func TestDefaultsUseContainerRootForRootlessDocker(t *testing.T) {
	deps := systemtest.NewDeps(t)
	deps.Runner.(*systemtest.Runner).On("docker info", system.Result{Stdout: []byte(`["name=seccomp,profile=builtin","name=rootless","name=cgroupns"]`)})
	svc := service.New(deps, events.Discard(), nil)
	settings, err := svc.Defaults()
	if err != nil {
		t.Fatal(err)
	}
	if settings["PUID"] != "0" || settings["PGID"] != "0" {
		t.Fatalf("rootless container IDs = %s:%s, want 0:0", settings["PUID"], settings["PGID"])
	}
	p, err := svc.Project()
	if err != nil {
		t.Fatal(err)
	}
	if p.Owner.UID != 1000 || p.Owner.GID != 1000 {
		t.Fatalf("Project filesystem owner changed: %+v", p.Owner)
	}
}

func TestRootfulDefaultsKeepHostOwnerIDs(t *testing.T) {
	deps := systemtest.NewDeps(t)
	settings, err := service.New(deps, events.Discard(), nil).Defaults()
	if err != nil {
		t.Fatal(err)
	}
	if settings["PUID"] != "1000" || settings["PGID"] != "1000" {
		t.Fatalf("rootful IDs changed: %s:%s", settings["PUID"], settings["PGID"])
	}
}
