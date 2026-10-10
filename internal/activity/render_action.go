package activity

import (
	"cmp"
	"strconv"
	"strings"

	"github.com/charmbracelet/x/ansi"
)

const (
	spinnerFrames = "⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏"
	// pulseFrames is how long a dot that turned green, or an App in the
	// finish wave, stays lit.
	pulseFrames = 4
	// waveStep is the delay of the finish wave from one App row to the next.
	waveStep = 2
	// fillFrames is how long a Link's line takes to fill into an arrow.
	fillFrames = 6
	// dotFrames is how long each masked dot of a credential takes to fill.
	dotFrames = 2
	maskDots  = 6
	// wideBoxes is the width from which the Apps and Links boxes sit side
	// by side; below it they stack.
	wideBoxes  = 100
	maxSteps   = 4
	linkLine   = 8
	narrowLine = 5
)

// Spinner is the braille spinner at frame.
func Spinner(frame int) string {
	runes := []rune(spinnerFrames)
	return string(runes[frame%len(runes)])
}

// Animating reports whether the snapshot still moves after m.Frame: while
// the Action runs, and until the last transition has played.
func Animating(s Snapshot, m Motion) bool {
	if s.Action.Running {
		return true
	}
	settle := fillFrames + maskDots*dotFrames + waveStep*len(s.Action.Apps) + pulseFrames
	for _, at := range m.Changed {
		if m.Frame-at < settle {
			return true
		}
	}
	return false
}

// Render draws the Action of the snapshot within width cells: its title and
// stages, the pull while it runs, the Apps and Links boxes with their
// counters, and the narrative line, with the icons of glyph set g.
// Transitions are functions of the frames since each row changed.
func Render(s Snapshot, m Motion, width int, g Glyphs, p Palette) []string {
	a := s.Action
	if a.Empty() {
		return nil
	}
	r := renderer{a: a, m: m, g: g, p: p, narrow: width < wideBoxes, linkInner: width - 4}
	if !r.narrow && len(a.Apps) > 0 && len(a.Links) > 0 {
		r.linkInner = width - (width-1)/2 - 1 - 4
	}
	lines := []string{r.title()}
	if len(a.Stages) > 0 {
		lines = append(lines, "  "+r.stages())
	}
	if s.Pull.Pulling {
		for _, line := range PullBlock(s, width-2, p) {
			lines = append(lines, "  "+line)
		}
	}
	apps := r.appsBox()
	links := r.linksBox()
	switch {
	case len(links.lines) == 0:
		lines = append(lines, box(apps, width, len(apps.lines), p)...)
	case len(apps.lines) == 0:
		lines = append(lines, box(links, width, len(links.lines), p)...)
	case !r.narrow:
		left := (width - 1) / 2
		height := max(len(apps.lines), len(links.lines))
		lines = append(lines, beside(box(apps, left, height, p), box(links, width-left-1, height, p))...)
	default:
		lines = append(lines, box(apps, width, len(apps.lines), p)...)
		lines = append(lines, box(links, width, len(links.lines), p)...)
	}
	lines = append(lines, r.narrative()...)
	for i, line := range lines {
		lines[i] = ansi.Truncate(line, width, "…")
	}
	return lines
}

type renderer struct {
	a      Action
	m      Motion
	g      Glyphs
	p      Palette
	narrow bool
	// linkInner is the width inside the box the Links are drawn in.
	linkInner int
}

// narrative is the line under the boxes: calm while the Action runs, bold
// when it finished, and red when it finished by failing.
func (r renderer) narrative() []string {
	a := r.a
	if a.Narrative == "" {
		return nil
	}
	narrative := style(r.p.Text).Render(a.Narrative)
	switch {
	case a.Finished && r.outcome() == Failed:
		narrative = style(r.p.Fail).Render(a.Narrative)
	case a.Finished:
		narrative = style(r.p.Bright).Bold(true).Render(a.Narrative)
	}
	return []string{"  " + narrative}
}

// boxContent is a box's title and inner lines.
type boxContent struct {
	title, counter string
	lines          []string
}

func (r renderer) spinner() string {
	return style(r.p.AccentText).Render(Spinner(r.m.Frame))
}

// glyph is the mark of a state; running spins.
func (r renderer) glyph(state State) string {
	switch state {
	case Done:
		return style(r.p.OK).Render("✓")
	case Skipped:
		return style(r.p.Muted).Render("↷")
	case Failed:
		return style(r.p.Fail).Render("✗")
	case Manual:
		return style(r.p.Warn).Render("!")
	case Running:
		return r.spinner()
	}
	return style(r.p.Faint).Render("○")
}

func (r renderer) title() string {
	a := r.a
	mark := r.spinner()
	if a.Finished {
		mark = r.glyph(r.outcome())
	}
	title := a.Title
	if title == "" {
		title = "Action"
	}
	return mark + " " + style(r.p.Bright).Bold(true).Render(title)
}

