package tui

import (
	"strings"
	"testing"
)

func TestDebugWizard2(t *testing.T) {
	m, _ := freshHost(t)
	steps := []string{"enter", "enter", "down", "down", "down", "x", "enter", "enter", "enter", "enter", "enter", "enter"}
	for i, k := range steps {
		m = drive(t, m, press(k))
		lines := strings.Split(screen(m), "\n")
		focus := ""
		for _, l := range lines {
			if strings.Contains(l, "┃") {
				focus = strings.TrimSpace(l)
				break
			}
		}
		t.Logf("%d %s stage=%d focus=%q", i, k, m.wizard.stage, focus)
	}
}
