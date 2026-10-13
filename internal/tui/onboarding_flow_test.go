package tui

import (
	"strings"
	"testing"

	tea "charm.land/bubbletea/v2"
	"github.com/charmbracelet/x/ansi"

	"github.com/ajnart/self-host/internal/activity"
	"github.com/ajnart/self-host/internal/catalog"
)

func TestWhatEnterShowsOnlySelectedAppPromptsOnEveryMessage(t *testing.T) {
	for _, recipe := range []bool{false, true} {
		t.Run(map[bool]string{false: "App", true: "Recipe"}[recipe], func(t *testing.T) {
			m, backend := freshHost(t)
			backend.catalog = catalog.Default()
			m = drive(t, m, press("enter"))
			if !recipe {
				m = drive(t, m, press("/"))
				m = typeText(t, m, "qbittorrent")
				m = drive(t, m, press("enter"))
			}
			m = drive(t, m, press("space"))
			queue := []tea.Msg{press("enter")}
			for messages := 0; len(queue) > 0; messages++ {
				if messages > 30 {
					t.Fatal("selected App prompt did not settle")
				}
				next, cmd := m.Update(queue[0])
				m, queue = next.(Model), queue[1:]
				out := screen(m)
				for _, forbidden := range []string{"ArchiveTeam Warrior", "Warrior contribution nickname", "required", "Error"} {
					if strings.Contains(out, forbidden) {
						t.Fatalf("message %d shows an irrelevant prompt or transient validation %q\n%s", messages, forbidden, out)
					}
				}
				if !strings.Contains(out, "qBittorrent") || !strings.Contains(out, "Torrent peer port") || !strings.Contains(out, "6881") {
					t.Fatalf("message %d must deliberately show qBittorrent's question\n%s", messages, out)
				}
				queue = append(queue, runCmd(cmd)...)
			}
			m = drive(t, m, press("enter"))
			if m.onboarding.step != stepWhere {
				t.Fatalf("the one selected App question should lead to Where\n%s", screen(m))
			}
		})
	}
}

func TestWhatStartsOnAUsefulRecipeAndKeepsHomarrDeliberatelyOptional(t *testing.T) {
	m, backend := freshHost(t)
	backend.catalog = catalog.Default()
	m = drive(t, m, press("enter"))
	if out := screen(m); !strings.Contains(out, "> ○ ❖ Media (Recipe)") || strings.Contains(out, "Homarr control plane") {
		t.Fatalf("What should focus a useful Recipe, not the preselected Homarr\n%s", out)
	}
	if out := flat(screen(m)); !strings.Contains(out, "✓ all · ◐ some · ○ none of a Recipe's Apps") || !strings.Contains(out, "Homarr is preselected") {
		t.Fatalf("What should explain its Recipe marks and default App\n%s", screen(m))
	}
	m = drive(t, m, press("/"))
	m = typeText(t, m, "homarr")
	m = drive(t, m, press("enter"))
	if out := screen(m); !strings.Contains(out, "> ✓ Homarr") || strings.Contains(out, "Homarr control plane") {
		t.Fatalf("Homarr should be picked only through its App row\n%s", out)
	}
	m = drive(t, m, press("space"))
	m = drive(t, m, press("esc"))
	m = drive(t, m, press("esc"))
	m = drive(t, m, press("enter"))
	m = drive(t, m, press("/"))
	m = typeText(t, m, "homarr")
	m = drive(t, m, press("enter"))
	if out := screen(m); !strings.Contains(out, "> ○ Homarr") {
		t.Fatalf("returning to What must preserve deliberate opt-out\n%s", out)
	}
}

