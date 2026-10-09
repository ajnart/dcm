package tui

import (
	"regexp"
	"strings"
	"testing"

	"github.com/charmbracelet/x/ansi"

	"github.com/ajnart/self-host/internal/events"
	"github.com/ajnart/self-host/internal/host"
	"github.com/ajnart/self-host/internal/service"
	stepstatus "github.com/ajnart/self-host/internal/status"
)

// lineWith returns the first screen line that contains s.
func lineWith(t *testing.T, out, s string) string {
	t.Helper()
	for _, line := range strings.Split(out, "\n") {
		if strings.Contains(line, s) {
			return line
		}
	}
	t.Fatalf("no line contains %q\n%s", s, out)
	return ""
}

// Without colour (NO_COLOR, or the ANSI-stripped screen) every state must
// still read from its glyph alone.
func TestDashboardStatesHaveDistinctGlyphsWithoutColour(t *testing.T) {
	m, backend := sample(t, 120, 30)
	backend.status.Apps = append(backend.status.Apps, service.AppStatus{
		ID: "radarr", Name: "Radarr", Managed: true, URL: "http://192.168.1.20:7878", State: "running", Setup: stepstatus.SetupPending,
	})
	m = update(t, m, statusMsg{status: backend.status})
	out := screen(m)

	for _, tc := range []struct{ app, status, setup string }{
		{"Jellyfin", "● ◇ Jellyfin", "✓"},
		{"Radarr", "◐ ◇ Radarr", "…"},
		{"Sonarr", "✗ ◇ Sonarr", "✗"},
		{"whoami", "✗ ◇ whoami", "–"},
	} {
		line := lineWith(t, out, tc.app+"  ")
		if !strings.Contains(line, tc.status) {
			t.Errorf("Status of %s should read %q without colour: %q", tc.app, tc.status, line)
		}
		row := strings.TrimRight(strings.TrimSuffix(strings.TrimSpace(strings.Split(line, "│")[1]), "│"), " ")
		if !strings.HasSuffix(row, tc.setup) {
			t.Errorf("Setup mark of %s should be %q without colour: %q", tc.app, tc.setup, row)
		}
	}
	for _, want := range []string{"✗ Sonarr: download-client failed", "✗ whoami is stopped", "! Firewall: ufw is active", "◐ 1 warning"} {
		if !strings.Contains(out, want) {
			t.Errorf("dashboard lacks %q without colour\n%s", want, out)
		}
	}

	m = update(t, m, doctorMsg{checks: []host.Check{{ID: "docker", Title: "Docker", Level: host.Fail}}})
	if out := screen(m); !strings.Contains(out, "✗ 1 failing check") {
		t.Errorf("failing health chip should read ✗ without colour\n%s", out)
	}
	m = update(t, m, doctorMsg{checks: []host.Check{{ID: "docker", Title: "Docker", Level: host.OK}}})
	if out := screen(m); !strings.Contains(out, "● healthy") {
		t.Errorf("healthy chip should read ● without colour\n%s", out)
	}
}

func TestWorkflowStepStatesHaveDistinctGlyphsWithoutColour(t *testing.T) {
	ctx := testViewContext(&fakeBackend{})
	ctx.status = workflowStatus()
	ctx.status.Apps[2].Steps = []service.StepStatus{
		{ID: "account", Status: stepstatus.StepManual, Hint: "open the browser"},
		{ID: "ready"},
	}
	task := ctx.tasks.start("setup radarr")
	t.Cleanup(ctx.tasks.cancelAll)
	task.append(events.Event{Event: events.StepStart, App: "radarr", Step: "ready"})
	var v view = &activityView{}
	v, _, _ = v.Update(ctx, press("space"))

	out := ansi.Strip(v.View(ctx, 120, 30))

	for _, want := range []string{"✓ ready", "↷ account", "✗ link-qbittorrent", "○ check", "! manual account", "… ready"} {
		if !strings.Contains(out, want) {
			t.Errorf("Workflow view lacks %q without colour\n%s", want, out)
		}
	}
}

var sgr = regexp.MustCompile(`\x1b\[([0-9;:]*)m`)

// boldText returns, per line, the text drawn in bold, words separated by
// single spaces.
func boldText(raw string) []string {
	var out []string
	for _, line := range strings.Split(raw, "\n") {
		bold := false
		var b strings.Builder
		rest := line
		for rest != "" {
			loc := sgr.FindStringSubmatchIndex(rest)
			text := rest
			if loc != nil {
				text = rest[:loc[0]]
			}
			if bold {
				b.WriteString(ansi.Strip(text))
			} else {
				b.WriteString(" ")
			}
			if loc == nil {
				break
			}
			params := strings.Split(rest[loc[2]:loc[3]], ";")
			for i := 0; i < len(params); i++ {
				switch params[i] {
				case "", "0", "22":
					bold = false
				case "1":
					bold = true
				case "38", "48", "58":
					if i+1 < len(params) && params[i+1] == "2" {
						i += 4
					} else {
						i += 2
					}
				}
			}
			rest = rest[loc[1]:]
		}
		out = append(out, strings.Join(strings.Fields(b.String()), " "))
	}
	return out
}

func TestFocusAndActiveReadByWeight(t *testing.T) {
	m, _ := sample(t, 120, 30)
	m = drive(t, m, press("j"))
	top := 0
	for i, line := range strings.Split(screen(m), "\n") {
		if strings.Contains(line, "╭─ Apps 3") {
			top = i
		}
	}
	bold := boldText(m.View().Content)

	if !strings.Contains(bold[top], "Apps") || strings.Contains(bold[top], "Needs attention") {
		t.Errorf("the focused Apps box should have a bold title and Needs attention not: %q", bold[top])
	}
	if !strings.Contains(bold[top+2], "Sonarr") || strings.Contains(bold[top+1], "Jellyfin") || strings.Contains(bold[top+3], "whoami") {
		t.Errorf("only the selected App row should be bold: %q %q %q", bold[top+1], bold[top+2], bold[top+3])
	}

	m = drive(t, m, press("tab"))
	bold = boldText(m.View().Content)
	if strings.Contains(bold[top], "Apps 3") || !strings.Contains(bold[top], "Needs attention") {
		t.Errorf("tab should move the bold title to Needs attention: %q", bold[top])
	}
}
