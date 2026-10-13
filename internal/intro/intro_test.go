package intro

import (
	"flag"
	"fmt"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"

	"github.com/ajnart/self-host/internal/scene"
	"github.com/charmbracelet/x/ansi"
)

var update = flag.Bool("update", false, "rewrite golden files")

func golden(t *testing.T, name string, lines []string) {
	t.Helper()
	plain := make([]string, len(lines))
	for i, line := range lines {
		plain[i] = strings.TrimRight(ansi.Strip(line), " ")
	}
	got := strings.Join(plain, "\n")
	path := filepath.Join("testdata", name+".golden")
	if *update {
		if err := os.MkdirAll("testdata", 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(path, []byte(got), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	want, err := os.ReadFile(path)
	if err != nil || string(want) != got {
		t.Fatalf("%s changed (go test -update to accept): %v\n%s", name, err, got)
	}
}

var sizes = []struct {
	name string
	w, h int
}{{"120x30", 120, 30}, {"80x24", 80, 24}, {"70x20", 70, 20}}

func checks() []Check {
	return []Check{
		{Title: "Docker", Detail: "docker command found", Level: OK},
		{Title: "Docker daemon", Detail: "engine 27.3.1", Level: OK},
		{Title: "Docker Compose", Detail: "compose 2.29.7", Level: OK},
		{Title: "Container IDs", Detail: "container IDs default to the Project owner's UID/GID", Level: OK},
	}
}

func input(w, h, n int, p Palette) Input {
	return Input{W: w, H: h, Frame: n, Wall: n, Pal: p, Doctor: Doctor{Checks: checks(), TickFrom: TickFromFrame}}
}

func welcome(in Input) Target {
	cv := scene.New(in.W, in.H)
	p := in.Pal
	tg := Target{Title: "Welcome to self-host", TitleAt: Pos{12, 6}, Chrome: []int{0, 2, in.H - 1}}
	if in.W >= 100 && in.H >= 28 {
		tg.Emblem = &Box{12, 4, 76, 4}
		tg.TitleAt.Y = 9
		drawRest(cv, p, ScaleEmblem, 12, 4, [4]Level{OK, OK, OK, OK}, in.NoColor, 1)
	}
	cv.Text(1, 0, "◆ self-host", p.UI.AccentText, 1, true)
	cv.Text(2, 2, "● Welcome › ○ What › ○ Where › ○ Access › ○ Who › ○ Look › ○ Review", p.UI.Text, 0.6, false)
	cv.Text(tg.TitleAt.X, tg.TitleAt.Y, tg.Title, p.UI.AccentText, 1, true)
	cv.Text(12, tg.TitleAt.Y+2, "The Apps you pick, on this machine with Docker Compose.", p.UI.Text, 0.6, false)
	cv.Text(12, tg.TitleAt.Y+4, "> ● New: this is all new to me", p.UI.Bright, 1, true)
	cv.Text(12, tg.TitleAt.Y+5, "  ○ Advanced: I have run a server or used Docker", p.UI.Text, 0.6, false)
	cv.Text(12, tg.TitleAt.Y+7, "Nothing is written until you approve the plan at Review.", p.UI.Bright, 1, true)
	cv.Text(1, in.H-1, "q quit", p.UI.Muted, 0.3, false)
	tg.Lines = cv.Lines(in.NoColor)
	return tg
}

func assertSize(t *testing.T, lines []string, w, h int) {
	t.Helper()
	if len(lines) != h {
		t.Fatalf("got %d rows, want %d", len(lines), h)
	}
	for y, line := range lines {
		if got := ansi.StringWidth(line); got != w {
			t.Fatalf("row %d: %d cells, want %d: %q", y, got, w, line)
		}
	}
}

func TestGoldenIntroAndExit(t *testing.T) {
	for _, size := range sizes {
		for _, theme := range []struct {
			name string
			p    Palette
		}{{"dark", Dark()}, {"light", Light()}} {
			for _, step := range []struct {
				name string
				n    int
			}{{"ignition", 4}, {"mid-drop", 23}, {"snap", 46}, {"half-decoded", 63}, {"settled", SceneFrames}} {
				in := input(size.w, size.h, step.n, theme.p)
				lines := Render(in)
				assertSize(t, lines, size.w, size.h)
				golden(t, step.name+"-"+size.name+"-"+theme.name, lines)
			}
			for _, n := range []int{8, ExitFrames - 1} {
				in := input(size.w, size.h, SceneFrames+n, theme.p)
				lines := RenderExit(in, n, welcome(in))
				assertSize(t, lines, size.w, size.h)
				golden(t, fmt.Sprintf("exit-%02d-%s-%s", n, size.name, theme.name), lines)
			}
		}
	}
}

func TestEveryFrameFitsAndIsRepeatable(t *testing.T) {
	for _, size := range sizes {
		for _, nc := range []bool{false, true} {
			for n := 0; n < SceneFrames+30; n++ {
				in := input(size.w, size.h, n, Dark())
				in.NoColor = nc
				a := Render(in)
				assertSize(t, a, size.w, size.h)
				if !slices.Equal(a, Render(in)) {
					t.Fatalf("%s frame %d is not deterministic", size.name, n)
				}
			}
			in := input(size.w, size.h, SceneFrames, Dark())
			in.NoColor = nc
			for n := range ExitFrames {
				a := RenderExit(in, n, welcome(in))
				assertSize(t, a, size.w, size.h)
				if !slices.Equal(a, RenderExit(in, n, welcome(in))) {
					t.Fatal("exit is not deterministic")
				}
			}
		}
	}
}

func TestLastExitIsExactlyWelcome(t *testing.T) {
	for _, size := range sizes {
		for _, p := range []Palette{Dark(), Light()} {
			for _, nc := range []bool{false, true} {
				in := input(size.w, size.h, SceneFrames, p)
				in.NoColor = nc
				tg := welcome(in)
				got := RenderExit(in, ExitFrames-1, tg)
				if !slices.Equal(got, tg.Lines) {
					t.Fatal("last exit must match Welcome cell for cell, including styling")
				}
				if !slices.Equal(got[tg.TitleAt.Y:tg.TitleAt.Y+1], tg.Lines[tg.TitleAt.Y:tg.TitleAt.Y+1]) {
					t.Fatal("title row differs")
				}
				if tg.Emblem != nil {
					box := tg.Emblem
					rest := Emblem([4]Level{OK, OK, OK, OK}, p, nc)
					for y, line := range rest {
						if ansi.Cut(got[box.Y+y], box.X, box.X+11) != line {
							t.Fatal("emblem box differs from Welcome's rest drawing")
						}
					}
				}
			}
		}
	}
}

func TestLogoStatesAtEveryScale(t *testing.T) {
	for _, s := range []Scale{ScaleFull, ScaleMedium, ScaleEmblem} {
		for _, level := range []Level{Unlit, OK, Warn, Fail} {
			for _, p := range []Palette{Dark(), Light()} {
				for _, nc := range []bool{false, true} {
					lines := RenderLogo(s, [4]Level{level, level, level, level}, p, nc)
					w, h := s.Size()
					assertSize(t, lines, w, h)
					golden(t, fmt.Sprintf("logo-%d-%d-%t-%t", s, level, p.Palette.Light, nc), lines)
					gl := "●"
					if level == Unlit {
						gl = "·"
					} else if level == Fail && nc {
						gl = "×"
					}
					if strings.Count(ansi.Strip(strings.Join(lines, "")), gl) != 4 {
						t.Fatalf("four %s status lights required", gl)
					}
					if nc && strings.Contains(strings.Join(lines, ""), "38;") {
						t.Fatal("NO_COLOR Logo contains colour")
					}
				}
			}
		}
	}
}

func TestDoctorTimingAndLiteralCopy(t *testing.T) {
	if TickStart(0, false) != 20 || TickStart(50, false) != 50 || TickStart(0, true) != 0 {
		t.Fatal("checks must not tick before arrival or 0.8 seconds")
	}
	in := input(120, 30, 0, Dark())
	for _, step := range []struct {
		n    int
		want string
	}{{19, "Checking this machine…"}, {20, "✓ Docker  docker command found"}, {26, "✓ Docker daemon  engine 27.3.1"}, {32, "✓ Docker Compose  compose 2.29.7"}, {38, "✓ Container IDs"}, {44, "✓ This machine is ready."}} {
		in.Wall = step.n
		got := ansi.Strip(Render(in)[29])
		if !strings.Contains(got, step.want) {
			t.Fatalf("frame %d: %q, want %q", step.n, got, step.want)
		}
	}
	if Ready(43, in.Doctor) || !Ready(44, in.Doctor) || Settled(83) || !Settled(84) {
		t.Fatal("ready and choreography gates must wait for their final beat")
	}
	in.Wall = 60
	in.Doctor.SettingsReading = true
	if Ready(60, in.Doctor) || !strings.Contains(ansi.Strip(Render(in)[29]), "Reading this machine's settings…") {
		t.Fatal("settings are part of readiness")
	}
	in.Doctor = Doctor{Reading: true, Again: true}
	if Ticked(60, in.Doctor) != 0 || !strings.Contains(ansi.Strip(Render(in)[29]), "Checking again…") {
		t.Fatal("re-check must show its own reading line")
	}
}

func TestCardsHoldAndRecover(t *testing.T) {
	for _, size := range sizes {
		for _, lv := range []Level{Warn, Fail} {
			in := input(size.w, size.h, 120, Dark())
			in.Doctor.Checks[1] = Check{Title: "Docker daemon", Level: lv,
				Detail: "Cannot connect to the Docker daemon. Is the Docker daemon running?",
				Hint:   "Open OrbStack so the Docker engine starts, then check again.", Docs: "https://docs.orbstack.dev/quick-start"}
			in.Hold = NewHold(lv, 84)
			for _, nc := range []bool{false, true} {
				in.NoColor = nc
				lines := Render(in)
				assertSize(t, lines, size.w, size.h)
				golden(t, fmt.Sprintf("hold-%d-%s-%t", lv, size.name, nc), lines)
				got := ansi.Strip(strings.Join(lines, "\n"))
				for _, want := range []string{"Docker daemon", "→ Open OrbStack", "https://docs.orbstack.dev/quick-start"} {
					if !strings.Contains(got, want) {
						t.Fatalf("card is missing %q\n%s", want, got)
					}
				}
				if lv == Fail && !strings.Contains(got, "Onboarding cannot continue while a check fails.") {
					t.Fatal("failure card must explain the hold")
				}
			}
			in.Hold.Out, in.Hold.Recover = 120, 120
			in.Wall = 120 + RecoverFrames
			for i := range in.Doctor.Checks {
				in.Doctor.Checks[i].Level = OK
			}
			got := ansi.Strip(strings.Join(Render(in), "\n"))
			if strings.Contains(got, "╭") || strings.Contains(got, "Onboarding cannot continue") {
				t.Fatal("passing re-check must drop the card")
			}
		}
	}
}

func TestNoColorKeepsWeightAndReducedMotionStaysStill(t *testing.T) {
	in := input(80, 24, SceneFrames, Dark())
	in.NoColor = true
	out := strings.Join(Render(in), "\n")
	if strings.Contains(out, "38;2") || strings.Contains(out, "38;5") || strings.Contains(out, "48;") || !strings.Contains(out, "\x1b[1m") || !strings.Contains(out, "\x1b[2m") {
		t.Fatalf("NO_COLOR must retain bold/faint without colour: %q", out)
	}
	in.Reduced = true
	in.Frame = 0
	first := Render(in)
	in.Frame = 300
	if !slices.Equal(first, Render(in)) {
		t.Fatal("reduced motion must not animate the scene")
	}
	if !slices.Equal(RenderExit(in, 0, welcome(in)), welcome(in).Lines) {
		t.Fatal("reduced motion must go directly to Welcome")
	}
	golden(t, "reduced-no-color", first)
	colorTarget := welcome(input(80, 24, 84, Dark()))
	out = strings.Join(RenderExit(in, ExitFrames-1, colorTarget), "\n")
	if strings.Contains(out, "38;") || !strings.Contains(out, "\x1b[1m") {
		t.Fatal("exit must strip landing colours without stripping weight")
	}
}

func TestPalettesAndReactionWeights(t *testing.T) {
	for _, choice := range []Choice{New, Advanced} {
		for _, age := range []int{2, 5, 9} {
			r := reaction(choice, age)
			dark := strings.Join(reactionLines(r), "\n")
			r.Pal = Light()
			light := strings.Join(reactionLines(r), "\n")
			if dark == light {
				t.Fatal("light and dark reactions must use their own palettes")
			}
			r.NoColor = true
			out := strings.Join(reactionLines(r), "\n")
			if strings.Contains(out, "38;") || strings.Contains(out, "48;") || !strings.Contains(out, "\x1b[1m") {
				t.Fatal("NO_COLOR reaction must retain weight without colour")
			}
			assertSize(t, ReactionEmblem(r), 11, 4)
			if ansi.StringWidth(Mark(choice, r)) != 1 || ansi.StringWidth(Caption(r)) != len([]rune(CaptionText(New))) {
				t.Fatal("reaction pieces must retain their cell widths")
			}
		}
	}
	dark := Render(input(80, 24, SceneFrames, Dark()))
	light := Render(input(80, 24, SceneFrames, Light()))
	if slices.Equal(dark, light) {
		t.Fatal("light and dark Intro frames must differ")
	}
}

func reaction(choice Choice, age int) Reaction {
	prev := Advanced
	if choice == Advanced {
		prev = New
	}
	return Reaction{Focus: choice, PrevFocus: prev, FocusAge: age, SelectAge: -1,
		Selected: New, PrevSelected: New, Levels: [4]Level{OK, OK, OK, OK}, Pal: Dark()}
}

func reactionLines(r Reaction) []string {
	lines := ReactionEmblem(r)
	lines = append(lines, Title("Welcome to self-host", r), Mark(New, r)+" "+Label(New, "New: this is all new to me", r), Mark(Advanced, r)+" "+Label(Advanced, "Advanced: I have run a server or used Docker", r), Caption(r))
	return lines
}

func TestGoldenReactions(t *testing.T) {
	for _, choice := range []Choice{New, Advanced} {
		for _, age := range []int{0, 3, 8, 16, FocusFrames} {
			r := reaction(choice, age)
			golden(t, fmt.Sprintf("focus-%d-%02d", choice, age), reactionLines(r))
			if !slices.Equal(reactionLines(r), reactionLines(r)) {
				t.Fatal("reaction must be deterministic")
			}
		}
		for _, age := range []int{0, 1, 2, 6, 12, SelectFrames} {
			r := reaction(choice, FocusFrames)
			r.Selected, r.PrevSelected, r.SelectAge = choice, r.PrevFocus, age
			golden(t, fmt.Sprintf("select-%d-%02d", choice, age), reactionLines(r))
		}
	}
}

func TestReactionRestIsThePlainDrawing(t *testing.T) {
	for _, p := range []Palette{Dark(), Light()} {
		for _, nc := range []bool{false, true} {
			for _, choice := range []Choice{New, Advanced} {
				r := reaction(choice, FocusFrames)
				r.Pal, r.NoColor, r.Selected, r.PrevSelected, r.SelectAge = p, nc, choice, r.PrevFocus, SelectFrames
				if FocusActive(r) || SelectionActive(r) || !slices.Equal(ReactionEmblem(r), Emblem(r.Levels, p, nc)) {
					t.Fatal("rest must stop frames and equal the unchanged emblem")
				}
				for _, text := range []string{"Welcome to self-host", "New: this is all new to me"} {
					cv := scene.New(len([]rune(text)), 1)
					cv.Text(0, 0, text, p.UI.AccentText, 1, true)
					if text == "Welcome to self-host" && Title(text, r) != cv.Row(0, nc) {
						t.Fatal("title rest differs")
					}
					if text != "Welcome to self-host" {
						cv.Text(0, 0, text, p.UI.Bright, 1, true)
						if Label(choice, text, r) != cv.Row(0, nc) {
							t.Fatal("selected label rest differs")
						}
						cv.Text(0, 0, text, p.UI.Text, 0.6, false)
						if Label(r.PrevFocus, text, r) != cv.Row(0, nc) {
							t.Fatal("unselected label rest differs")
						}
					}
				}
				if strings.TrimRight(ansi.Strip(Caption(r)), " ") != CaptionText(choice) || ansi.Strip(Mark(choice, r)) != "●" || ansi.Strip(Mark(r.PrevFocus, r)) != "○" {
					t.Fatal("caption and mark must equal their literal rest copy")
				}
				r.Reduced, r.FocusAge, r.SelectAge = true, 3, 1
				if FocusActive(r) || SelectionActive(r) || !slices.Equal(ReactionEmblem(r), Emblem(r.Levels, p, nc)) {
					t.Fatal("reduced motion must disable reactions")
				}
			}
		}
	}
}

func changedBytes(prev, cur *scene.Canvas) int {
	bytes := 0
	for y := range cur.H {
		last := -2
		var style scene.Look
		for x := range cur.W {
			a, b := prev.At(x, y), cur.At(x, y)
			if a.R == b.R && a.Look(false) == b.Look(false) {
				continue
			}
			if x != last+1 {
				bytes += 8
			}
			look := b.Look(false)
			if look != style || last == -2 {
				if !look.Plain {
					bytes += len(fmt.Sprintf("\x1b[0;38;2;%d;%d;%dm", look.FG.R, look.FG.G, look.FG.B))
					if look.Bold {
						bytes += 2
					}
				} else {
					bytes += 3
				}
				style = look
			}
			bytes += len(string(cur.Char(x, y)))
			last = x
		}
	}
	return bytes
}

func TestFrameByteBudget(t *testing.T) {
	in := input(80, 24, 0, Dark())
	prev := renderCanvas(newCtx(in, 0, false, Target{}))
	sum, peak := 0, 0
	for n := 1; n <= SceneFrames; n++ {
		in.Frame, in.Wall = n, n
		cur := renderCanvas(newCtx(in, 0, false, Target{}))
		b := changedBytes(prev, cur)
		sum, peak, prev = sum+b, max(peak, b), cur
	}
	avg := sum / SceneFrames
	t.Logf("Intro: average %d bytes, peak %d bytes", avg, peak)
	if avg > 2600 || peak > 6144 {
		t.Fatalf("Intro exceeds SSH budget: average %d, peak %d", avg, peak)
	}
	peak = 0
	for n := SceneFrames + 1; n < SceneFrames+24*16; n++ {
		in.Frame, in.Wall = n, n
		cur := renderCanvas(newCtx(in, 0, false, Target{}))
		b := changedBytes(prev, cur)
		peak, prev = max(peak, b), cur
	}
	t.Logf("Idle: peak %d bytes", peak)
	if peak >= 1024 {
		t.Fatalf("idle exceeds 1 KB per frame: %d", peak)
	}
	in.Doctor = Doctor{Reading: true}
	in.Frame, in.Wall = SceneFrames, SceneFrames
	prev = renderCanvas(newCtx(in, 0, false, Target{}))
	peak = 0
	for n := SceneFrames + 1; n < SceneFrames+24*16; n++ {
		in.Frame, in.Wall = n, n
		cur := renderCanvas(newCtx(in, 0, false, Target{}))
		peak, prev = max(peak, changedBytes(prev, cur)), cur
	}
	t.Logf("Reading idle: peak %d bytes", peak)
	if peak >= 1024 {
		t.Fatalf("reading idle exceeds 1 KB per frame: %d", peak)
	}
	in.Frame, in.Wall = 0, 0
	prev = renderCanvas(newCtx(in, 0, false, Target{}))
	sum, peak = 0, 0
	for n := 1; n <= SceneFrames; n++ {
		in.Frame, in.Wall = n, n
		cur := renderCanvas(newCtx(in, 0, false, Target{}))
		b := changedBytes(prev, cur)
		sum, peak, prev = sum+b, max(peak, b), cur
	}
	t.Logf("Reading Intro: average %d bytes, peak %d bytes", sum/SceneFrames, peak)
	if sum/SceneFrames > 2600 || peak > 6144 {
		t.Fatalf("reading Intro exceeds SSH budget: average %d, peak %d", sum/SceneFrames, peak)
	}
}
