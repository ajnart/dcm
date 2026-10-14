package telemetry_test

import (
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"reflect"
	"regexp"
	"runtime"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/ajnart/self-host/internal/system"
	"github.com/ajnart/self-host/internal/telemetry"
	"github.com/ajnart/self-host/internal/telemetry/telemetrytest"
)

type setup struct {
	net    *telemetrytest.Transport
	store  *telemetrytest.Store
	config *telemetrytest.Config
	env    map[string]string
	opts   telemetry.Options
}

func enabled(t *testing.T) *setup {
	t.Helper()
	s := &setup{net: &telemetrytest.Transport{}, store: &telemetrytest.Store{}, config: &telemetrytest.Config{}, env: map[string]string{}}
	s.opts = telemetry.Options{
		Key:       "phc_test",
		Version:   "1.2.3",
		OS:        "linux",
		Arch:      "amd64",
		Getenv:    func(key string) string { return s.env[key] },
		Store:     s.store,
		Config:    s.config,
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
		"command":        "install",
		"duration_ms":    float64(1500),
		"outcome":        "ok",
		"version":        "1.2.3",
		"os":             "linux",
		"arch":           "amd64",
		"$geoip_disable": true,
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

func TestTheInstallIDIsARandomUUIDKeptInTheUserConfigFolder(t *testing.T) {
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
	saved, err := s.config.ReadConfigFile("telemetry-id")
	if err != nil || strings.TrimSpace(string(saved)) != ids[0] {
		t.Fatalf("telemetry-id = %q, %v; want %q", saved, err, ids[0])
	}
	if _, err := s.store.ReadHomeFile("telemetry-id"); err == nil {
		t.Fatal("a new install ID was also written to the Home folder")
	}
}

func TestTheInstallIDSurvivesDeletingTheHomeFolder(t *testing.T) {
	s := enabled(t)
	s.send(install)
	s.store.Remove("telemetry-notice")
	s.store.Remove("telemetry-id")
	s.announce()
	s.send(install)
	ids := distinctIDs(s)
	if len(ids) != 2 || ids[0] != ids[1] {
		t.Fatalf("ids across a deleted Home folder = %v, want one stable ID", ids)
	}
}

func TestAnIDInTheHomeFolderIsMigratedToTheUserConfigFolder(t *testing.T) {
	const legacy = "6f1c2b6e-9d3a-4c1e-8a57-0b9d2f4e7a10"
	s := enabled(t)
	s.store.WriteHomeFile("telemetry-id", []byte(legacy+"\n"), 0o644)
	s.send(install)
	s.store.Remove("telemetry-id")
	s.send(install)
	if ids := distinctIDs(s); len(ids) != 2 || ids[0] != legacy || ids[1] != legacy {
		t.Fatalf("ids = %v, want the Home folder's ID %s twice", ids, legacy)
	}
	saved, _ := s.config.ReadConfigFile("telemetry-id")
	if strings.TrimSpace(string(saved)) != legacy {
		t.Fatalf("config telemetry-id = %q, want %s", saved, legacy)
	}
}

func TestTheConfigFolderIDWinsOverTheHomeFolderID(t *testing.T) {
	s := enabled(t)
	s.send(install)
	s.store.WriteHomeFile("telemetry-id", []byte("6f1c2b6e-9d3a-4c1e-8a57-0b9d2f4e7a10\n"), 0o644)
	s.send(install)
	if ids := distinctIDs(s); ids[0] != ids[1] {
		t.Fatalf("ids = %v, want the config folder's ID twice", ids)
	}
}

func TestWithoutAConfigFolderNothingIsSent(t *testing.T) {
	s := enabled(t)
	s.opts.Config = nil
	s.send(install)
	if len(s.net.Bodies()) != 0 {
		t.Fatal("sent with no persistent user-config identity")
	}
	if _, err := s.store.ReadHomeFile("telemetry-id"); err == nil {
		t.Fatal("an ID was written to the Home folder")
	}
}

type unwritableConfig struct{}

func (unwritableConfig) LoadOrCreateConfigFile(string, func() ([]byte, error)) ([]byte, error) {
	return nil, os.ErrPermission
}

func TestMigrationSendsNothingUntilTheIDIsSaved(t *testing.T) {
	s := enabled(t)
	s.store.WriteHomeFile("telemetry-id", []byte("6f1c2b6e-9d3a-4c1e-8a57-0b9d2f4e7a10\n"), 0o644)
	s.opts.Config = unwritableConfig{}
	s.send(install)
	if len(s.net.Bodies()) != 0 {
		t.Fatal("sent before the migrated ID was persisted")
	}
}

func TestDeletingTheIDFileStartsANewInstall(t *testing.T) {
	s := enabled(t)
	s.send(install)
	s.config.Remove("telemetry-id")
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

func TestUnexpectedIdentityStorageFailsClosedWithoutReplacement(t *testing.T) {
	for _, existing := range []string{"", "partial", "alice-laptop\n"} {
		s := enabled(t)
		s.config.WriteConfigFile("telemetry-id", []byte(existing), 0o600)
		s.send(install)
		data, err := s.config.ReadConfigFile("telemetry-id")
		if len(s.net.Bodies()) != 0 || err != nil || string(data) != existing {
			t.Fatalf("unexpected identity %q was sent or replaced: %q, %v", existing, data, err)
		}
	}
}

func TestConcurrentInitializationAndMigrationUseOnePublishedUUID(t *testing.T) {
	const legacy = "6f1c2b6e-9d3a-4c1e-8a57-0b9d2f4e7a10"
	for _, migrate := range []bool{false, true} {
		s := enabled(t)
		if migrate {
			s.store.WriteHomeFile("telemetry-id", []byte(legacy+"\n"), 0o644)
		}
		dir := filepath.Join(t.TempDir(), "self-host")
		s.opts.Config = system.ConfigFilesAt(dir)
		var workers sync.WaitGroup
		for range 16 {
			workers.Go(func() { s.send(install) })
		}
		workers.Wait()
		ids := distinctIDs(s)
		if len(ids) != 16 {
			t.Fatalf("migration %v: got %d events", migrate, len(ids))
		}
		for _, id := range ids {
			if id != ids[0] || (migrate && id != legacy) {
				t.Fatalf("migration %v: unstable identities %v", migrate, ids)
			}
		}
	}
}

func TestEventsCountPersonsButCarryNoIPOrLocation(t *testing.T) {
	s := enabled(t)
	s.send(telemetry.Report{Command: "install", Outcome: telemetry.OutcomeFailed, Failure: errors.New("boom")})
	events := s.net.Events()
	if len(events) != 2 {
		t.Fatalf("got %d events, want 2", len(events))
	}
	for _, e := range events {
		props := e["properties"].(map[string]any)
		if _, found := props["$process_person_profile"]; found {
			t.Errorf("%v: $process_person_profile = %v, want it absent so a person profile is kept", e["event"], props["$process_person_profile"])
		}
		if keys := personKeys(props); len(keys) > 0 {
			t.Errorf("%v sets person properties %v", e["event"], keys)
		}
		if props["$geoip_disable"] != true {
			t.Errorf("%v: $geoip_disable = %v, want true", e["event"], props["$geoip_disable"])
		}
		if _, found := props["$ip"]; found {
			t.Errorf("%v carries $ip", e["event"])
		}
	}
}

func personKeys(props map[string]any) []string {
	var keys []string
	for key := range props {
		if strings.HasPrefix(key, "$set") || key == "$unset" {
			keys = append(keys, key)
		}
	}
	return keys
}

func TestAnInstallEventCarriesIDsAndFailedSteps(t *testing.T) {
	s := enabled(t)
	s.send(telemetry.Report{
		Command:     "install",
		Outcome:     telemetry.OutcomeIncomplete,
		Apps:        []string{"jellyfin", "sonarr"},
		Recipes:     []string{"media"},
		Access:      "home",
		FailedSteps: []string{"sonarr/api-key"},
		Failure:     errors.New("setup incomplete"),
	})
	props := s.net.Events()[0]["properties"].(map[string]any)
	for key, want := range map[string]any{
		"apps":         []any{"jellyfin", "sonarr"},
		"recipes":      []any{"media"},
		"access":       "home",
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
	if _, found := item["stacktrace"]; !found {
		t.Error("the exception carries no stack trace")
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

func TestTheNoticeLinksTheWikiAndNamesNoOffSwitch(t *testing.T) {
	const wiki = "https://github.com/ajnart/self-host/wiki/Telemetry"
	for name, notice := range map[string]string{"Notice": telemetry.Notice, "NoticeShort": telemetry.NoticeShort} {
		if !strings.Contains(notice, wiki) {
			t.Errorf("%s = %q, want it to link %s", name, notice, wiki)
		}
		for _, banned := range []string{"SELF_HOST_NO_TELEMETRY", "DO_NOT_TRACK", "Turn off", "turn it off", "opt out"} {
			if strings.Contains(notice, banned) {
				t.Errorf("%s = %q advertises the off switch with %q", name, notice, banned)
			}
		}
		for _, claim := range []string{"anonymous usage data", "no IP", "no personal data"} {
			if !strings.Contains(strings.ToLower(notice), strings.ToLower(claim)) {
				t.Errorf("%s = %q does not say %q", name, notice, claim)
			}
		}
	}
}

func TestTheShortNoticeFitsTheOnboardingLines(t *testing.T) {
	lines := strings.Split(telemetry.NoticeShort, "\n")
	if len(lines) != 2 {
		t.Fatalf("NoticeShort has %d lines, want 2", len(lines))
	}
	for _, line := range lines {
		if n := len([]rune(line)); n > 76 {
			t.Errorf("%q is %d columns, want at most 76", line, n)
		}
	}
}

func TestTheReleaseKeyIsTheGoreleaserDefaultAndPlainBuildsHaveNone(t *testing.T) {
	const key = "phc_zY6Yg8ePwEfXC8FadEqkCcoCgzzy2u2VHjpaPTooBDfg"
	config, err := os.ReadFile("../../.goreleaser.yaml")
	if err != nil {
		t.Fatal(err)
	}
	want := `{{ envOrDefault "POSTHOG_PROJECT_KEY" "` + key + `" }}`
	if !strings.Contains(string(config), "internal/telemetry.ProjectKey="+want) {
		t.Errorf(".goreleaser.yaml does not set ProjectKey to %s", want)
	}
	if telemetry.ProjectKey != telemetry.NoKey {
		t.Errorf("ProjectKey = %q without ldflags, want %q so development builds send nothing", telemetry.ProjectKey, telemetry.NoKey)
	}
}

func TestAReleaseBuildWithTheKeyOnlySendsFromARelease(t *testing.T) {
	s := enabled(t)
	s.opts.Key = "phc_zY6Yg8ePwEfXC8FadEqkCcoCgzzy2u2VHjpaPTooBDfg"
	s.send(install)
	if got := len(s.net.Events()); got != 1 {
		t.Fatalf("a release build sent %d events, want 1", got)
	}
	s.opts.Version = "dev"
	s.send(install)
	if got := len(s.net.Events()); got != 1 {
		t.Fatalf("a development build sent with the key set: %d events", got)
	}
}

func frames(t *testing.T, item map[string]any) []map[string]any {
	t.Helper()
	trace, ok := item["stacktrace"].(map[string]any)
	if !ok {
		t.Fatalf("no stacktrace on %v", item)
	}
	var out []map[string]any
	for _, f := range trace["frames"].([]any) {
		out = append(out, f.(map[string]any))
	}
	return out
}

func exceptionItem(t *testing.T, s *setup) map[string]any {
	t.Helper()
	for _, e := range s.net.Events() {
		if e["event"] == "$exception" {
			return e["properties"].(map[string]any)["$exception_list"].([]any)[0].(map[string]any)
		}
	}
	t.Fatalf("no $exception in %v", s.net.Events())
	return nil
}

func TestAnExceptionCarriesInAppFramesWithModuleRelativePaths(t *testing.T) {
	s := enabled(t)
	s.send(telemetry.Report{Command: "setup", Outcome: telemetry.OutcomeFailed, Failure: errors.New("x"), Stack: telemetry.CaptureStack(0)})
	got := frames(t, exceptionItem(t, s))
	if len(got) == 0 {
		t.Fatal("no frames")
	}
	for _, f := range got {
		if f["in_app"] != true {
			t.Errorf("frame %v is not in-app: only the program's own frames are sent", f)
		}
		file := f["filename"].(string)
		if !regexp.MustCompile(`^[a-z0-9_-]+(/[a-z0-9_-]+)*/[a-z0-9_]+\.go$`).MatchString(file) {
			t.Errorf("filename %q is not a module-relative path", file)
		}
		if f["lineno"].(float64) <= 0 {
			t.Errorf("frame %v has no line", f)
		}
		if strings.Contains(f["function"].(string), "github.com") {
			t.Errorf("function %q is not module-relative", f["function"])
		}
	}
	last := got[len(got)-1]
	if last["filename"] != "internal/telemetry/telemetry_test.go" || last["function"] != "internal/telemetry_test.TestAnExceptionCarriesInAppFramesWithModuleRelativePaths" {
		t.Errorf("capture-site frame = %v, want the test itself, last", last)
	}
}

func TestAnExceptionWithoutAStackStillCarriesInAppFrames(t *testing.T) {
	s := enabled(t)
	s.send(telemetry.Report{Command: "setup", Outcome: telemetry.OutcomeFailed, Failure: errors.New("x")})
	if got := frames(t, exceptionItem(t, s)); len(got) == 0 {
		t.Fatal("no frames")
	}
}

func TestAPanicIsAnUnhandledExceptionWithTheTypeAndNoValue(t *testing.T) {
	s := enabled(t)
	s.send(telemetry.Report{
		Command: "install", Outcome: telemetry.OutcomeFailed,
		Panic: "disk /home/alice is full: hunter2-s3cret", Stack: telemetry.CaptureStack(0),
	})
	events := s.net.Events()
	if len(events) != 2 || events[1]["event"] != "$exception" {
		t.Fatalf("events = %v, want command then $exception", events)
	}
	props := events[1]["properties"].(map[string]any)
	item := props["$exception_list"].([]any)[0].(map[string]any)
	if item["type"] != "string" || item["value"] != "panic" {
		t.Errorf("exception = %v, want type string and value panic", item)
	}
	if handled := item["mechanism"].(map[string]any)["handled"]; handled != false {
		t.Errorf("handled = %v, want false", handled)
	}
	want := "install|panic:string|internal/telemetry_test.TestAPanicIsAnUnhandledExceptionWithTheTypeAndNoValue"
	if props["$exception_fingerprint"] != want {
		t.Errorf("fingerprint = %v, want %s", props["$exception_fingerprint"], want)
	}
	if strings.Contains(strings.Join(s.net.Bodies(), "\n"), "hunter2-s3cret") {
		t.Error("the panic value was sent")
	}
	payload, err := json.Marshal(events[1])
	if err != nil {
		t.Fatal(err)
	}
	t.Log(string(payload))
}

func TestACommandEventCarriesItsStepsWithIDOutcomeAndDuration(t *testing.T) {
	s := enabled(t)
	s.send(telemetry.Report{Command: "install", Outcome: telemetry.OutcomeOK, Steps: []telemetry.Step{
		{ID: "jellyfin/pull", Outcome: telemetry.StepOK, Duration: 12500 * time.Millisecond},
		{ID: "sonarr/api-key", Outcome: telemetry.StepFailed, Duration: 340 * time.Millisecond},
		{ID: "pull", Outcome: telemetry.StepSkipped},
		{ID: "/srv/media", Outcome: telemetry.StepOK},
		{ID: "jellyfin/ready", Outcome: "alice-laptop"},
	}})
	props := s.net.Events()[0]["properties"].(map[string]any)
	want := []any{
		map[string]any{"id": "jellyfin/pull", "outcome": "ok", "duration_ms": float64(12500)},
		map[string]any{"id": "sonarr/api-key", "outcome": "failed", "duration_ms": float64(340)},
		map[string]any{"id": "pull", "outcome": "skipped", "duration_ms": float64(0)},
	}
	if !reflect.DeepEqual(props["steps"], want) {
		t.Errorf("steps = %v, want %v", props["steps"], want)
	}
}

func TestACommandWithoutStepsCarriesNoStepsKey(t *testing.T) {
	s := enabled(t)
	s.send(install)
	if _, found := s.net.Events()[0]["properties"].(map[string]any)["steps"]; found {
		t.Error("a command without steps carries a steps key")
	}
}

func TestWarningAndErrorStepsAreSentAsOTLPLogsThroughTheProxy(t *testing.T) {
	s := enabled(t)
	s.send(telemetry.Report{Command: "install", Outcome: telemetry.OutcomeIncomplete, Failure: errors.New("x"), Steps: []telemetry.Step{
		{ID: "jellyfin/pull", Outcome: telemetry.StepOK},
		{ID: "sonarr/api-key", Outcome: telemetry.StepFailed},
		{ID: "unencrypted", Outcome: telemetry.StepWarned},
		{ID: "/srv/media", Outcome: telemetry.StepFailed},
	}})
	requests := s.net.LogRequests()
	if len(requests) != 1 {
		t.Fatalf("got %d log requests, want 1", len(requests))
	}
	r := requests[0]
	if r.URL != "https://hog.ajnart.dev/i/v1/logs" {
		t.Errorf("URL = %s, want the proxy's /i/v1/logs", r.URL)
	}
	if got := r.Header.Get("Authorization"); got != "Bearer phc_test" {
		t.Errorf("Authorization = %q, want the project key as a bearer token", got)
	}
	if got := r.Header.Get("Content-Type"); got != "application/json" {
		t.Errorf("Content-Type = %q", got)
	}
	saved, _ := s.config.ReadConfigFile("telemetry-id")
	id := strings.TrimSpace(string(saved))
	want := []map[string]any{
		{"severityText": "ERROR", "body": "step failed", "step": "sonarr/api-key", "posthogDistinctId": id, "command": "install", "version": "1.2.3", "os": "linux", "arch": "amd64"},
		{"severityText": "WARN", "body": "step warned", "step": "unencrypted", "posthogDistinctId": id, "command": "install", "version": "1.2.3", "os": "linux", "arch": "amd64"},
	}
	if got := s.net.LogRecords(); !reflect.DeepEqual(got, want) {
		t.Errorf("log records = %v, want %v", got, want)
	}
}

func TestNoLogsAreSentWithoutAWarningOrAnError(t *testing.T) {
	s := enabled(t)
	s.send(telemetry.Report{Command: "install", Outcome: telemetry.OutcomeOK, Steps: []telemetry.Step{{ID: "pull", Outcome: telemetry.StepOK}}})
	if got := len(s.net.LogRequests()); got != 0 {
		t.Fatalf("got %d log requests, want 0", got)
	}
}

func TestNoPathHostNameInputOrSecretIsEverSent(t *testing.T) {
	_, thisFile, _, _ := runtime.Caller(0)
	absolute := filepath.Dir(thisFile)
	seeded := []string{
		"/home/alice/.self-host/secrets.env",
		"/srv/media",
		"nas.example.com",
		"alice-laptop",
		"192.168.1.20",
		"hunter2-s3cret",
		"JELLYFIN_API_KEY=abc123",
		absolute,
		filepath.Dir(filepath.Dir(absolute)),
	}
	if host, err := os.Hostname(); err == nil && len(host) >= 6 {
		seeded = append(seeded, host)
	}
	failure := fmt.Errorf("read %s on alice-laptop (192.168.1.20): password hunter2-s3cret, JELLYFIN_API_KEY=abc123: %w",
		seeded[0], &fs.PathError{Op: "open", Path: seeded[1], Err: errors.New(seeded[2])})
	reports := map[string]telemetry.Report{
		"failure": {Failure: failure, Outcome: telemetry.OutcomeFailed},
		"panic":   {Panic: failure, Outcome: telemetry.OutcomeFailed},
	}
	for name, r := range reports {
		t.Run(name, func(t *testing.T) {
			s := enabled(t)
			r.Command = "install /srv/media"
			r.Duration = time.Second
			r.Stack = telemetry.CaptureStack(0)
			r.Apps = []string{"jellyfin", "/srv/media", "nas.example.com/x", "hunter2-s3cret/leak"}
			r.Recipes = []string{"media", "alice laptop"}
			r.Access = "nas.example.com"
			r.FailedSteps = []string{"jellyfin/api-key", "/home/alice/.self-host/secrets.env", "JELLYFIN_API_KEY=abc123"}
			r.Steps = []telemetry.Step{
				{ID: "jellyfin/api-key", Outcome: telemetry.StepFailed},
				{ID: "/home/alice/.self-host/secrets.env", Outcome: telemetry.StepFailed},
				{ID: "JELLYFIN_API_KEY=abc123", Outcome: telemetry.StepWarned},
			}
			s.send(r)
			bodies := s.net.Bodies()
			if len(bodies) < 2 {
				t.Fatalf("captured %d payloads, want events and logs", len(bodies))
			}
			if len(s.net.LogRequests()) != 1 || len(frames(t, exceptionItem(t, s))) == 0 {
				t.Fatal("the payloads carry no log record or no stack frames, so the test proves nothing")
			}
			for _, body := range bodies {
				for _, value := range seeded {
					if strings.Contains(body, value) {
						t.Errorf("payload carries %q:\n%s", value, body)
					}
				}
			}
			props := s.net.Events()[0]["properties"].(map[string]any)
			if props["apps"].([]any)[0] != "jellyfin" || len(props["apps"].([]any)) != 1 {
				t.Errorf("apps = %v, want only the clean ID", props["apps"])
			}
		})
	}
}

func TestFeedbackIsOneAnonymousFeedbackEventAndNothingElse(t *testing.T) {
	s := enabled(t)

	sent := telemetry.New(s.opts).SendFeedback(telemetry.Feedback{Message: "Pull failed.", App: "one", Summary: "State: missing"})

	events := s.net.Events()
	if !sent || len(events) != 1 || events[0]["event"] != "feedback" {
		t.Fatalf("sent=%v events=%v, want one feedback event", sent, events)
	}
	props := events[0]["properties"].(map[string]any)
	want := map[string]any{
		"$geoip_disable": true,
		"message":        "Pull failed.",
		"app":            "one",
		"summary":        "State: missing",
		"version":        "1.2.3",
		"os":             "linux",
		"arch":           "amd64",
	}
	for key, value := range want {
		if props[key] != value {
			t.Errorf("properties[%q] = %v, want %v", key, props[key], value)
		}
	}
}

func TestFeedbackDropsAnAppThatIsNotACatalogID(t *testing.T) {
	s := enabled(t)

	telemetry.New(s.opts).SendFeedback(telemetry.Feedback{Message: "x", App: "/Users/ada/my app"})

	if props := s.net.Events()[0]["properties"].(map[string]any); props["app"] != nil {
		t.Errorf("app = %v, want none", props["app"])
	}
}

func TestFeedbackObeysTheOffSwitchesButNotTheNoticeMarker(t *testing.T) {
	s := enabled(t)
	s.store.Remove("telemetry-notice")
	if !telemetry.New(s.opts).SendFeedback(telemetry.Feedback{Message: "x"}) {
		t.Fatal("feedback waited for the notice")
	}
	for _, off := range []func(){
		func() { s.env["SELF_HOST_NO_TELEMETRY"] = "1" },
		func() { s.env["SELF_HOST_NO_TELEMETRY"], s.env["DO_NOT_TRACK"] = "", "1" },
		func() { s.env["DO_NOT_TRACK"], s.env["CI"] = "", "true" },
		func() { s.env["CI"], s.opts.Version = "", "dev" },
	} {
		off()
		before := len(s.net.Bodies())
		if telemetry.New(s.opts).SendFeedback(telemetry.Feedback{Message: "x"}) || len(s.net.Bodies()) != before {
			t.Fatalf("feedback sent while off: %v", s.env)
		}
	}
}

func TestFeedbackReportsFailureWhenPostHogDoesNotAnswerInTime(t *testing.T) {
	s := enabled(t)
	hold := make(chan struct{})
	defer close(hold)
	s.net.Hold = hold
	s.opts.Deadline = 100 * time.Millisecond

	if telemetry.New(s.opts).SendFeedback(telemetry.Feedback{Message: "x"}) {
		t.Fatal("reported success without an answer")
	}
}

func TestApprovedFeedbackWaitsLongerThanTheUsageDeadline(t *testing.T) {
	s := enabled(t)
	s.opts.Deadline = 0
	hold := make(chan struct{})
	s.net.Hold = hold
	timer := time.AfterFunc(750*time.Millisecond, func() { close(hold) })
	defer timer.Stop()
	if !telemetry.New(s.opts).SendFeedback(telemetry.Feedback{Message: "Pull failed."}) {
		t.Fatal("approved feedback was dropped at the short usage deadline")
	}
}

var approvedOnboarding = telemetry.Onboarding{Experience: "advanced", Glyphs: "nerd-font", Doctor: "warn", IntroSkipped: true, Duration: 93500 * time.Millisecond}

func TestOnboardingIsOneEventWithTheExperiencePersonProperty(t *testing.T) {
	s := enabled(t)
	telemetry.New(s.opts).SendOnboarding(approvedOnboarding)
	events := s.net.Events()
	if len(events) != 1 || events[0]["event"] != "onboarding" {
		t.Fatalf("events = %v, want one onboarding event", events)
	}
	props := events[0]["properties"].(map[string]any)
	want := map[string]any{
		"experience":     "advanced",
		"glyphs":         "nerd-font",
		"intro_skipped":  true,
		"doctor":         "warn",
		"duration_ms":    float64(93500),
		"version":        "1.2.3",
		"os":             "linux",
		"arch":           "amd64",
		"$geoip_disable": true,
	}
	for key, value := range want {
		if props[key] != value {
			t.Errorf("properties[%q] = %v, want %v", key, props[key], value)
		}
	}
	set, _ := props["$set"].(map[string]any)
	if len(set) != 1 || set["experience"] != "advanced" {
		t.Errorf("$set = %v, want only experience=advanced", props["$set"])
	}
}

func TestOnboardingValuesOutsideTheFixedSetsAreNotSent(t *testing.T) {
	s := enabled(t)
	telemetry.New(s.opts).SendOnboarding(telemetry.Onboarding{Experience: "/home/alice", Glyphs: "alice-laptop", Doctor: "fail"})
	props := s.net.Events()[0]["properties"].(map[string]any)
	if _, found := props["experience"]; found {
		t.Errorf("experience = %v, want it dropped", props["experience"])
	}
	if _, found := props["$set"]; found {
		t.Errorf("$set = %v, want it dropped", props["$set"])
	}
	if props["glyphs"] != "unknown" || props["doctor"] != "unknown" {
		t.Errorf("glyphs = %v, doctor = %v, want unknown", props["glyphs"], props["doctor"])
	}
}

func TestOnboardingObeysTheOffSwitchesAndWaitsForTheNotice(t *testing.T) {
	for name, tweak := range map[string]func(s *setup){
		"SELF_HOST_NO_TELEMETRY": func(s *setup) { s.env["SELF_HOST_NO_TELEMETRY"] = "1" },
		"DO_NOT_TRACK":           func(s *setup) { s.env["DO_NOT_TRACK"] = "1" },
		"CI":                     func(s *setup) { s.env["CI"] = "true" },
		"development build":      func(s *setup) { s.opts.Version = "dev" },
		"no notice yet":          func(s *setup) { s.store.Remove("telemetry-notice") },
	} {
		t.Run(name, func(t *testing.T) {
			s := enabled(t)
			tweak(s)
			telemetry.New(s.opts).SendOnboarding(approvedOnboarding)
			if got := len(s.net.Bodies()); got != 0 {
				t.Fatalf("sent %d requests, want 0", got)
			}
		})
	}
}

func TestACommandThatSetsTheExperienceSetsThePersonProperty(t *testing.T) {
	s := enabled(t)
	s.send(telemetry.Report{Command: "profile set experience", Outcome: telemetry.OutcomeOK, Experience: "new"})
	props := s.net.Events()[0]["properties"].(map[string]any)
	set, _ := props["$set"].(map[string]any)
	if len(set) != 1 || set["experience"] != "new" {
		t.Fatalf("$set = %v, want only experience=new", props["$set"])
	}
	s.send(install)
	if _, found := s.net.Events()[1]["properties"].(map[string]any)["$set"]; found {
		t.Fatal("a command that sets no Experience level carries $set")
	}
}
