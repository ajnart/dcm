package tui

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"slices"
	"strconv"
	"strings"

	"charm.land/bubbles/v2/key"
	tea "charm.land/bubbletea/v2"
	"charm.land/huh/v2"
	"charm.land/lipgloss/v2"

	"github.com/ajnart/self-host/internal/activity"
	"github.com/ajnart/self-host/internal/app"
	"github.com/ajnart/self-host/internal/catalog"
	"github.com/ajnart/self-host/internal/host"
	"github.com/ajnart/self-host/internal/service"
)

// step is one step of Onboarding, in order.
type step int

const (
	stepInitializing step = iota
	stepWelcome
	stepWhat
	stepWhere
	stepWho
	stepLook
	stepReview
)

var stepNames = []string{"Initializing", "Welcome", "What", "Where", "Who", "Look", "Review"}

// revealEvery is how many frames each host check spins before it shows its result.
const revealEvery = 6

// answers is shared by pointer so huh's bindings survive Model copies and
// every step's form, built afresh each time the step opens, shows them.
type answers struct {
	exposure                 string
	selected                 []string
	tz, lan, puid, pgid      string
	media, downloads         string
	adminUser, adminPassword string
	inputs                   map[string]*string
}

// onboarding is the person's first run, from the host checks to an approved
// plan. Approving hands over to the Dashboard; onboarding stays until the
// Project exists, so an install that fails before that returns to Review.
type onboarding struct {
	step    step
	form    *huh.Form
	answers *answers
	plan    *plan
	// checking is set while the host checks are being read; checksFrom is
	// the frame they started revealing at.
	checking   bool
	checksFrom int
	// task is the approved install; while it is set the Dashboard is on screen.
	task int
	err  string
}

// plan is a reviewed install: what will happen, before anything is written.
type plan struct {
	apps     []app.App
	opts     service.InstallOptions
	links    []string
	settings map[string]string
	fresh    bool
}

func (m Model) newOnboarding() *onboarding {
	o := &onboarding{answers: &answers{exposure: service.ExposureLAN, adminUser: "admin", inputs: map[string]*string{}},
		checking: len(m.checks) == 0, checksFrom: m.frame}
	o.answers.fill(m.defaults)
	return o
}

// fill sets every detected Host setting the person has not answered yet.
func (a *answers) fill(defaults map[string]string) {
	for _, f := range []struct {
		value *string
		key   string
	}{{&a.tz, "TZ"}, {&a.lan, "LAN_IP"}, {&a.puid, "PUID"}, {&a.pgid, "PGID"}, {&a.media, "MEDIA_ROOT"}, {&a.downloads, "DOWNLOADS_ROOT"}} {
		if *f.value == "" {
			*f.value = defaults[f.key]
		}
	}
}

// onboardingShown reports that Onboarding is on screen rather than the Dashboard.
func (m Model) onboardingShown() bool {
	return m.onboarding != nil && m.onboarding.task == 0
}

// revealed is how many host checks show their result; the next one spins.
func (m Model) revealed() int {
	o := m.onboarding
	if o.checking {
		return 0
	}
	return min(max((m.frame-o.checksFrom)/revealEvery, 0), len(m.checks))
}

func (m Model) checksDone() bool {
	return !m.onboarding.checking && m.revealed() == len(m.checks)
}

// onboardingAnimating reports that the host checks are still being read or revealed.
func (m Model) onboardingAnimating() bool {
	return m.onboardingShown() && m.onboarding.step == stepInitializing && !m.checksDone()
}

// checksArrived starts revealing the host checks when they are new to Onboarding.
func (m *Model) checksArrived() tea.Cmd {
	if !m.onboardingShown() || !m.onboarding.checking {
		return nil
	}
	m.onboarding.checksFrom, m.onboarding.checking = m.frame, false
	return m.startTicking()
}

// expand turns "recipe:x"/"app:x" selections into catalog Apps.
func expand(cat *catalog.Catalog, selected []string) []app.App {
	var apps []app.App
	seen := map[string]bool{}
	add := func(id string) {
		if a, found := cat.App(id); found && !seen[id] {
			seen[id] = true
			apps = append(apps, a)
		}
	}
	for _, s := range selected {
		kind, id, _ := strings.Cut(s, ":")
		if kind == "recipe" {
			if r, found := cat.Recipe(id); found {
				for _, appID := range r.Apps {
					add(appID)
				}
			}
			continue
		}
		add(id)
	}
	return apps
}

