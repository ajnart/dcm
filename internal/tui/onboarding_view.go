package tui

import (
	"fmt"
	"slices"
	"strings"

	"charm.land/bubbles/v2/key"
	"charm.land/lipgloss/v2"

	"github.com/ajnart/self-host/internal/host"
)

var (
	onboardingContinue = key.NewBinding(key.WithKeys("enter"), key.WithHelp("enter", "continue"))
	onboardingNextKey  = key.NewBinding(key.WithKeys("enter"), key.WithHelp("enter", "next"))
	onboardingApprove  = key.NewBinding(key.WithKeys("enter"), key.WithHelp("enter", "approve"))
	onboardingBack     = key.NewBinding(key.WithKeys("esc"), key.WithHelp("esc", "back"))
	onboardingChoose   = key.NewBinding(key.WithKeys("up", "down"), key.WithHelp("↑/↓", "focus"))
	onboardingSelect   = key.NewBinding(key.WithKeys("space"), key.WithHelp("space", "select"))
)

// bar is the bottom bar's left side and chips for the step.
func (o *onboarding) bar(ctx *viewContext) (string, []key.Binding) {
	t := ctx.theme
	quit := barKey(t, "q", "quit")
	switch o.step {
	case stepWhat, stepWhere, stepWho:
		chips := []key.Binding{onboardingNextKey, onboardingBack}
		if _, found := o.helpPage(); found {
			chips = append(chips, moreKey)
		}
		return t.fg(t.accentText).Bold(true).Render("answering") + t.dim().Render(" · keys go to the form"), chips
	case stepAccess:
		if o.form != nil {
			return t.fg(t.accentText).Bold(true).Render("answering"), []key.Binding{onboardingNextKey, onboardingBack}
		}
		return quit, []key.Binding{onboardingChoose, onboardingSelect, onboardingContinue, onboardingBack, moreKey}
	case stepWelcome:
		if o.experienceSaved {
			return quit, []key.Binding{onboardingContinue}
		}
		return quit, []key.Binding{onboardingChoose, onboardingSelect, onboardingContinue}
	case stepLook:
		return quit, []key.Binding{onboardingChoose, onboardingSelect, onboardingContinue, onboardingBack}
	case stepReview:
		if o.err != "" {
			chips := []key.Binding{hint("c", "copy error"), hint("e", "full error"), hint("a", "Access"), hint("w", "LAN address")}
			if o.reviewNamesCheck().Available {
				chips = append(chips, onboardingApprove)
			}
			return quit, append(chips, onboardingBack)
		}
		return quit, []key.Binding{hint("r", "recheck"), onboardingApprove, onboardingBack}
	}
	return quit, []key.Binding{onboardingContinue, onboardingBack}
}

func (o *onboarding) View(ctx *viewContext) string {
	lines := []string{"", "  " + renderSteps(ctx.theme, o.step, ctx.width-4), ""}
	switch o.step {
	case stepWelcome:
		room := max(ctx.mainHeight()-len(lines), 1)
		body := o.renderWelcome(ctx, room)
		for i := len(body) - 1; i >= 0 && len(body) > room; i-- {
			if strings.TrimSpace(body[i]) == "" {
				body = slices.Delete(body, i, i+1)
			}
		}
		for i, line := range body {
			body[i] = truncate(strings.TrimRight(strings.TrimPrefix(line, "  "), " "), max(ctx.width-4, 1))
		}
		block := strings.Join(body, "\n")
		block = fit(block, lipgloss.Width(block), lipgloss.Height(block))
		return strings.Join(lines, "\n") + "\n" + lipgloss.Place(ctx.width, room, lipgloss.Center, lipgloss.Center, block)
	case stepAccess:
		if o.form != nil {
			lines = append(lines, lipgloss.NewStyle().PaddingLeft(2).Render(o.form.View()))
		} else {
			lines = append(lines, o.renderAccess(ctx)...)
		}
	case stepLook:
		lines = append(lines, o.renderLook(ctx)...)
	case stepReview:
		lines = append(lines, o.renderReview(ctx)...)
	default:
		for _, line := range o.stepIntro(ctx, o.step) {
			lines = append(lines, "  "+ctx.theme.body().Render(line))
		}
		lines = append(lines, "")
		if o.form != nil {
			form := lipgloss.NewStyle().PaddingLeft(2).Render(o.form.View())
			lines = append(lines, form)
			if o.step == stepWhere {
				lines = append(lines, o.whereExplanation(ctx)...)
			}
		}
		if o.list != nil {
			lines = append(lines, o.renderWhatList(ctx)...)
			lines = append(lines, "")
			lines = append(lines, o.whatDetail(ctx)...)
		}
	}
	return strings.Join(lines, "\n")
}

