package tui

import (
	"testing"

	"github.com/ajnart/self-host/internal/catalog"
)

func TestGoldenOnboardingSelectionAndFocus(t *testing.T) {
	for _, size := range []struct {
		width, height int
		suffix        string
	}{{120, 30, ""}, {80, 24, "-narrow"}} {
		for _, stage := range []struct {
			name string
			step step
			keys []string
		}{
			{"welcome-focus", stepWelcome, []string{"down"}},
			{"welcome-selected", stepWelcome, []string{"down", "space", "up"}},
			{"access-selected", stepAccess, []string{"down", "space", "up"}},
			{"access-local-focus", stepAccess, []string{"down", "down", "down", "down", "down"}},
			{"look-focus", stepLook, []string{"up"}},
			{"look-selected", stepLook, []string{"up", "space", "down"}},
		} {
			t.Run(stage.name+size.suffix, func(t *testing.T) {
				m, _ := freshHost(t)
				m = update(t, m, windowSize(size.width, size.height))
				m.onboarding.openStep(m.ctx(), stage.step)
				for _, key := range stage.keys {
					m = drive(t, m, press(key))
				}
				m = frames(t, m, reactionFrames)
				golden(t, "onboarding-"+stage.name+size.suffix, trimLines(screen(m)))
			})
		}
		t.Run("Catalog"+size.suffix, func(t *testing.T) {
			m, backend := freshHost(t)
			backend.catalog = catalog.Default()
			m = update(t, m, windowSize(size.width, size.height))
			m = drive(t, m, press("enter"))
			golden(t, "onboarding-what-default-focus"+size.suffix, trimLines(screen(m)))
			m = drive(t, m, press("space"))
			m = drive(t, m, press("enter"))
			golden(t, "onboarding-what-selected-input"+size.suffix, trimLines(screen(m)))
		})
	}
}