// outcome is how the finished Action ended, for its title mark.
func (r renderer) outcome() State {
	if r.a.Error != "" {
		return Failed
	}
	result := Done
	for _, app := range r.a.Apps {
		if app.State == Failed {
			return Failed
		}
		if app.State == Manual {
			result = Manual
		}
	}
	for _, link := range r.a.Links {
		if link.State == Failed {
			return Failed
		}
	}
	return result
}

func (r renderer) stages() string {
	var parts []string
	for _, stage := range r.a.Stages {
		name := style(r.p.Muted).Render(stage.Name)
		if stage.State == Running {
			name = style(r.p.Bright).Bold(true).Render(stage.Name)
		}
		parts = append(parts, r.glyph(stage.State)+" "+r.stageIcon(stage.Name)+name)
	}
	return strings.Join(parts, "   ")
}

// stageIcon is the icon of the stages that have one, with its space: Docker
// for the pull and start, a key for credentials, a link for Links.
func (r renderer) stageIcon(name string) string {
	switch name {
	case StagePull, StageStart:
		return style(r.p.Muted).Render(r.g.Docker()) + " "
	case StageCredentials:
		return style(r.p.Muted).Render(r.g.Key()) + " "
	case StageLinks:
		return style(r.p.Muted).Render(r.g.Link()) + " "
	}
	return ""
}

func (r renderer) appsBox() boxContent {
	if len(r.a.Apps) == 0 {
		return boxContent{}
	}
	c := boxContent{title: "Apps", counter: countOf(r.a.Counts.AppsSetUp, r.a.Counts.AppsTotal) + " set up"}
	for i, app := range r.a.Apps {
		c.lines = append(c.lines, r.appRow(i, app))
		c.lines = append(c.lines, r.stepRows(app)...)
	}
	return c
}

func countOf(n, total int) string {
	return strconv.Itoa(n) + "/" + strconv.Itoa(total)
}

// lit reports that an App row is lit: just turned ready, or in the finish
// wave that runs down the rows.
func (r renderer) lit(i int, app ActionApp) bool {
	if app.State != Done {
		return false
	}
	if r.m.since(app.Key) < pulseFrames {
		return true
	}
	wave := r.m.since(ActionKey) - waveStep*i
	return r.a.Finished && wave >= 0 && wave < pulseFrames
}

func (r renderer) appRow(i int, app ActionApp) string {
	mark := r.glyph(app.State)
	label := pad(ansi.Truncate(app.Name, 15, "…"), 16)
	name := style(r.p.Text).Render(label)
	fact := ""
	switch app.State {
	case Done:
		mark = style(r.p.OK).Render("●")
		fact = "started"
		if app.Ready {
			fact = "ready"
		}
		if r.lit(i, app) {
			mark = style(r.p.OK).Bold(true).Render("◉")
			name = style(r.p.OK).Bold(true).Render(label)
		}
	case Running:
		name = style(r.p.Bright).Bold(true).Render(label)
		fact = "starting"
		if len(app.Steps) > 0 {
			fact = "setting up"
		}
	case Failed:
		fact = "failed"
	case Manual:
		fact = "needs you"
	case NotRun:
		name = style(r.p.Muted).Render(label)
		fact = "waiting"
	}
	return mark + " " + name + style(r.p.Muted).Render(fact)
}

// stepRows are the steps shown under an App: the App being set up shows its
// latest steps one after another; a failed or manual App shows the step
// that needs attention with its error and hint.
func (r renderer) stepRows(app ActionApp) []string {
	var steps []Step
	switch app.State {
	case Running:
		steps = app.Steps[max(len(app.Steps)-maxSteps, 0):]
	case Failed, Manual:
		for _, step := range app.Steps {
			if step.State == Failed || step.State == Manual {
				steps = append(steps, step)
			}
		}
	}
	var out []string
	for _, step := range steps {
		line := "  " + r.glyph(step.State) + " " + style(r.p.Text).Render(cmp.Or(step.Msg, step.Label))
		if step.Credential != "" {
			line += "  " + r.mask(step)
		}
		out = append(out, line)
		if step.State == Failed && step.Error != "" {
			out = append(out, "      "+style(r.p.Fail).Render(firstLine(step.Error)))
		}
		if (step.State == Failed || step.State == Manual) && step.Hint != "" {
			hint := style(r.p.Muted).Render("→ " + firstLine(step.Hint))
			if step.State == Manual {
				hint = style(r.p.Warn).Render("→ " + firstLine(step.Hint))
			}
			out = append(out, "      "+hint)
		}
	}
	return out
}