func catalogOptions(cat *catalog.Catalog, installed map[string]bool) []huh.Option[string] {
	var options []huh.Option[string]
	for _, r := range cat.Recipes() {
		options = append(options, huh.NewOption("📦 "+r.Name+" — "+r.Description+" ("+strings.Join(r.Apps, ", ")+")", "recipe:"+r.ID))
	}
	apps := cat.Apps()
	slices.SortFunc(apps, func(a, b app.App) int {
		return strings.Compare(strings.ToLower(a.Info().Name), strings.ToLower(b.Info().Name))
	})
	for _, a := range apps {
		info := a.Info()
		if installed[info.ID] {
			continue
		}
		options = append(options, huh.NewOption(info.Name+" — "+info.Description, "app:"+info.ID))
	}
	return options
}

func validFolder(path string) error {
	if !filepath.IsAbs(path) {
		return errors.New("use an absolute path, e.g. /srv/media")
	}
	parent := path
	for {
		if info, err := os.Stat(parent); err == nil {
			if !info.IsDir() {
				return errors.New(parent + " is a file, not a folder")
			}
			return nil
		}
		next := filepath.Dir(parent)
		if next == parent {
			return errors.New("no existing parent folder")
		}
		parent = next
	}
}

func validPassword(s string) error {
	if s == "" {
		return nil
	}
	if len(s) < 8 {
		return errors.New("at least 8 characters, or leave empty to generate one")
	}
	if strings.ContainsAny(s, "'\n\r") {
		return errors.New("quotes and newlines are not supported")
	}
	return nil
}

// buildForm is the form of the What, Where or Who step over the answers so far.
func (m Model) buildForm(s step) *huh.Form {
	v := m.onboarding.answers
	cat := m.backend.Catalog()
	needsMedia := func() bool {
		for _, a := range expand(cat, v.selected) {
			if a.Info().UsesMedia {
				return true
			}
		}
		return false
	}
	var groups []*huh.Group
	switch s {
	case stepWhat:
		if v.selected == nil {
			if _, found := cat.App("homarr"); found {
				v.selected = []string{"app:homarr"}
			}
		}
		groups = append(groups, huh.NewGroup(huh.NewMultiSelect[string]().Title("What do you want to self-host?").
			Description("space or x toggles · / filters · enter continues").
			Value(&v.selected).Options(catalogOptions(cat, nil)...).Filterable(true).Height(14).
			Validate(func(s []string) error {
				if len(s) == 0 {
					return errors.New("pick at least one Recipe or App")
				}
				return nil
			})))
		groups = append(groups, m.inputGroups(cat)...)
	case stepWhere:
		groups = append(groups,
			huh.NewGroup(huh.NewSelect[string]().Title("Who should reach your Apps?").
				Description("You can change this later with: self-host config set EXPOSURE=…").
				Options(
					huh.NewOption("My local network — TVs, phones and other computers can connect", service.ExposureLAN),
					huh.NewOption("This machine only — nothing else on the network can connect", service.ExposureLocal),
				).Value(&v.exposure)),
			huh.NewGroup(
				huh.NewInput().Title("Time zone").Value(&v.tz),
				huh.NewInput().Title("LAN address").Description("Shown in App URLs").Value(&v.lan),
				huh.NewInput().Title("User ID (PUID)").Description("Files are owned by this user").Value(&v.puid).Validate(numeric),
				huh.NewInput().Title("Group ID (PGID)").Value(&v.pgid).Validate(numeric),
			).Title("Host settings").Description("Detected from this machine; every App uses them."),
			huh.NewGroup(
				huh.NewInput().Title("Media folder").Description("Movies, shows and music live here").Value(&v.media).Validate(validFolder),
				huh.NewInput().Title("Downloads folder").Value(&v.downloads).Validate(validFolder),
			).WithHideFunc(func() bool { return !needsMedia() }))
	case stepWho:
		groups = append(groups, huh.NewGroup(
			huh.NewInput().Title("Admin username").Description("One login for every App").Value(&v.adminUser).
				Validate(func(s string) error {
					if strings.TrimSpace(s) == "" {
						return errors.New("required")
					}
					return nil
				}),
			huh.NewInput().Title("Admin password").Description("Leave empty to generate a strong one").
				EchoMode(huh.EchoModePassword).Value(&v.adminPassword).Validate(validPassword),
		).Title("Admin login"))
	}
	return huh.NewForm(groups...).WithTheme(huh.ThemeFunc(huh.ThemeCharm)).WithShowHelp(true).
		WithWidth(min(max(m.width-8, 40), 100))
}

