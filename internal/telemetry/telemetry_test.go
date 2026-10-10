package telemetry_test

import (
	"errors"
	"fmt"
	"io/fs"
	"reflect"
	"regexp"
	"strings"
	"testing"
	"time"

	"github.com/ajnart/self-host/internal/telemetry"
	"github.com/ajnart/self-host/internal/telemetry/telemetrytest"
)

type setup struct {
	net   *telemetrytest.Transport
	store *telemetrytest.Store
	env   map[string]string
	opts  telemetry.Options
}

func enabled(t *testing.T) *setup {
	t.Helper()
	s := &setup{net: &telemetrytest.Transport{}, store: &telemetrytest.Store{}, env: map[string]string{}}
	s.opts = telemetry.Options{
		Key:       "phc_test",
		Version:   "1.2.3",
		OS:        "linux",
		Arch:      "amd64",
		Getenv:    func(key string) string { return s.env[key] },
		Store:     s.store,
		Transport: s.net,
		Deadline:  2 * time.Second,
	}
	s.announce()
	return s
}

func (s *setup) announce() {
	telemetry.New(s.opts).Announce()
}

func (s *setup) send(r telemetry.Report) {
	telemetry.New(s.opts).Send(r)
}

var install = telemetry.Report{Command: "install", Duration: 1500 * time.Millisecond, Outcome: telemetry.OutcomeOK}

func TestNothingIsSentWhenTelemetryIsOff(t *testing.T) {
	cases := []struct {
		name  string
		tweak func(s *setup)
	}{
		{"SELF_HOST_NO_TELEMETRY", func(s *setup) { s.env["SELF_HOST_NO_TELEMETRY"] = "1" }},
		{"DO_NOT_TRACK", func(s *setup) { s.env["DO_NOT_TRACK"] = "1" }},
		{"CI", func(s *setup) { s.env["CI"] = "true" }},
		{"development build", func(s *setup) { s.opts.Version = "dev" }},
		{"test build", func(s *setup) { s.opts.Version = "test" }},
		{"placeholder project key", func(s *setup) { s.opts.Key = telemetry.NoKey }},
		{"no Home folder", func(s *setup) { s.opts.Store = nil }},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			s := enabled(t)
			c.tweak(s)
			s.send(install)
			if got := len(s.net.Bodies()); got != 0 {
				t.Fatalf("sent %d requests, want 0", got)
			}
		})
	}
}

func TestADefaultClientSendsNothing(t *testing.T) {
	var opts telemetry.Options
	telemetry.New(opts).Send(install)
	if telemetry.ProjectKey != telemetry.NoKey {
		t.Fatalf("ProjectKey = %q, want the development placeholder %q", telemetry.ProjectKey, telemetry.NoKey)
	}
}

func TestACommandIsOneEvent(t *testing.T) {
	s := enabled(t)
	s.send(install)
	events := s.net.Events()
	if len(events) != 1 {
		t.Fatalf("got %d events, want 1: %v", len(events), events)
	}
	e := events[0]
	props := e["properties"].(map[string]any)
	want := map[string]any{
		"command":                 "install",
		"duration_ms":             float64(1500),
		"outcome":                 "ok",
		"version":                 "1.2.3",
		"os":                      "linux",
		"arch":                    "amd64",
		"$process_person_profile": false,
		"$geoip_disable":          true,
	}
	if e["event"] != "command" {
		t.Errorf("event = %v, want command", e["event"])
	}
	for key, value := range want {
		if props[key] != value {
			t.Errorf("properties[%q] = %v, want %v", key, props[key], value)
		}
	}
}

func distinctIDs(s *setup) []string {
	var ids []string
	for _, e := range s.net.Events() {
		ids = append(ids, e["distinct_id"].(string))
	}
	return ids
}

func TestTheInstallIDIsARandomUUIDKeptInTheHomeFolder(t *testing.T) {
	s := enabled(t)
	s.send(install)
	s.send(install)
	ids := distinctIDs(s)
	if len(ids) != 2 || ids[0] != ids[1] {
		t.Fatalf("ids across two runs = %v, want one stable ID", ids)
	}
	uuid := regexp.MustCompile(`^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$`)
	if !uuid.MatchString(ids[0]) {
		t.Fatalf("install ID %q is not a v4 UUID", ids[0])
	}
	saved, err := s.store.ReadHomeFile("telemetry-id")
	if err != nil || strings.TrimSpace(string(saved)) != ids[0] {
		t.Fatalf("telemetry-id = %q, %v; want %q", saved, err, ids[0])
	}
}