// renderSteps is the step indicator: done steps ticked, the current one
// bold and bright, the later ones grey. When the names do not fit, only the
// current step keeps its name.
func renderSteps(t theme, current step, width int) string {
	var full, compact []string
	for i, name := range stepNames {
		s := step(i)
		mark, label := t.disabled().Render("○"), t.inactive().Render(name)
		switch {
		case s < current:
			mark, label = t.fg(t.ok).Render("✓"), t.body().Render(name)
		case s == current:
			mark, label = t.title().Render("●"), t.active().Render(name)
		}
		full = append(full, mark+" "+label)
		if s == current {
			compact = append(compact, mark+" "+label)
		} else {
			compact = append(compact, mark)
		}
	}
	line := strings.Join(full, t.disabled().Render(" › "))
	if lipgloss.Width(line) <= width {
		return line
	}
	return strings.Join(compact, " ") + t.dim().Render(fmt.Sprintf("  %d of %d", current+1, len(stepNames)))
}

func (o *onboarding) renderLook(ctx *viewContext) []string {
	t := ctx.theme
	lines := []string{"  " + t.title().Render("How self-host looks")}
	for _, line := range o.stepIntro(ctx, stepLook) {
		lines = append(lines, "  "+t.body().Render(line))
	}
	lines = append(lines, "", truncate("  "+glyphSample(t, ctx.glyphs), ctx.width), "",
		"  "+t.heading().Render("Choose your symbols; the sample shows your selection."))
	answers := []string{"Nerd Font: use extra font icons", "Simple (default): use plain symbols"}
	for i, choice := range glyphChoices {
		lines = append(lines, "  "+truncate(radioRow(t, i == o.look, choice.glyphs == ctx.glyphs, answers[i]), ctx.width-2))
	}
	return append(lines, "", "  "+nerdFontsLine(t))
}

// renderAccess asks how the Apps will be opened: the options, with the
// explanation and diagram of the highlighted one under them.
func (o *onboarding) renderAccess(ctx *viewContext) []string {
	t := ctx.theme
	head := []string{"  " + t.title().Render("How you'll open your Apps")}
	for _, line := range o.stepIntro(ctx, stepAccess) {
		head = append(head, "  "+t.body().Render(line))
	}
	var options []string
	for i, option := range accessOptions {
		selected := option.id == o.answers.accessChoice
		options = append(options, "  "+truncate(radioRow(t, i == o.access, selected, accessLabel(t, option)), ctx.width-2))
	}
	const above = 3 // the blank line, the step indicator and a blank line
	width := min(max(ctx.width-4, 20), 96)
	block := func(lines []string) []string {
		room := ctx.mainHeight() - above - len(lines)
		return accessBlock(t, accessOptions[o.access], o.answers.exposure, o.answers.lan, width, room)
	}
	spaced := slices.Concat(head, []string{""}, options)
	packed := slices.Concat(head, options)
	if len(block(packed)) > len(block(spaced)) {
		return append(packed, block(packed)...)
	}
	return append(spaced, block(spaced)...)
}