// inputGroups ask each chosen App's own inputs; an answer survives the
// form being built again when the person comes back.
func (m Model) inputGroups(cat *catalog.Catalog) []*huh.Group {
	v := m.onboarding.answers
	var groups []*huh.Group
	for _, a := range cat.Apps() {
		inputs := a.Inputs()
		if len(inputs) == 0 {
			continue
		}
		id := a.Info().ID
		var fields []huh.Field
		for _, in := range inputs {
			value := v.inputs[id+"."+in.Key]
			if value == nil {
				value = new(string)
				if !in.Private {
					*value = in.Default
				}
				v.inputs[id+"."+in.Key] = value
			}
			field := huh.NewInput().Title(in.Prompt).Description(in.Help).Value(value)
			if in.Private {
				field = field.EchoMode(huh.EchoModePassword)
			}
			if in.Required {
				field = field.Validate(func(s string) error {
					if strings.TrimSpace(s) == "" {
						return errors.New("required")
					}
					return nil
				})
			}
			fields = append(fields, field)
		}
		groups = append(groups, huh.NewGroup(fields...).Title(a.Info().Name).WithHideFunc(func() bool {
			return !slices.ContainsFunc(expand(cat, v.selected), func(x app.App) bool { return x.Info().ID == id })
		}))
	}
	return groups
}

func numeric(s string) error {
	if _, err := strconv.Atoi(strings.TrimSpace(s)); err != nil {
		return errors.New("a number")
	}
	return nil
}

// planFromAnswers turns completed answers into a reviewed install.
func (m Model) planFromAnswers(v *answers) *plan {
	cat := m.backend.Catalog()
	apps := expand(cat, v.selected)
	opts := service.InstallOptions{Exposure: v.exposure, AdminUser: v.adminUser, AdminPassword: v.adminPassword,
		Settings: map[string]string{"TZ": v.tz, "LAN_IP": v.lan, "PUID": v.puid, "PGID": v.pgid}}
	needsMedia := false
	for _, a := range apps {
		opts.Targets = append(opts.Targets, a.Info().ID)
		needsMedia = needsMedia || a.Info().UsesMedia
		for _, in := range a.Inputs() {
			if value := v.inputs[a.Info().ID+"."+in.Key]; value != nil && *value != "" {
				if in.Private {
					setPrivateInput(&opts, a.Info().ID, in.Key, *value)
					continue
				}
				opts.Sets = append(opts.Sets, a.Info().ID+"."+in.Key+"="+*value)
			}
		}
	}
	if needsMedia {
		opts.MediaRoot, opts.DownloadsRoot = v.media, v.downloads
	}
	settings := map[string]string{"TZ": v.tz, "LAN_IP": v.lan, "PUID": v.puid, "PGID": v.pgid, "EXPOSURE": v.exposure}
	if needsMedia {
		settings["MEDIA_ROOT"], settings["DOWNLOADS_ROOT"] = v.media, v.downloads
	}
	return &plan{apps: apps, opts: opts, links: linksBetween(cat, apps, nil), settings: settings, fresh: true}
}

func setPrivateInput(opts *service.InstallOptions, id, key, value string) {
	if opts.PrivateInputs == nil {
		opts.PrivateInputs = map[string]map[string]string{}
	}
	if opts.PrivateInputs[id] == nil {
		opts.PrivateInputs[id] = map[string]string{}
	}
	opts.PrivateInputs[id][key] = value
}