func TestDeletingTheIDFileStartsANewInstall(t *testing.T) {
	s := enabled(t)
	s.send(install)
	s.store.Remove("telemetry-id")
	s.send(install)
	ids := distinctIDs(s)
	if len(ids) != 2 || ids[0] == ids[1] {
		t.Fatalf("ids = %v, want two different IDs", ids)
	}
}

func TestInstallIDsDifferBetweenInstalls(t *testing.T) {
	a, b := enabled(t), enabled(t)
	a.send(install)
	b.send(install)
	if distinctIDs(a)[0] == distinctIDs(b)[0] {
		t.Fatal("two installs share an ID")
	}
}

func TestAnInvalidIDFileIsReplaced(t *testing.T) {
	s := enabled(t)
	s.store.WriteHomeFile("telemetry-id", []byte("alice-laptop\n"), 0o644)
	s.send(install)
	if id := distinctIDs(s)[0]; id == "alice-laptop" {
		t.Fatalf("kept a made-up ID %q", id)
	}
}

func TestEventsAreAnonymous(t *testing.T) {
	s := enabled(t)
	s.send(telemetry.Report{Command: "install", Outcome: telemetry.OutcomeFailed, Failure: errors.New("boom")})
	events := s.net.Events()
	if len(events) != 2 {
		t.Fatalf("got %d events, want 2", len(events))
	}
	for _, e := range events {
		props := e["properties"].(map[string]any)
		if props["$process_person_profile"] != false {
			t.Errorf("%v: $process_person_profile = %v, want false", e["event"], props["$process_person_profile"])
		}
		if props["$geoip_disable"] != true {
			t.Errorf("%v: $geoip_disable = %v, want true", e["event"], props["$geoip_disable"])
		}
		if _, found := props["$ip"]; found {
			t.Errorf("%v carries $ip", e["event"])
		}
	}
}

func TestAnInstallEventCarriesIDsAndFailedSteps(t *testing.T) {
	s := enabled(t)
	s.send(telemetry.Report{
		Command:     "install",
		Outcome:     telemetry.OutcomeIncomplete,
		Apps:        []string{"jellyfin", "sonarr"},
		Recipes:     []string{"media"},
		Access:      "lan",
		FailedSteps: []string{"sonarr/api-key"},
		Failure:     errors.New("setup incomplete"),
	})
	props := s.net.Events()[0]["properties"].(map[string]any)
	for key, want := range map[string]any{
		"apps":         []any{"jellyfin", "sonarr"},
		"recipes":      []any{"media"},
		"access":       "lan",
		"failed_steps": []any{"sonarr/api-key"},
	} {
		if !reflect.DeepEqual(props[key], want) {
			t.Errorf("properties[%q] = %v, want %v", key, props[key], want)
		}
	}
}

func TestAFailureIsAnExceptionWithAFingerprintAndNoErrorText(t *testing.T) {
	s := enabled(t)
	failure := fmt.Errorf("open /home/alice/.self-host/secrets.env: %w", &fs.PathError{Op: "open", Path: "/home/alice/.self-host/secrets.env", Err: errors.New("permission denied")})
	s.send(telemetry.Report{Command: "setup", Outcome: telemetry.OutcomeFailed, Failure: failure})
	events := s.net.Events()
	if len(events) != 2 || events[1]["event"] != "$exception" {
		t.Fatalf("events = %v, want command then $exception", events)
	}
	props := events[1]["properties"].(map[string]any)
	if got := props["$exception_fingerprint"]; got != "setup|*errors.errorString|" {
		t.Errorf("fingerprint = %v, want setup|*errors.errorString|", got)
	}
	items := props["$exception_list"].([]any)
	item := items[0].(map[string]any)
	if item["type"] != "*errors.errorString" || item["value"] != "command failed" {
		t.Errorf("exception = %v, want type *errors.errorString and value %q", item, "command failed")
	}
	for key, want := range map[string]any{"version": "1.2.3", "os": "linux", "arch": "amd64", "command": "setup"} {
		if props[key] != want {
			t.Errorf("properties[%q] = %v, want %v", key, props[key], want)
		}
	}
	if _, found := props["$exception_list"].([]any)[0].(map[string]any)["stacktrace"]; found {
		t.Error("the exception carries a stack trace, which names source paths")
	}
}