func TestWelcomeFocusAndSelectionAreSeparateAndEnterContinuesTheAnswer(t *testing.T) {
	m, backend := freshHost(t)
	m = drive(t, m, press("down"))
	m = frames(t, m, reactionFrames)
	if out := screen(m); !strings.Contains(out, "● New: this is all new to me") || !strings.Contains(out, "> ○ Advanced: I have run a server or used Docker") {
		t.Fatalf("arrows should focus Advanced while the default answer stays New\n%s", out)
	}
	m = drive(t, m, press("space"))
	m = frames(t, m, reactionFrames)
	if out := screen(m); m.onboarding.step != stepWelcome || !strings.Contains(out, "> ● Advanced: I have run a server or used Docker") || !strings.Contains(out, "○ New: this is all new to me") {
		t.Fatalf("Space should select Advanced without advancing\n%s", out)
	}
	m = drive(t, m, press("up"))
	m = toReview(t, m)
	m = drive(t, m, press("enter"))
	if got := backend.savedExperiences(); len(got) != 1 || got[0] != "advanced" {
		t.Fatalf("Enter should retain the selected answer, saved %v", got)
	}
}

func TestLookSpaceSelectsWithoutAdvancingAndEnterUsesSelectionNotFocus(t *testing.T) {
	m, backend := freshHost(t)
	m = atStep(t, m, "Look")
	m = drive(t, m, press("up"))
	if out := screen(m); !strings.Contains(out, "> ○ Nerd Font: use extra font icons") || !strings.Contains(out, "● Simple (default): use plain symbols") {
		t.Fatalf("the truthful Simple default must stay selected while Nerd Font is focused\n%s", out)
	}
	m = drive(t, m, press("space"))
	if out := screen(m); m.onboarding.step != stepLook || !strings.Contains(out, "> ● Nerd Font: use extra font icons") || !strings.Contains(out, "○ Simple (default): use plain symbols") {
		t.Fatalf("Space should select Nerd Font without advancing\n%s", out)
	}
	m = drive(t, m, press("down"))
	if out := screen(m); !strings.Contains(out, "> ○ Simple (default): use plain symbols") {
		t.Fatalf("focusing the unchosen Simple answer must not select it\n%s", out)
	}
	if len(backend.savedGlyphs()) != 0 || len(backend.Actions()) != 0 {
		t.Fatal("pending Appearance must not be persisted before approval")
	}
	m = drive(t, m, press("enter"))
	if m.onboarding.step != stepReview || m.glyphs != activity.NerdFont {
		t.Fatalf("Enter must continue the selected Appearance, not the focused answer\n%s", screen(m))
	}
	m = drive(t, m, press("esc"))
	if out := screen(m); !strings.Contains(out, "> ● Nerd Font: use extra font icons") {
		t.Fatalf("revisiting Look must retain the chosen Appearance\n%s", out)
	}
}

func TestAccessSpaceKeepsAPendingAnswerAndEnterContinuesIt(t *testing.T) {
	m, backend := freshHost(t)
	m = atAccess(t, m)
	m = drive(t, m, press("down"))
	if out := screen(m); !strings.Contains(out, "● Home network (default)") || !strings.Contains(out, "> ○ Easy names at home") {
		t.Fatalf("Access focus must not change the default answer\n%s", out)
	}
	m = drive(t, m, press("space"))
	if out := screen(m); m.onboarding.step != stepAccess || !strings.Contains(out, "> ● Easy names at home") || !strings.Contains(out, "○ Home network (default)") {
		t.Fatalf("Space should visibly select pending Access without advancing\n%s", out)
	}
	if len(backend.Actions()) != 0 {
		t.Fatal("choosing Access must not apply a Project change")
	}
	m = drive(t, m, press("esc"))
	for range 4 {
		m = drive(t, m, press("enter"))
	}
	if out := screen(m); !strings.Contains(out, "> ● Easy names at home") {
		t.Fatalf("Access must preserve its pending answer when revisited\n%s", out)
	}
	m = drive(t, m, press("up"))
	m = drive(t, m, press("enter"))
	if m.onboarding.step != stepWho || !planFromAnswers(m.backend, m.onboarding.answers).opts.EasyNames {
		t.Fatalf("Enter should continue Easy names, not the focused Home network\n%s", screen(m))
	}
	if len(backend.Actions()) != 0 {
		t.Fatal("continuing Access must still wait for Review approval")
	}
}