// linksBetween lists Links that will be made among apps and already installed ones.
func linksBetween(cat *catalog.Catalog, apps []app.App, installed []string) []string {
	present := map[string]bool{}
	for _, id := range installed {
		present[id] = true
	}
	for _, a := range apps {
		present[a.Info().ID] = true
	}
	var links []string
	for _, a := range cat.Apps() {
		if !present[a.Info().ID] {
			continue
		}
		for _, l := range a.Links() {
			if !present[l.Target] {
				continue
			}
			isNew := slices.ContainsFunc(apps, func(x app.App) bool { id := x.Info().ID; return id == a.Info().ID || id == l.Target })
			if isNew {
				links = append(links, a.Info().Name+" → "+targetName(cat, l.Target)+": "+l.Title)
			}
		}
	}
	return links
}

func targetName(cat *catalog.Catalog, id string) string {
	if a, found := cat.App(id); found {
		return a.Info().Name
	}
	return id
}

func (m Model) installPlan(p *plan) (Model, tea.Cmd) {
	opts := p.opts
	next, cmd := m.run(Request{Action: ActionInstall, Install: &opts}, "install "+strings.Join(opts.Targets, " "))
	return next.(Model), cmd
}

// installEnded returns to Review, answers kept and the error shown, when
// the approved install ended before it created the Project.
func (m Model) installEnded(finished []int) {
	o := m.onboarding
	if o == nil || o.task == 0 || !slices.Contains(finished, o.task) {
		return
	}
	o.err = ""
	if task := m.tasks.get(o.task); task != nil {
		o.err = task.snapshot().err
	}
	o.task, o.step, o.form = 0, stepReview, nil
}

func (m Model) handleOnboardingKey(msg tea.KeyPressMsg) (tea.Model, tea.Cmd) {
	o := m.onboarding
	if o.form != nil {
		if msg.String() == "esc" && !takesEsc(o.form) {
			return m.openStep(o.step - 1)
		}
		return m.updateOnboardingForm(msg)
	}
	switch msg.String() {
	case "q", "ctrl+c":
		return m.quit()
	case "esc":
		if o.step > stepInitializing {
			return m.openStep(o.step - 1)
		}
	case "r":
		if o.step == stepInitializing && !o.checking {
			o.checking = true
			return m, tea.Batch(m.loadDoctor(), m.startTicking())
		}
	case "enter":
		return m.onboardingNext()
	}
	return m, nil
}

// takesEsc reports that the focused field uses esc itself, as a filtering
// list does to stop filtering.
func takesEsc(f *huh.Form) bool {
	field := f.GetFocusedField()
	if field == nil {
		return false
	}
	for _, b := range field.KeyBinds() {
		if b.Enabled() && slices.Contains(b.Keys(), "esc") {
			return true
		}
	}
	return false
}

func (m Model) onboardingNext() (tea.Model, tea.Cmd) {
	o := m.onboarding
	switch o.step {
	case stepInitializing:
		switch {
		case o.checking:
		case !m.checksDone():
			o.checksFrom = m.frame - len(m.checks)*revealEvery
		case host.Worst(m.checks) == host.Fail, m.defaults == nil:
		default:
			return m.openStep(stepWelcome)
		}
		return m, nil
	case stepReview:
		next, cmd := m.installPlan(o.plan)
		o.task, o.err = next.tasks.lastStarted(), ""
		return next.focusActivity(cmd)
	}
	return m.openStep(o.step + 1)
}

// openStep shows a step; the form steps get a form over the answers so far.
func (m Model) openStep(s step) (tea.Model, tea.Cmd) {
	o := m.onboarding
	o.step, o.form = s, nil
	switch s {
	case stepWhat, stepWhere, stepWho:
		o.form = m.buildForm(s)
		return m, o.form.Init()
	case stepReview:
		o.plan, o.err = m.planFromAnswers(o.answers), ""
	}
	return m, nil
}

func (m Model) updateOnboardingForm(msg tea.Msg) (tea.Model, tea.Cmd) {
	o := m.onboarding
	next, cmd := o.form.Update(msg)
	o.form = next.(*huh.Form)
	switch o.form.State {
	case huh.StateAborted:
		o.step, o.form = stepWelcome, nil
		m.setFlash("back at Welcome; nothing was installed", levelInfo)
		return m, nil
	case huh.StateCompleted:
		return m.openStep(o.step + 1)
	}
	return m, cmd
}