func TestAFailedStepNamesTheException(t *testing.T) {
	s := enabled(t)
	s.send(telemetry.Report{Command: "install", Outcome: telemetry.OutcomeIncomplete, FailedSteps: []string{"sonarr/api-key", "jellyfin/wizard"}, Failure: errors.New("x")})
	props := s.net.Events()[1]["properties"].(map[string]any)
	if got := props["$exception_fingerprint"]; got != "install|StepFailed|jellyfin/wizard,sonarr/api-key" {
		t.Errorf("fingerprint = %v", got)
	}
	item := props["$exception_list"].([]any)[0].(map[string]any)
	if item["type"] != "StepFailed" || item["value"] != "failed at jellyfin/wizard, sonarr/api-key" {
		t.Errorf("exception = %v", item)
	}
}

func TestSuccessAndManualStepsAreNotExceptions(t *testing.T) {
	for _, outcome := range []telemetry.Outcome{telemetry.OutcomeOK, telemetry.OutcomeManual} {
		s := enabled(t)
		s.send(telemetry.Report{Command: "install", Outcome: outcome})
		if n := len(s.net.Events()); n != 1 {
			t.Errorf("%s: %d events, want 1", outcome, n)
		}
	}
}

func TestASlowEndpointNeverDelaysACommand(t *testing.T) {
	s := enabled(t)
	hold := make(chan struct{})
	defer close(hold)
	s.net.Hold = hold
	s.opts.Deadline = 100 * time.Millisecond
	start := time.Now()
	s.send(install)
	if took := time.Since(start); took > time.Second {
		t.Fatalf("Send took %v against an endpoint that never answers", took)
	}
	if len(s.net.Bodies()) == 0 {
		t.Fatal("the request never started, so the test proved nothing")
	}
}

func TestNothingIsSentBeforeTheNoticeIsAnnounced(t *testing.T) {
	s := enabled(t)
	s.store.Remove("telemetry-notice")
	s.send(install)
	if n := len(s.net.Bodies()); n != 0 {
		t.Fatalf("sent %d requests before the notice", n)
	}
}

func TestTheNoticeIsDueOnce(t *testing.T) {
	s := enabled(t)
	s.store.Remove("telemetry-notice")
	c := telemetry.New(s.opts)
	if !c.Announce() {
		t.Fatal("first Announce = false, want true")
	}
	if c.Announce() || telemetry.New(s.opts).Announce() {
		t.Fatal("the notice is due twice")
	}
}

func TestNoNoticeWhenTelemetryIsOff(t *testing.T) {
	s := enabled(t)
	s.store.Remove("telemetry-notice")
	s.env["DO_NOT_TRACK"] = "1"
	if telemetry.New(s.opts).Announce() {
		t.Fatal("announced a Telemetry that is off")
	}
}

func TestTheNoticeFitsOnOneOnboardingLine(t *testing.T) {
	if n := len([]rune(telemetry.NoticeShort)); n > 76 {
		t.Fatalf("NoticeShort is %d columns, want at most 76", n)
	}
}

func TestNoPathHostNameInputOrSecretIsEverSent(t *testing.T) {
	seeded := []string{
		"/home/alice/.self-host/secrets.env",
		"/srv/media",
		"nas.example.com",
		"alice-laptop",
		"192.168.1.20",
		"hunter2-s3cret",
		"JELLYFIN_API_KEY=abc123",
	}
	s := enabled(t)
	s.send(telemetry.Report{
		Command:     "install /srv/media",
		Outcome:     telemetry.OutcomeFailed,
		Duration:    time.Second,
		Apps:        []string{"jellyfin", "/srv/media", "nas.example.com/x", "hunter2-s3cret/leak"},
		Recipes:     []string{"media", "alice laptop"},
		Access:      "nas.example.com",
		FailedSteps: []string{"jellyfin/api-key", "/home/alice/.self-host/secrets.env", "JELLYFIN_API_KEY=abc123"},
		Failure: fmt.Errorf("read %s on alice-laptop (192.168.1.20): password hunter2-s3cret, JELLYFIN_API_KEY=abc123: %w",
			seeded[0], &fs.PathError{Op: "open", Path: seeded[1], Err: errors.New(seeded[2])}),
	})
	bodies := s.net.Bodies()
	if len(bodies) == 0 {
		t.Fatal("nothing was captured")
	}
	for _, body := range bodies {
		for _, value := range seeded {
			if strings.Contains(body, value) {
				t.Errorf("payload carries %q:\n%s", value, body)
			}
		}
		if strings.Contains(body, "stacktrace") {
			t.Errorf("payload carries a stack trace:\n%s", body)
		}
	}
	props := s.net.Events()[0]["properties"].(map[string]any)
	if props["apps"].([]any)[0] != "jellyfin" || len(props["apps"].([]any)) != 1 {
		t.Errorf("apps = %v, want only the clean ID", props["apps"])
	}
}