// mask is a credential as masked dots: they fill in while the step runs and
// a "saved" chip follows once it is done. It never shows the secret.
func (r renderer) mask(step Step) string {
	filled := maskDots
	switch step.State {
	case Running:
		filled = min(r.m.since(step.Key)/dotFrames, maskDots-1)
	case Failed, Manual, NotRun:
		filled = 0
	}
	dots := style(r.p.AccentText).Render(strings.Repeat("•", filled)) + style(r.p.Faint).Render(strings.Repeat("·", maskDots-filled))
	if step.State == Done || step.State == Skipped {
		chip := style(r.p.OK).Reverse(true).Render(" saved ")
		if r.m.since(step.Key) < pulseFrames {
			chip = style(r.p.OK).Reverse(true).Bold(true).Render(" saved ")
		}
		return style(r.p.Muted).Render(strings.Repeat("•", maskDots)) + " " + chip
	}
	return dots
}

func (r renderer) linksBox() boxContent {
	if len(r.a.Links) == 0 {
		return boxContent{}
	}
	c := boxContent{title: "Links", counter: countOf(r.a.Counts.LinksApplied, r.a.Counts.LinksTotal)}
	for _, link := range r.a.Links {
		c.lines = append(c.lines, r.linkRows(link)...)
	}
	return c
}

// linkRows are a Link's row and, when the start of its fact (what it is for,
// why it waits or how it failed) does not fit after the names, the fact on a
// second line under them. What follows a parenthesis is detail that may be
// cut, so a waiting reason such as "waiting for qbittorrent" always shows.
func (r renderer) linkRows(link Link) []string {
	length, nameWidth := linkLine, 12
	if r.narrow {
		length, nameWidth = narrowLine, 11
	}
	source := pad(ansi.Truncate(link.Source, nameWidth, "…"), nameWidth)
	target := ansi.Truncate(link.Target, nameWidth, "…")
	fact, factStyle := link.Purpose, style(r.p.Muted)
	nameStyle := style(r.p.Text)
	switch link.State {
	case NotRun:
		nameStyle = style(r.p.Muted)
		fact = link.Waiting
	case Failed:
		fact, factStyle = firstLine(cmp.Or(link.Error, link.Purpose)), style(r.p.Fail)
	case Running:
		nameStyle = style(r.p.Bright).Bold(true)
	}
	line := r.linkLine(link, length)
	row := r.glyph(link.State) + " " + style(r.p.Muted).Render(r.g.Link()) + " " + nameStyle.Render(source) + " " + line + " " + nameStyle.Render(pad(target, nameWidth))
	if fact == "" {
		return []string{row}
	}
	head, _, _ := strings.Cut(fact, " (")
	if ansi.StringWidth(row)+1+ansi.StringWidth(head) <= r.linkInner {
		return []string{row + " " + factStyle.Render(fact)}
	}
	return []string{row, "    " + factStyle.Render(fact)}
}

// linkLine is the dashed line between the two Apps: grey while the Link
// waits, a sweeping head while it runs, and a fill that grows into an arrow
// once it applies.
func (r renderer) linkLine(link Link, length int) string {
	switch link.State {
	case Done:
		filled := min((r.m.since(link.Key)+1)*length/fillFrames, length)
		if filled >= length {
			return style(r.p.Accent).Render(strings.Repeat("━", length-1) + "▶")
		}
		return style(r.p.Accent).Render(strings.Repeat("━", filled)) + style(r.p.Faint).Render(strings.Repeat("╌", length-filled))
	case Skipped:
		return style(r.p.Muted).Render(strings.Repeat("━", length-1) + "▶")
	case Running:
		head := r.m.Frame % length
		return style(r.p.Faint).Render(strings.Repeat("╌", head)) + style(r.p.Accent).Render("━") + style(r.p.Faint).Render(strings.Repeat("╌", length-head-1))
	case Failed:
		return style(r.p.Fail).Render(strings.Repeat("╌", length))
	}
	return style(r.p.Faint).Render(strings.Repeat("╌", length))
}

// box draws content in a rounded box of exactly width cells and height
// inner lines, its title and counter set into the top border. An empty box
// draws nothing.
func box(c boxContent, width, height int, p Palette) []string {
	if c.title == "" {
		return nil
	}
	border := style(p.Faint)
	label := " " + style(p.Bright).Bold(true).Render(c.title)
	if c.counter != "" {
		label += " " + style(p.Muted).Render(c.counter)
	}
	label += " "
	inner := max(width-4, 1)
	fill := max(width-3-ansi.StringWidth(label), 0)
	out := []string{border.Render("╭─") + label + border.Render(strings.Repeat("─", fill)+"╮")}
	for i := 0; i < height; i++ {
		line := ""
		if i < len(c.lines) {
			line = c.lines[i]
		}
		out = append(out, border.Render("│")+" "+pad(ansi.Truncate(line, inner, "…"), inner)+" "+border.Render("│"))
	}
	return append(out, border.Render("╰"+strings.Repeat("─", max(width-2, 0))+"╯"))
}

// beside joins two boxes of the same height side by side.
func beside(left, right []string) []string {
	var out []string
	for i := range left {
		out = append(out, left[i]+" "+right[i])
	}
	return out
}