var (
	onboardingContinue = key.NewBinding(key.WithKeys("enter"), key.WithHelp("enter", "continue"))
	onboardingNextKey  = key.NewBinding(key.WithKeys("enter"), key.WithHelp("enter", "next"))
	onboardingApprove  = key.NewBinding(key.WithKeys("enter"), key.WithHelp("enter", "approve"))
	onboardingBack     = key.NewBinding(key.WithKeys("esc"), key.WithHelp("esc", "back"))
	onboardingRecheck  = key.NewBinding(key.WithKeys("r"), key.WithHelp("r", "recheck"))
)

// onboardingBar is the bottom bar's left side and chips for the step.
func (m Model) onboardingBar() (string, []key.Binding) {
	t := m.theme
	quit := barKey(t, "q", "quit")
	switch m.onboarding.step {
	case stepInitializing:
		return quit, []key.Binding{onboardingContinue, onboardingRecheck}
	case stepWhat, stepWhere, stepWho:
		return t.fg(t.accentText).Bold(true).Render("answering") + t.dim().Render(" · keys go to the form"),
			[]key.Binding{onboardingNextKey, onboardingBack}
	case stepReview:
		return quit, []key.Binding{onboardingApprove, onboardingBack}
	}
	return quit, []key.Binding{onboardingContinue, onboardingBack}
}

// renderLoading is the first screen, while the Project, the host checks
// and the detected settings are still being read.
func (m Model) renderLoading() string {
	t := m.theme
	block := lipgloss.JoinVertical(lipgloss.Center,
		t.title().Render("◆")+" "+t.active().Render("self-host"), "",
		t.fg(t.accentText).Render(activity.Spinner(m.frame))+" "+t.dim().Render("Getting ready…"))
	return lipgloss.Place(m.width, m.mainHeight(), lipgloss.Center, lipgloss.Center, block)
}

