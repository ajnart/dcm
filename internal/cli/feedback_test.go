package cli_test

import (
	"strings"
	"testing"

	"github.com/ajnart/self-host/internal/project"
	stepstatus "github.com/ajnart/self-host/internal/status"
	"github.com/ajnart/self-host/internal/system"
	"github.com/ajnart/self-host/internal/systemtest"
	"github.com/ajnart/self-host/internal/telemetry"
	"github.com/ajnart/self-host/internal/telemetry/telemetrytest"
)

func feedbackEvents(net *telemetrytest.Transport) []map[string]any {
	var out []map[string]any
	for _, e := range net.Events() {
		if e["event"] == "feedback" {
			out = append(out, e)
		}
	}
	return out
}

func feedbackSetup(t *testing.T) (*system.Deps, *telemetrytest.Transport, func(args ...string) (int, string)) {
	t.Helper()
	deps, net := telemetryDeps(t)
	cat := testCatalog(&echoApp{id: "one", done: map[string]bool{}})
	run := func(args ...string) (int, string) { return runWith(t, deps, cat, args...) }
	if code, out := run("install", "one", "--yes"); code != 0 {
		t.Fatalf("install: %d\n%s", code, out)
	}
	return deps, net, run
}

func seedSecret(t *testing.T, deps *system.Deps, hint string) {
	t.Helper()
	owner, _ := deps.CurrentUser()
	p := project.Open(owner)
	if err := p.SaveSecrets(map[string]string{"ADMIN_USER": "admin", "ADMIN_PASSWORD": "synthetic-password"}); err != nil {
		t.Fatal(err)
	}
	state, err := p.LoadState()
	if err != nil {
		t.Fatal(err)
	}
	state.Apps["one"].Steps["configure"] = project.StepRecord{Status: stepstatus.StepFail, Msg: "configure echo", Error: "refused", Hint: hint}
	if err := p.SaveState(state); err != nil {
		t.Fatal(err)
	}
}

func asTerminal(deps *system.Deps, answer string) {
	deps.Interactive = true
	deps.In = strings.NewReader(answer)
}

func TestFeedbackSendsOneFeedbackEventWithTheInstallsOwnIDAndEndpoint(t *testing.T) {
	deps, net, run := feedbackSetup(t)
	seedSecret(t, deps, "Open the echo settings page and enable greetings.")

	code, out := run("feedback", "--message", "Install of one stopped at the configure step.", "--app", "one", "--yes")

	if code != 0 {
		t.Fatalf("feedback: exit %d\n%s", code, out)
	}
	events := feedbackEvents(net)
	if len(events) != 1 {
		t.Fatalf("got %d feedback events, want 1: %v", len(events), net.Events())
	}
	want := map[string]any{
		"$geoip_disable": true,
		"message":        "Install of one stopped at the configure step.",
		"app":            "one",
		"summary":        "State: missing\nSetup: ok\nFailed step: configure (fail): Open the echo settings page and enable greetings.",
		"version":        "1.2.3",
		"os":             "linux",
		"arch":           "amd64",
	}
	props := events[0]["properties"].(map[string]any)
	if _, found := props["$process_person_profile"]; found {
		t.Error("feedback disables person profiles")
	}
	for key := range props {
		if strings.HasPrefix(key, "$") {
			continue
		}
		if _, ok := want[key]; !ok {
			t.Errorf("unexpected property %q = %v", key, props[key])
		}
	}
	for key, value := range want {
		if props[key] != value {
			t.Errorf("properties[%q] = %q, want %q", key, props[key], value)
		}
	}
	var commandID any
	for _, e := range net.Events() {
		if e["event"] == "command" {
			commandID = e["distinct_id"]
		}
	}
	if events[0]["distinct_id"] != commandID || commandID == nil {
		t.Errorf("feedback ID %v differs from the command events' ID %v", events[0]["distinct_id"], commandID)
	}
	if got := strings.Join(net.URLs(), ","); !strings.HasPrefix(got, "https://hog.ajnart.dev/") {
		t.Errorf("sent to %s, want https://hog.ajnart.dev/", got)
	}
	if !strings.Contains(out, "Sent. Thank you.") {
		t.Errorf("no confirmation:\n%s", out)
	}
}