func TestWelcomeIsCenteredBelowTheStepIndicator(t *testing.T) {
	for _, size := range []struct{ width, height int }{{80, 24}, {120, 30}, {160, 50}, {60, 24}} {
		for _, welcome := range []bool{true} {
			m, _ := onboardingHost(t, size.width, size.height, readyChecks...)
			m = frames(t, m, introFrames)
			heading := "Welcome to self-host"
			out := screen(m)
			lines := strings.Split(out, "\n")
			if len(lines) != size.height || !strings.Contains(lines[2], "●") || !strings.Contains(out, heading) || !strings.Contains(lines[size.height-1], "enter") {
				t.Fatalf("%dx%d: heading, step indicator and key hints must stay visible\n%s", size.width, size.height, out)
			}
			body := lines[4 : size.height-2]
			if !welcome {
				continue
			}
			top, bottom, left, right := -1, -1, size.width, 0
			for i, line := range body {
				if ansi.StringWidth(line) > size.width {
					t.Fatalf("%dx%d: body exceeds the available width: %q", size.width, size.height, line)
				}
				if strings.TrimSpace(line) == "" {
					continue
				}
				if top < 0 {
					top = i
				}
				bottom = i
				left = min(left, len(line)-len(strings.TrimLeft(line, " ")))
				right = max(right, ansi.StringWidth(strings.TrimRight(line, " ")))
			}
			if gap := top - (len(body) - bottom - 1); gap < -1 || gap > 1 {
				t.Fatalf("%dx%d: %s is not vertically centered, top %d bottom %d\n%s", size.width, size.height, heading, top, len(body)-bottom-1, out)
			}
			if gap := left - (size.width - right); gap < -1 || gap > 1 {
				t.Fatalf("%dx%d: %s is not horizontally centered, left %d right %d\n%s", size.width, size.height, heading, left, size.width-right, out)
			}
		}
	}
}

func TestEnterWithoutSpaceContinuesTheVisibleDefault(t *testing.T) {
	m, _ := freshHost(t)
	m = drive(t, m, press("down"))
	m = atAccess(t, m)
	if m.onboarding.answers.experience != "new" {
		t.Fatal("focusing Advanced must not replace the New default")
	}
	m = drive(t, m, press("down"))
	m = drive(t, m, press("enter"))
	if m.onboarding.step != stepWho || m.onboarding.answers.easyNames {
		t.Fatal("Enter without selection must continue Home network")
	}
	for range 2 {
		m = drive(t, m, press("enter"))
	}
	m = drive(t, m, press("up"))
	m = drive(t, m, press("enter"))
	if m.onboarding.step != stepReview || m.glyphs != activity.Simple {
		t.Fatal("Enter without selection must continue Simple")
	}
}

func TestAccessSelectionRetainsPrivateKeyAndPublicationBoundaries(t *testing.T) {
	for _, choice := range []string{"tailscale", "cloudflare"} {
		m, backend := freshHost(t)
		backend.catalog = withTailscale(backend.Catalog())
		m = atAccess(t, m)
		for range map[string]int{"tailscale": 2, "cloudflare": 3}[choice] {
			m = drive(t, m, press("down"))
		}
		m = drive(t, m, press("space"))
		if m.onboarding.step != stepAccess || m.onboarding.form != nil || len(backend.Actions()) != 0 {
			t.Fatalf("%s: Space must only select the pending answer\n%s", choice, screen(m))
		}
		m = drive(t, m, press("up"))
		m = drive(t, m, press("enter"))
		if choice == "cloudflare" {
			if m.onboarding.step != stepWho || !m.onboarding.answers.cloudflare || !strings.Contains(flat(screen(m)), "nothing goes public yet") {
				t.Fatalf("Cloudflare must defer to a separate publication review\n%s", screen(m))
			}
		} else {
			if m.onboarding.step != stepAccess || m.onboarding.form == nil || !strings.Contains(screen(m), "Tailscale auth key") || strings.Contains(screen(m), "required") {
				t.Fatalf("Tailscale must deliberately ask privately, without a transient error\n%s", screen(m))
			}
			m = drive(t, m, press("enter"))
			if m.onboarding.step != stepAccess || !strings.Contains(screen(m), "required") {
				t.Fatal("Tailscale must not bypass its required private input")
			}
			m = typeText(t, m, "synthetic-key")
			if strings.Contains(screen(m), "synthetic-key") {
				t.Fatal("the private input must remain concealed")
			}
			m = drive(t, m, press("enter"))
			if m.onboarding.step != stepWho {
				t.Fatal("the private input should continue only after an answer")
			}
		}
		if len(backend.Actions()) != 0 {
			t.Fatal("Access must not run anything before Review approval")
		}
	}
}