func (m Model) renderOnboarding() string {
	o := m.onboarding
	lines := []string{"", "  " + renderSteps(m.theme, o.step, m.width-4), ""}
	switch o.step {
	case stepInitializing:
		lines = append(lines, m.renderChecks()...)
	case stepWelcome:
		lines = append(lines, renderWelcome(m.theme)...)
	case stepLook:
		lines = append(lines, renderLook(m.theme)...)
	case stepReview:
		lines = append(lines, m.renderReview()...)
	default:
		if o.form != nil {
			lines = append(lines, lipgloss.NewStyle().PaddingLeft(2).Render(o.form.View()))
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

// renderChecks reveals the host checks one at a time: each spins, then
// shows its result, and a failed or warning check its hint and docs.
func (m Model) renderChecks() []string {
	t := m.theme
	spinner := t.fg(t.accentText).Render(activity.Spinner(m.frame))
	lines := []string{"  " + t.heading().Render("Checking this machine"),
		"  " + t.dim().Render("self-host runs every App with Docker and Docker Compose."), ""}
	if m.onboarding.checking {
		return append(lines, "  "+spinner+" "+t.dim().Render("Checking Docker…"))
	}
	n := m.revealed()
	for i, c := range m.checks {
		if i == n {
			lines = append(lines, "  "+spinner+" "+t.body().Render(c.Title))
			break
		}
		glyph, colour := "✓", t.ok
		switch c.Level {
		case host.Warn:
			glyph, colour = "!", t.warn
		case host.Fail:
			glyph, colour = "✗", t.fail
		}
		lines = append(lines, truncate("  "+t.fg(colour).Render(glyph)+" "+t.body().Render(pad(c.Title, 16))+"  "+t.dim().Render(c.Detail), m.width))
		if c.Level == host.OK {
			continue
		}
		if c.Hint != "" {
			lines = append(lines, truncate("    "+t.fg(t.warn).Render("→ "+c.Hint), m.width))
		}
		if c.Docs != "" {
			lines = append(lines, truncate("    "+t.dim().Render(c.Docs), m.width))
		}
	}
	if !m.checksDone() {
		return lines
	}
	lines = append(lines, "")
	switch {
	case host.Worst(m.checks) == host.Fail:
		return append(lines, "  "+t.fg(t.fail).Render("Fix the failed check above, then press r to check again."),
			"  "+t.dim().Render("Onboarding cannot continue while a check fails."))
	case m.defaults == nil:
		return append(lines, "  "+spinner+" "+t.dim().Render("Reading this machine's settings…"))
	case host.Worst(m.checks) == host.Warn:
		return append(lines, "  "+t.fg(t.ok).Render("✓ This machine is ready.")+t.dim().Render(" Warnings do not stop the install."))
	}
	return append(lines, "  "+t.fg(t.ok).Render("✓ This machine is ready."))
}

func renderWelcome(t theme) []string {
	return []string{
		"  " + t.title().Render("Welcome to self-host"), "",
		"  " + t.body().Render("self-host runs the Apps you pick on this machine with Docker Compose, and"),
		"  " + t.body().Render("sets them up for you: one Admin login, their API keys and the Links"),
		"  " + t.body().Render("between them."), "",
		"  " + t.body().Render("Next you choose what to run, where it lives, who administers it and how"),
		"  " + t.body().Render("it looks. Then you review the plan."), "",
		"  " + t.active().Render("Nothing is written until you approve the plan at Review."),
	}
}

func renderLook(t theme) []string {
	return []string{
		"  " + t.title().Render("How self-host looks"), "",
		"  " + t.body().Render("self-host draws its screens with symbols every terminal shows:"), "",
		"  " + t.fg(t.ok).Render("✓ done") + "   " + t.fg(t.warn).Render("! needs you") + "   " + t.fg(t.fail).Render("✗ failed") +
			"   " + t.fg(t.accentText).Render("⠋ working"),
	}
}

func (m Model) renderReview() []string {
	t := m.theme
	o := m.onboarding
	lines := []string{"  " + t.title().Render("Review") + t.dim().Render("  nothing has been written yet")}
	if o.err != "" {
		lines = append(lines, "", truncate("  "+t.fg(t.fail).Render("✗ "+firstLine(o.err)), m.width),
			"  "+t.dim().Render("Nothing was installed. Change what you need with esc, then approve again."))
	}
	return append(lines, planLines(t, o.plan)...)
}

// renderPlan is the Catalog's review of an install.
func renderPlan(t theme, p *plan, keys string) string {
	lines := []string{"", "  " + t.title().Render("Review") + t.dim().Render("  nothing has been written yet")}
	lines = append(lines, planLines(t, p)...)
	lines = append(lines, "", "  "+t.button("enter")+t.dim().Render(" "+keys))
	return strings.Join(lines, "\n")
}

// planLines are the plan as a table: the Apps with image and port, then
// Exposure, settings, folders, the Admin login and the Links.
func planLines(t theme, p *plan) []string {
	lines := []string{"", "  " + t.dim().Bold(true).Render(pad("APP", 20)+pad("IMAGE", 46)+"PORT")}
	for _, a := range p.apps {
		info := a.Info()
		lines = append(lines, "  "+t.dot("ok")+" "+pad(info.Name, 18)+pad(info.Image, 46)+strconv.Itoa(info.Port))
	}
	lines = append(lines, "")
	row := func(k, v string) string { return "  " + t.dim().Render(pad(k, 10)) + t.body().Render(v) }
	exposure := "local network — other devices connect on " + p.settings["LAN_IP"]
	if p.settings["EXPOSURE"] == service.ExposureLocal {
		exposure = "this machine only — other devices cannot connect"
	}
	lines = append(lines, row("Exposure", exposure))
	if p.fresh {
		lines = append(lines, row("Settings", fmt.Sprintf("TZ=%s PUID=%s PGID=%s", p.settings["TZ"], p.settings["PUID"], p.settings["PGID"])))
		if p.settings["MEDIA_ROOT"] != "" {
			lines = append(lines, row("Folders", "media "+p.settings["MEDIA_ROOT"]+" · downloads "+p.settings["DOWNLOADS_ROOT"]))
		}
		admin := p.opts.AdminUser + " · password generated (see it with: self-host credentials)"
		if p.opts.AdminPassword != "" {
			admin = p.opts.AdminUser + " · •••••••• your own password"
		}
		lines = append(lines, row("Admin", admin))
	}
	if len(p.links) > 0 {
		lines = append(lines, "", "  "+t.heading().Render("Links"))
		for _, l := range p.links {
			lines = append(lines, "  "+t.dim().Render("⇄ ")+t.body().Render(l))
		}
	}
	return lines
}
