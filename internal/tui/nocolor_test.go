package tui

import (
	"regexp"
	"strings"
	"testing"
)

var colourSequence = regexp.MustCompile(`\x1b\[[0-9;]*[34]8;`)

func TestNoColorRemovesColourFromTheDashboardAndOnboardingButKeepsBold(t *testing.T) {
	dashboard, _ := sample(t, 120, 30)
	onboarding, _ := freshHost(t)
	for name, m := range map[string]Model{"Dashboard": dashboard, "Onboarding": onboarding} {
		if out := m.View().Content; !colourSequence.MatchString(out) {
			t.Fatalf("%s: a coloured terminal should show colour: %q", name, out)
		}
		m.opts.NoColor = true
		out := m.View().Content
		if colourSequence.MatchString(out) {
			t.Errorf("%s: NO_COLOR left a colour sequence: %q", name, out)
		}
		if !strings.Contains(out, "\x1b[1m") {
			t.Errorf("%s: NO_COLOR should keep bold: %q", name, out)
		}
		if got, want := screen(m), screen(withoutNoColor(m)); got != want {
			t.Errorf("%s: NO_COLOR changed the text\n%s\nwant\n%s", name, got, want)
		}
	}
}

func withoutNoColor(m Model) Model {
	m.opts.NoColor = false
	return m
}