func TestFeedbackMasksKnownSecretsBeforeShowingAndBeforeSending(t *testing.T) {
	deps, net, run := feedbackSetup(t)
	seedSecret(t, deps, "retry synthetic-password")

	code, out := run("feedback", "--message", "Login failed with synthetic-password after install.", "--app", "one", "--yes")

	if code != 0 {
		t.Fatalf("feedback: exit %d\n%s", code, out)
	}
	if strings.Contains(out, "synthetic-password") {
		t.Errorf("the shown text leaks the secret:\n%s", out)
	}
	for _, want := range []string{"  Login failed with [redacted] after install.", "Failed step: configure (fail): retry [redacted]"} {
		if !strings.Contains(out, want) {
			t.Errorf("shown text lacks %q:\n%s", want, out)
		}
	}
	for _, body := range net.Bodies() {
		if strings.Contains(body, "synthetic-password") {
			t.Errorf("a request body leaks the secret:\n%s", body)
		}
	}
	props := feedbackEvents(net)[0]["properties"].(map[string]any)
	if props["message"] != "Login failed with [redacted] after install." {
		t.Errorf("sent message = %q", props["message"])
	}
}

func TestFeedbackNeverSendsTheLogs(t *testing.T) {
	deps, net, run := feedbackSetup(t)
	seedSecret(t, deps, "hint")
	deps.Runner.(*systemtest.Runner).OnFunc("docker compose --project-directory", func(cmd system.Cmd) system.Result {
		return system.Result{Stdout: []byte("one-1  | unmistakable log line\n")}
	})

	code, out := run("feedback", "--message", "broke", "--app", "one", "--yes")

	if code != 0 || strings.Contains(out, "unmistakable") {
		t.Fatalf("exit %d, shown text carries logs:\n%s", code, out)
	}
	for _, body := range net.Bodies() {
		if strings.Contains(body, "unmistakable") {
			t.Errorf("a request body carries logs:\n%s", body)
		}
	}
}

func TestFeedbackOnATerminalAsksAndSendsOnYes(t *testing.T) {
	deps, net, run := feedbackSetup(t)
	asTerminal(deps, "y\n")

	code, out := run("feedback", "--message", "Pull failed twice.")

	want := `This is exactly what will be sent:

Message
  Pull failed twice.

It also carries the anonymous install ID, the version, the operating system and the architecture.

Send this to the self-host maintainers? y/n Sent. Thank you.
`
	if code != 0 || out != want {
		t.Fatalf("exit %d\ngot:\n%s\nwant:\n%s", code, out, want)
	}
	if got := len(feedbackEvents(net)); got != 1 {
		t.Fatalf("got %d feedback events, want 1", got)
	}
}

func TestFeedbackOnATerminalSendsNothingOnNo(t *testing.T) {
	for _, answer := range []string{"n\n", "\n", ""} {
		deps, net, run := feedbackSetup(t)
		asTerminal(deps, answer)

		code, out := run("feedback", "--message", "Pull failed twice.")

		if code != 0 || !strings.Contains(out, "Send this to the self-host maintainers? y/n ") || !strings.HasSuffix(out, "Nothing was sent.\n") {
			t.Errorf("answer %q: exit %d\n%s", answer, code, out)
		}
		if got := len(feedbackEvents(net)); got != 0 {
			t.Errorf("answer %q: sent %d feedback events", answer, got)
		}
	}
}

func TestFeedbackWithoutATerminalAndWithoutYesRefuses(t *testing.T) {
	_, net, run := feedbackSetup(t)

	code, out := run("feedback", "--message", "Pull failed twice.")

	if code != 1 || !strings.Contains(out, "nothing was sent: there is no terminal to ask the person on. After they agree, run again with --yes") {
		t.Fatalf("exit %d\n%s", code, out)
	}
	if strings.Contains(out, "Pull failed twice.") || len(feedbackEvents(net)) != 0 {
		t.Errorf("refusal showed or sent the message:\n%s", out)
	}
}

func TestFeedbackReadsTheMessageFromStdin(t *testing.T) {
	deps, net, run := feedbackSetup(t)
	deps.In = strings.NewReader("The pull step hung.\nTried: rerun setup.\n")

	code, out := run("feedback", "--yes")

	if code != 0 {
		t.Fatalf("exit %d\n%s", code, out)
	}
	props := feedbackEvents(net)[0]["properties"].(map[string]any)
	if props["message"] != "The pull step hung.\nTried: rerun setup." {
		t.Errorf("message = %q", props["message"])
	}
}

