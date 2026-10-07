package e2e

import (
	"encoding/json"
	"github.com/ajnart/self-host/internal/catalog"
	"github.com/ajnart/self-host/internal/events"
	"os"
	"reflect"
	"strings"
	"testing"
)

func TestAcceptanceInventory(t *testing.T) {
	got := acceptanceInventory(catalog.Default())
	data, err := os.ReadFile("testdata/inventory.json")
	if err != nil {
		t.Fatal(err)
	}
	var want []targetSpec
	if err := json.Unmarshal(data, &want); err != nil {
		t.Fatal(err)
	}
	if len(got) != 113 || !reflect.DeepEqual(got, want) {
		t.Fatalf("inventory differs: got %d targets, want %d", len(got), len(want))
	}
}

func TestInputClassification(t *testing.T) {
	for _, tc := range []struct{ id, status string }{
		{"ntfy", "runnable"}, {"restic", "runnable"}, {"borgmatic", "runnable"},
		{"cloudflare-tunnel", "awaiting-external-credentials"}, {"minio", "awaiting-external-credentials"},
		{"headscale", "missing-configuration"}, {"remote-access", "awaiting-external-credentials"},
	} {
		target := findTarget(acceptanceInventory(catalog.Default()), tc.id)
		if got := classifyTarget(catalog.Default(), target); got != tc.status {
			t.Errorf("%s: got %s, want %s", tc.id, got, tc.status)
		}
	}
}

func TestEvidenceNeverPromotesUnrunStages(t *testing.T) {
	e := newEvidence(targetSpec{Kind: "app", ID: "ntfy", Apps: []string{"ntfy"}}, "head")
	if e.Outcome != "not-run" || len(e.Stages) != len(stageNames) {
		t.Fatal(e)
	}
	e.Stages[0].Outcome = "pass"
	if e.complete() {
		t.Fatal("partial scenario promoted to pass")
	}
	for i := range e.Stages {
		e.Stages[i].Outcome = "pass"
	}
	if !e.complete() {
		t.Fatal("complete scenario not accepted")
	}
	e.Stages[1].Outcome = "manual"
	if e.complete() {
		t.Fatal("manual scenario promoted to pass")
	}
}

func TestReadyRequiresExpectedAppsAndHealthyContainers(t *testing.T) {
	want := []string{"ntfy", "vaultwarden"}
	if readyStatus([]statusEntry{{ID: "ntfy", State: "running", Setup: "ok"}}, want) {
		t.Fatal("missing app accepted")
	}
	good := []statusEntry{{ID: "ntfy", State: "running", Setup: "ok", Health: "healthy"}, {ID: "vaultwarden", State: "running", Setup: "ok"}}
	if !readyStatus(good, want) {
		t.Fatal("healthy expected apps rejected")
	}
	good[0].Health = "unhealthy"
	if readyStatus(good, want) {
		t.Fatal("unhealthy accepted")
	}
	if !readyStatus([]statusEntry{{ID: "restic", State: "exited", Setup: "ok"}}, []string{"restic"}) {
		t.Fatal("inert job rejected")
	}
}

func TestLoopbackPortsAndEvidenceNames(t *testing.T) {
	args := installArguments(targetSpec{ID: "ntfy", Apps: []string{"ntfy"}}, "/tmp/project", map[string]int{"ntfy": 30001})
	if !containsPair(args, "--exposure", "local") || !containsPair(args, "--set", "ntfy.port=30001") {
		t.Fatal(args)
	}
	if evidenceName(targetSpec{Kind: "app", ID: "media"}) == evidenceName(targetSpec{Kind: "recipe", ID: "media"}) {
		t.Fatal("evidence names collide")
	}
}

func containsPair(args []string, flag, value string) bool {
	for i := 0; i+1 < len(args); i++ {
		if args[i] == flag && args[i+1] == value {
			return true
		}
	}
	return false
}

