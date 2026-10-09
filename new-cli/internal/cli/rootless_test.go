package cli_test

import (
	"context"
	"encoding/json"
	"strings"
	"testing"

	"github.com/ajnart/self-host/internal/events"
	"github.com/ajnart/self-host/internal/service"
	"github.com/ajnart/self-host/internal/system"
	"github.com/ajnart/self-host/internal/systemtest"
)

func TestDoctorReportsRootlessContainerMapping(t *testing.T) {
	deps := systemtest.NewDeps(t)
	deps.Runner.(*systemtest.Runner).On("docker info", system.Result{Stdout: []byte(`["name=seccomp,profile=builtin","name=rootless","name=cgroupns"]`)})
	code, out := run(t, deps, "doctor", "--json")
	check := findCheck(decodeEvents(t, out), "docker-userns")
	if code != 0 || check == nil || check["event"] != "step.ok" {
		t.Fatalf("missing rootless mapping check: exit %d\n%s", code, out)
	}
	if !strings.Contains(check["msg"].(string), "container 0:0") || !strings.Contains(check["msg"].(string), "rootless") {
		t.Fatalf("doctor did not explain the container mapping: %v", check)
	}
}

func TestRootlessReviewPreservesSavedIDsAndDoctorWarns(t *testing.T) {
	deps := systemtest.NewDeps(t)
	deps.Runner.(*systemtest.Runner).On("docker info", system.Result{Stdout: []byte(`["name=seccomp,profile=builtin"]`)})
	cat := testCatalog(&echoApp{id: "one", done: map[string]bool{}})
	if code, out := runWith(t, deps, cat, "install", "one", "--yes", "--json"); code != 0 {
		t.Fatalf("install: exit %d\n%s", code, out)
	}
	deps.Runner.(*systemtest.Runner).On("docker info", system.Result{Stdout: []byte(`["name=rootless"]`)})
	code, out := runWith(t, deps, cat, "config", "review", "--yes", "--json")
	if code != 0 {
		t.Fatalf("review: exit %d\n%s", code, out)
	}
	var review struct {
		Settings []service.SettingReview `json:"settings"`
	}
	if err := json.Unmarshal([]byte(out), &review); err != nil {
		t.Fatal(err)
	}
	for _, setting := range review.Settings {
		if setting.Key == "PUID" || setting.Key == "PGID" {
			if setting.Current != "1000" || setting.Detected != "0" || !setting.Drift || !strings.Contains(setting.Note, "rootless") {
				t.Fatalf("review did not explain preserved IDs: %+v", setting)
			}
		}
	}
	code, out = runWith(t, deps, cat, "status", "--json")
	var status service.Status
	if err := json.Unmarshal([]byte(out), &status); err != nil {
		t.Fatal(err)
	}
	if code != 0 || status.Settings["PUID"] != "1000" || status.Settings["PGID"] != "1000" {
		t.Fatalf("review changed saved IDs: exit %d\n%s", code, out)
	}
	_, out = runWith(t, deps, cat, "doctor", "--json")
	check := findCheck(decodeEvents(t, out), "project-userns")
	if check == nil || check["event"] != "step.warn" || !strings.Contains(check["hint"].(string), "PUID=0 PGID=0") {
		t.Fatalf("doctor did not report incompatible saved IDs:\n%s", out)
	}
}

func TestRootlessInstallDefaultsAndExplicitOverrides(t *testing.T) {
	for _, tc := range []struct {
		name      string
		overrides map[string]string
		uid, gid  string
	}{
		{name: "defaults", uid: "0", gid: "0"},
		{name: "explicit", overrides: map[string]string{"PUID": "1234", "PGID": "5678"}, uid: "1234", gid: "5678"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			deps := systemtest.NewDeps(t)
			deps.Runner.(*systemtest.Runner).On("docker info", system.Result{Stdout: []byte(`["name=rootless"]`)})
			cat := testCatalog(&echoApp{id: "one", done: map[string]bool{}})
			svc := service.New(deps, events.Discard(), cat)
			if err := svc.Install(context.Background(), service.InstallOptions{Targets: []string{"one"}, Settings: tc.overrides}); err != nil {
				t.Fatal(err)
			}
			code, out := runWith(t, deps, cat, "status", "--json")
			var status service.Status
			if err := json.Unmarshal([]byte(out), &status); err != nil {
				t.Fatal(err)
			}
			if code != 0 || status.Settings["PUID"] != tc.uid || status.Settings["PGID"] != tc.gid {
				t.Fatalf("installed IDs differ from defaults/overrides: exit %d\n%s", code, out)
			}
		})
	}
}

func TestDoctorWarnsWhenDockerMappingIsUnknown(t *testing.T) {
	for _, result := range []system.Result{
		{ExitCode: 1, Stderr: []byte("daemon query refused")},
		{Stdout: []byte("not JSON")},
		{Stdout: []byte("null")},
	} {
		deps := systemtest.NewDeps(t)
		deps.Runner.(*systemtest.Runner).On("docker info", result)
		code, out := run(t, deps, "doctor", "--json")
		check := findCheck(decodeEvents(t, out), "docker-userns")
		if code != 0 || check == nil || check["event"] != "step.warn" || !strings.Contains(check["msg"].(string), "could not be determined") {
			t.Fatalf("unknown mapping presented as known: exit %d\n%s", code, out)
		}
	}
}

func TestInstallWarnsBeforeApplyWhenDockerMappingIsUnknown(t *testing.T) {
	deps := systemtest.NewDeps(t)
	deps.Runner.(*systemtest.Runner).On("docker info", system.Result{Stdout: []byte("null")})
	cat := testCatalog(&echoApp{id: "one", done: map[string]bool{}})
	code, out := runWith(t, deps, cat, "install", "one", "--yes", "--json")
	events := decodeEvents(t, out)
	check := findCheck(events, "docker-userns")
	if code != 0 || check == nil || check["event"] != "step.warn" {
		t.Fatalf("install discarded the mapping warning: exit %d\n%s", code, out)
	}
	if !strings.Contains(check["msg"].(string), "could not be determined") || check["hint"] == "" || check["docs"] == "" || strings.Contains(out, "rootless mode is not enabled") {
		t.Fatalf("install did not explain unknown mapping safely:\n%s", out)
	}
	if events[0]["step"] != "docker-userns" {
		t.Fatalf("mapping warning must precede install apply:\n%s", out)
	}
}
