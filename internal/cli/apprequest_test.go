package cli_test

import (
	"strings"
	"testing"

	"github.com/ajnart/self-host/internal/clitest"
	"github.com/ajnart/self-host/internal/system"
	"github.com/ajnart/self-host/internal/systemtest"
	"github.com/ajnart/self-host/internal/telemetry/telemetrytest"
)

func appRequests(net *telemetrytest.Transport) []map[string]any {
	var out []map[string]any
	for _, e := range net.Events() {
		if e["event"] == "app_requested" {
			out = append(out, e["properties"].(map[string]any))
		}
	}
	return out
}

func TestAnAppRequestSendsOneAnonymousEventWithTheNormalisedNameAndHost(t *testing.T) {
	deps, net := telemetryDeps(t)
	cat := testCatalog(&echoApp{id: "one", done: map[string]bool{}})

	r := clitest.Run(t, deps, cat, "apps", "request", "  Immich ", "--url", "https://Immich.app/docs?user=alice")

	if r.Code != 0 || !strings.Contains(r.Out, `Noted: "Immich" was requested`) {
		t.Fatalf("exit %d\n%s", r.Code, r.Out)
	}
	requests := appRequests(net)
	if len(requests) != 1 || len(net.Events()) != 1 {
		t.Fatalf("events = %v, want only one app_requested", net.Events())
	}
	for key, want := range map[string]any{"name": "immich", "url_host": "immich.app", "$process_person_profile": false} {
		if requests[0][key] != want {
			t.Errorf("properties[%q] = %v, want %v", key, requests[0][key], want)
		}
	}
	if body := strings.Join(net.Bodies(), "\n"); strings.Contains(body, "alice") || strings.Contains(body, "/docs") {
		t.Errorf("the URL's path or query was sent: %s", body)
	}
}

func TestAnAppRequestShowsTheIssueLinkOnlyToAPerson(t *testing.T) {
	cat := testCatalog(&echoApp{id: "one", done: map[string]bool{}})
	for _, interactive := range []bool{false, true} {
		deps, _ := telemetryDeps(t)
		deps.Interactive = interactive
		r := clitest.Run(t, deps, cat, "apps", "request", "immich")
		if got := strings.Contains(r.Out, "https://github.com/ajnart/self-host/issues"); got != interactive {
			t.Errorf("interactive=%v: issue link shown = %v\n%s", interactive, got, r.Out)
		}
	}
}

func TestAnAppRequestRejectsABadNameOrURLAndSendsNoRequest(t *testing.T) {
	cat := testCatalog(&echoApp{id: "one", done: map[string]bool{}})
	cases := [][]string{
		{"/home/alice/app"},
		{"my@mail.com"},
		{strings.Repeat("a", 65)},
		{" "},
		{"immich", "--url", "ftp://immich.app"},
		{"immich", "--url", "https://192.168.1.20/x"},
		{"immich", "--url", "https://localhost"},
	}
	for _, args := range cases {
		deps, net := telemetryDeps(t)
		clitest.Run(t, deps, cat, "apps", "list")
		r := clitest.Run(t, deps, cat, append([]string{"apps", "request"}, args...)...)
		if r.Code == 0 {
			t.Errorf("%q succeeded:\n%s", args, r.Out)
		}
		if got := len(appRequests(net)); got != 0 {
			t.Errorf("%q sent %d app_requested events", args, got)
		}
		body := strings.Join(net.Bodies(), "\n")
		for _, leak := range []string{"alice", "my@mail.com", "192.168.1.20", "localhost"} {
			if strings.Contains(body, leak) {
				t.Errorf("%q: payload carries %q", args, leak)
			}
		}
	}
}

func TestAnAppRequestForACatalogAppSaysSoAndSendsNothing(t *testing.T) {
	cat := testCatalog(&echoApp{id: "one", done: map[string]bool{}})
	for _, name := range []string{"one", "ONE", "Echo One", "echo one"} {
		deps, net := telemetryDeps(t)
		r := clitest.Run(t, deps, cat, "apps", "request", name)
		if r.Code != 0 || !strings.Contains(r.Out, "one is already in the Catalog. Install it with: self-host install one") {
			t.Errorf("%q: exit %d\n%s", name, r.Code, r.Out)
		}
		if got := len(net.Bodies()); got != 0 {
			t.Errorf("%q sent %d requests for a Catalog App", name, got)
		}
	}
}

func TestAnAppRequestHonoursTheOffSwitchesAndExitsZero(t *testing.T) {
	cases := map[string]func(deps *system.Deps){
		"SELF_HOST_NO_TELEMETRY": func(d *system.Deps) { systemtest.SetEnv(d, map[string]string{"SELF_HOST_NO_TELEMETRY": "1"}) },
		"DO_NOT_TRACK":           func(d *system.Deps) { systemtest.SetEnv(d, map[string]string{"DO_NOT_TRACK": "1"}) },
		"CI":                     func(d *system.Deps) { systemtest.SetEnv(d, map[string]string{"CI": "true"}) },
		"development build":      func(d *system.Deps) { d.Version = "dev" },
	}
	for name, tweak := range cases {
		t.Run(name, func(t *testing.T) {
			deps, net := telemetryDeps(t)
			tweak(deps)
			r := clitest.Run(t, deps, testCatalog(&echoApp{id: "one", done: map[string]bool{}}), "apps", "request", "immich")
			if r.Code != 0 || !strings.Contains(r.Out, "Telemetry is off here, so nothing was sent.") {
				t.Fatalf("exit %d\n%s", r.Code, r.Out)
			}
			if got := len(net.Bodies()); got != 0 {
				t.Fatalf("sent %d requests while off", got)
			}
		})
	}
}

func TestAnInitialJSONAppRequestShowsTheNoticeThenSends(t *testing.T) {
	deps, net := telemetryDeps(t)
	cat := testCatalog(&echoApp{id: "one", done: map[string]bool{}})

	r := clitest.Run(t, deps, cat, "apps", "request", "immich", "--json")

	if r.Code != 0 || len(net.Events()) != 1 || !strings.Contains(r.Out, noticeSentence) {
		t.Fatalf("exit %d, sent %v\n%s", r.Code, net.Bodies(), r.Out)
	}
}

func TestASuccessfulAppRequestCommandSendsNoCommandEvent(t *testing.T) {
	deps, net := telemetryDeps(t)
	clitest.Run(t, deps, testCatalog(&echoApp{id: "one", done: map[string]bool{}}), "apps", "request", "immich")
	for _, e := range net.Events() {
		if e["event"] != "app_requested" {
			t.Errorf("sent %v, want only app_requested", e["event"])
		}
	}
}