func (o *onboarding) renderReview(ctx *viewContext) []string {
	t := ctx.theme
	lines := []string{"  " + t.title().Render("Review") + t.dim().Render("  nothing has been written yet")}
	if o.err != "" {
		lines = append(lines, "")
		preview := strings.Split(wrap("✗ "+o.err, max(ctx.width-4, 20)), "\n")
		for _, line := range preview[:min(len(preview), 4)] {
			lines = append(lines, "  "+t.fg(t.fail).Render(line))
		}
		lines = append(lines, "  "+t.dim().Render("c copies · e full error · a Access · w LAN address. Nothing installed."))
		if o.reviewNamesCheck().Available {
			lines = append(lines, "  "+t.dim().Render("Enter approves another attempt; esc goes back."))
		} else {
			lines = append(lines, "  "+t.dim().Render("Change Access or the LAN address before approval."))
		}
	}
	if len(o.hostChecks) > 0 {
		lines = append(lines, "", "  "+t.heading().Render("Machine checks"))
		for _, level := range []host.Level{host.Fail, host.Warn, host.OK} {
			for _, check := range o.hostChecks {
				if check.Level != level {
					continue
				}
				mark := t.dot(string(check.Level))
				lines = append(lines, "  "+mark+" "+t.body().Render(check.Title)+t.dim().Render(" — "+check.Detail))
				if check.Hint != "" {
					lines = append(lines, "    "+t.dim().Render(check.Hint))
				}
			}
		}
	}
	lines = append(lines, planLines(t, o.plan)...)
	if o.answers.cloudflare {
		lines = append(lines, "", "  "+t.body().Render("Your own web address: choose Apps in Settings after install; nothing public yet"))
	}
	return lines
}

// whereExplanation explains the focused Where field in the lines it fits.
func (o *onboarding) whereExplanation(ctx *viewContext) []string {
	key := o.focusedKey()
	if key == "" {
		return nil
	}
	width := min(max(ctx.width-4, 20), 96)
	var lines []string
	for _, line := range strings.Split(wrap(whereExplanations[key], width), "\n") {
		lines = append(lines, "  "+ctx.theme.body().Render(strings.TrimRight(line, " ")))
	}
	lines = append([]string{""}, lines...)
	for _, line := range o.folderListing(key, width) {
		lines = append(lines, "  "+ctx.theme.dim().Render(line))
	}
	return lines
}

// folderListing lists the folders inside what the focused folder field holds.
func (o *onboarding) folderListing(key string, width int) []string {
	switch key {
	case whereMedia:
		return o.folders.listing(o.answers.media, width, folderListLines)
	case whereDownloads:
		return o.folders.listing(o.answers.downloads, width, folderListLines)
	}
	return nil
}

// whatDetailLines is the room for the hovered item's description on What:
// its name, then its words and, for a Recipe, its Apps.
const whatDetailLines = 5

// whatDetail describes the item under the highlight of the What list.
func (o *onboarding) whatDetail(ctx *viewContext) []string {
	list := o.list
	if list == nil {
		return nil
	}
	rows := whatRows(ctx, list)
	if list.cursor >= len(rows) {
		return nil
	}
	t := ctx.theme
	kind, id, _ := strings.Cut(rows[list.cursor].key, ":")
	cat := ctx.backend.Catalog()
	var name, text, extra string
	if kind == "recipe" {
		r, found := cat.Recipe(id)
		if !found {
			return nil
		}
		var names []string
		for _, appID := range r.Apps {
			names = append(names, targetName(cat, appID))
		}
		name, text, extra = r.Name+" (Recipe)", r.Description, "Includes "+strings.Join(names, ", ")
	} else {
		a, found := cat.App(id)
		if !found {
			return nil
		}
		info := a.Info()
		name, text = info.Name, info.Description
		if info.Category != "" {
			extra = info.Category
		}
	}
	width := max(ctx.width-4, 20)
	body := strings.Split(wrap(text, width), "\n")
	if extra != "" {
		body = append(body, strings.Split(wrap(extra, width), "\n")...)
	}
	if len(body) > whatDetailLines-1 {
		body = body[:whatDetailLines-1]
		body[len(body)-1] = truncate(body[len(body)-1]+"…", width)
	}
	lines := []string{"  " + t.heading().Render(name)}
	for i, line := range body {
		style := t.body()
		if extra != "" && i == len(body)-1 {
			style = t.dim()
		}
		lines = append(lines, "  "+style.Render(line))
	}
	return lines
}