func TestContainerReadinessRequiresSidecars(t *testing.T) {
	good := `{"Service":"app","State":"running","Health":"healthy"}` + "\n" + `{"Service":"db","State":"running","Health":""}`
	if !containersReadyJSON(good, []string{"app", "db"}) {
		t.Fatal("healthy sidecars rejected")
	}
	if containersReadyJSON(good, []string{"app", "db", "cache"}) {
		t.Fatal("missing sidecar accepted")
	}
	if containersReadyJSON(`[{"Service":"app","State":"running","Health":"unhealthy"}]`, []string{"app"}) {
		t.Fatal("unhealthy array accepted")
	}
	if !containersReadyJSON(`[{"Service":"restic","State":"exited","ExitCode":0}]`, []string{"restic"}) {
		t.Fatal("successful inert job rejected")
	}
}

func TestEnvironmentCannotOverrideOwnedProject(t *testing.T) {
	env := isolatedEnvironment([]string{"PATH=/bin", "DOCKER_HOST=unix:///run/docker.sock", "SELF_HOST_HOME=/unowned", "COMPOSE_FILE=/unowned.yml", "BIND_IP=0.0.0.0", "ADMIN_PASSWORD=hidden", "NTFY_TOKEN=hidden"})
	if !reflect.DeepEqual(env, []string{"PATH=/bin", "DOCKER_HOST=unix:///run/docker.sock"}) {
		t.Fatal("ambient project settings or credentials retained")
	}
}

func TestImageEvidenceCoversEveryService(t *testing.T) {
	images := []imageEvidence{{Service: "app", ID: "sha256:" + strings.Repeat("a", 64), Platform: "linux/amd64"}}
	if completeImageEvidence(images, []string{"app", "db"}) {
		t.Fatal("partial image identity accepted")
	}
	images = append(images, imageEvidence{Service: "db", ID: "sha256:" + strings.Repeat("b", 64), Platform: "linux/amd64"})
	if !completeImageEvidence(images, []string{"app", "db"}) {
		t.Fatal("complete identities rejected")
	}
	images[1].Platform = ""
	if completeImageEvidence(images, []string{"app", "db"}) {
		t.Fatal("missing platform accepted")
	}
}

func TestFailureEvidenceKeepsRedactedStepDiagnostics(t *testing.T) {
	var emitted []event
	log := events.New(events.SinkFunc(func(e events.Event) { emitted = append(emitted, e) }))
	log.Secret("synthetic-private-value")
	log.Emit(events.Event{Event: events.StepFail, App: "ntfy", Step: "admin", Error: "login synthetic-private-value refused: HTTP 503", Hint: "retry synthetic-private-value after startup"})
	log.Emit(events.Event{Event: events.StepFail, App: "unowned", Step: "admin", Error: "unrelated"})
	log.Emit(events.Event{Event: events.RunEnd, Error: "general failure"})
	failures := redactedFailures(emitted, []string{"ntfy"})
	data, err := json.Marshal(failures)
	if err != nil {
		t.Fatal(err)
	}
	if len(failures) != 1 || failures[0].App != "ntfy" || failures[0].Step != "admin" || !strings.Contains(string(data), "HTTP 503") || !strings.Contains(string(data), "after startup") || strings.Contains(string(data), "synthetic-private-value") || strings.Contains(string(data), "unrelated") {
		t.Fatal("redacted failure detail missing or unrelated output retained")
	}
}

func TestFailureEvidenceUsesOnlyRedactedRunEventFallback(t *testing.T) {
	var emitted []event
	log := events.New(events.SinkFunc(func(e events.Event) { emitted = append(emitted, e) }))
	log.Secret("synthetic-private-value")
	log.Emit(events.Event{Event: events.Info, Error: "unknown output"})
	log.Emit(events.Event{Event: events.RunEnd, Error: "Compose validation rejected synthetic-private-value", Hint: "review the owned Compose fragment"})
	failures := redactedFailures(emitted, []string{"ntfy"})
	if len(failures) != 1 || failures[0].Kind != "run.error" || failures[0].Error != "Compose validation rejected [redacted]" || failures[0].Hint != "review the owned Compose fragment" || failures[0].App != "" {
		t.Fatal("structured run failure not retained safely")
	}
	if got := redactedFailures([]event{{Event: events.Info, Error: "unknown output"}}, []string{"ntfy"}); len(got) != 0 {
		t.Fatal("unknown output was trusted")
	}
}