func TestFeedbackWithTelemetryOffSendsNothingAndSaysHowToReportElse(t *testing.T) {
	cases := map[string]map[string]string{
		"SELF_HOST_NO_TELEMETRY": {"SELF_HOST_NO_TELEMETRY": "1"},
		"DO_NOT_TRACK":           {"DO_NOT_TRACK": "1"},
		"CI":                     {"CI": "true"},
	}
	for name, env := range cases {
		t.Run(name, func(t *testing.T) {
			deps, net, run := feedbackSetup(t)
			before := len(net.Bodies())
			systemtest.SetEnv(deps, env)

			code, out := run("feedback", "--message", "Pull failed twice.", "--yes")

			want := "Telemetry is off here, so nothing was sent. To send feedback another way, open an issue: https://github.com/ajnart/selfhost/issues\n"
			if code != 1 || out != want {
				t.Fatalf("exit %d\ngot:\n%s\nwant:\n%s", code, out, want)
			}
			if got := len(net.Bodies()); got != before {
				t.Errorf("sent %d requests while off", got-before)
			}
		})
	}
}

func TestFeedbackMessageIsCappedAtFourKiB(t *testing.T) {
	_, net, run := feedbackSetup(t)

	code, out := run("feedback", "--message", strings.Repeat("a", 4097), "--yes")

	want := "error: the message exceeds the limit of 4096 bytes; nothing was sent. Shorten it and run feedback again\n"
	if code != 1 || out != want {
		t.Fatalf("exit %d\ngot:\n%s\nwant:\n%s", code, out, want)
	}
	if got := len(feedbackEvents(net)); got != 0 {
		t.Errorf("sent %d feedback events over the cap", got)
	}

	code, out = run("feedback", "--message", strings.Repeat("a", 4096), "--yes")
	if code != 0 || len(feedbackEvents(net)) != 1 {
		t.Fatalf("a message of exactly 4096 bytes: exit %d\n%s", code, out)
	}
}

type countedFeedbackReader struct {
	*strings.Reader
	read int
}

func (r *countedFeedbackReader) Read(p []byte) (int, error) {
	n, err := r.Reader.Read(p)
	r.read += n
	return n, err
}

func TestFeedbackStdinStopsAfterTheLimitPlusOneByte(t *testing.T) {
	deps, net, run := feedbackSetup(t)
	in := &countedFeedbackReader{Reader: strings.NewReader(strings.Repeat("a", 65536))}
	deps.In = in
	code, out := run("feedback", "--yes")
	want := "error: the message exceeds the limit of 4096 bytes; nothing was sent. Shorten it and run feedback again\n"
	if code != 1 || out != want || in.read != 4097 || len(feedbackEvents(net)) != 0 {
		t.Fatalf("exit %d, read %d bytes, output %q", code, in.read, out)
	}
	deps.In = strings.NewReader(strings.Repeat("a", telemetry.MaxFeedbackBytes))
	if code, out := run("feedback", "--yes"); code != 0 || len(feedbackEvents(net)) != 1 {
		t.Fatalf("exact limit: exit %d\n%s", code, out)
	}
}

func TestFeedbackNeedsAMessage(t *testing.T) {
	_, net, run := feedbackSetup(t)

	code, out := run("feedback", "--message", "  ", "--yes")

	if code != 1 || out != "error: the message is empty\n" || len(feedbackEvents(net)) != 0 {
		t.Fatalf("exit %d\n%s", code, out)
	}
}

func TestFeedbackSaysSoWhenPostHogDoesNotAnswer(t *testing.T) {
	deps, _, run := feedbackSetup(t)
	hold := make(chan struct{})
	t.Cleanup(func() { close(hold) })
	deps.HTTP.Transport = &telemetrytest.Transport{Hold: hold}

	code, out := run("feedback", "--message", "Pull failed twice.", "--yes")

	if code != 1 || !strings.Contains(out, "could not reach the maintainers, so nothing was sent. You can open an issue instead: https://github.com/ajnart/selfhost/issues") {
		t.Fatalf("exit %d\n%s", code, out)
	}
}