func TestOnboardingSpaceRemainsTextInAppHostAndAdminInputs(t *testing.T) {
	m, _ := freshHost(t)
	m = drive(t, m, press("enter"))
	for range 2 {
		m = drive(t, m, press("down"))
	}
	m = drive(t, m, press("space"))
	m = drive(t, m, press("enter"))
	m = typeText(t, m, " Library")
	if got := *m.onboarding.answers.inputs["jellyfin.server_name"]; got != "Home Library" {
		t.Fatalf("App text input lost spaces: %q", got)
	}
	m = drive(t, m, press("enter"))
	m = drive(t, m, press("tab"))
	m = drive(t, m, press("space"))
	if got := m.onboarding.answers.tz; got != "Europe/Paris " {
		t.Fatalf("Host text input lost spaces: %q", got)
	}
	cmd := m.onboarding.openStep(m.ctx(), stepWho)
	for _, msg := range runCmd(cmd) {
		m = drive(t, m, msg)
	}
	m = drive(t, m, press("enter"))
	m = typeText(t, m, "synthetic pass phrase")
	if m.onboarding.answers.adminPassword != "synthetic pass phrase" || strings.Contains(screen(m), "synthetic pass phrase") {
		t.Fatal("Admin input must accept spaces and remain concealed")
	}
}

func TestOnboardingSelectionReadsByMarkAndWeightInBothThemes(t *testing.T) {
	for _, dark := range []bool{false, true} {
		for _, stage := range []struct {
			step          step
			focus, chosen string
			keys          []string
		}{
			{stepWelcome, "Advanced: I have run a server or used Docker", "New: this is all new to me", []string{"down"}},
			{stepAccess, "Easy names at home", "Home network (default)", []string{"down"}},
			{stepLook, "Nerd Font: use extra font icons", "Simple (default): use plain symbols", []string{"up"}},
			{stepLook, "Simple (default): use plain symbols", "Nerd Font: use extra font icons", []string{"up", "space", "down"}},
		} {
			m, _ := freshHost(t)
			m.theme = newTheme(dark)
			m.onboarding.openStep(m.ctx(), stage.step)
			for _, key := range stage.keys {
				m = drive(t, m, press(key))
			}
			out := screen(m)
			if !strings.Contains(out, "> ○ "+stage.focus) || !strings.Contains(out, "● "+stage.chosen) {
				t.Fatalf("dark %v: focus and selection must remain distinct without colour\n%s", dark, out)
			}
			bold := strings.Join(boldText(m.View().Content), "\n")
			if strings.Contains(bold, stage.focus) || !strings.Contains(bold, stage.chosen) {
				t.Fatalf("dark %v: only the selected answer label should carry chosen weight\n%s", dark, bold)
			}
		}
	}
}

func TestOnboardingChoiceKeybindAudit(t *testing.T) {
	for _, stage := range []step{stepWelcome, stepAccess, stepLook} {
		m, _ := freshHost(t)
		m.onboarding.openStep(m.ctx(), stage)
		_, bindings := m.onboarding.bar(m.ctx())
		var got []string
		for _, b := range bindings {
			got = append(got, b.Help().Desc+": "+strings.Join(b.Keys(), " "))
		}
		want := "focus: up down|select: space|continue: enter|back: esc"
		switch stage {
		case stepWelcome:
			want = "focus: up down|select: space|continue: enter"
		case stepAccess:
			want += "|more: ?"
		}
		if strings.Join(got, "|") != want {
			t.Fatalf("%s keys = %v, want %s", stepNames[stage], got, want)
		}
		bar := flat(lastLine(screen(m)))
		for _, hint := range []string{"↑/↓ focus", "space select", "enter continue"} {
			if !strings.Contains(bar, hint) {
				t.Fatalf("%s must keep %q visible: %s", stepNames[stage], hint, bar)
			}
		}
	}
}
