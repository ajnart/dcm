package tui

import (
	"context"
	"errors"
	"fmt"
	"slices"
	"strconv"
	"strings"
	"time"

	"charm.land/bubbles/v2/key"
	tea "charm.land/bubbletea/v2"
	"charm.land/huh/v2"
	"charm.land/lipgloss/v2"

	"github.com/ajnart/self-host/internal/activity"
	"github.com/ajnart/self-host/internal/app"
	"github.com/ajnart/self-host/internal/catalog"
	"github.com/ajnart/self-host/internal/host"
	"github.com/ajnart/self-host/internal/project"
	"github.com/ajnart/self-host/internal/service"
	"github.com/ajnart/self-host/internal/telemetry"
)

// step is one step of Onboarding, in order.
type step int

const (
	stepInitializing step = iota
	stepWelcome
	stepWhat
	stepWhere
	stepAccess
	stepWho
	stepLook
	stepReview
)

var stepNames = []string{"Initializing", "Welcome", "What", "Where", "Access", "Who", "Look", "Review"}

// revealEvery is how many frames each host check spins before it shows its result.
const revealEvery = 6

// answers is shared by pointer so huh's bindings survive Model copies and
// every step's form, built afresh each time the step opens, shows them.
type answers struct {
	// exposure is the stored value of the Access chosen: lan, or local from the command line.
	exposure     string
	easyNames    bool
	accessChosen bool
	accessChoice string
	cloudflare   bool
	// experience is the selected Experience level at Welcome:
	// new until the person chooses.
	experience               string
	picks                    picks
	tz, lan, puid, pgid      string
	media, downloads         string
	adminUser, adminPassword string
	inputs                   map[string]*string
}

// onboarding is the person's first run, from the host checks to an approved
// plan. Approving hands over to the Dashboard; onboarding stays until the
// Project exists, so an install that fails before that returns to Review.
type onboarding struct {
	step step
	form *huh.Form
	// list is the What step's Recipes and Apps, before the picked Apps' own inputs in form.
	list    *whatList
	answers *answers
	plan    *plan
	// checking is set while the host checks are being read; checksFrom is
	// the frame they started revealing at.
	checking     bool
	checksFrom   int
	autoContinue bool
	experience   int
	// look is the highlighted choice of the Look step, an index into glyphChoices.
	look int
	// access is the highlighted option of the Access step, an index into accessOptions.
	access int
	// task is the approved install; while it is set Pre-boot or the Dashboard is on screen.
	task int
	err  string
	// folders suggests and lists the folders of the Where step's folder fields.
	folders *folderPicker
	// notice announces Telemetry on the Welcome step, once per Home folder.
	notice string
	// experienceSaved is set when the Profile already holds an Experience
	// level: Welcome does not ask, and Review does not save one.
	experienceSaved bool
	// opened is when Onboarding opened; introSkipped is set when the person
	// skipped the Intro. Both only feed the onboarding Telemetry event.
	opened       time.Time
	introSkipped bool
}

// plan is a reviewed install: what will happen, before anything is written.
type plan struct {
	privateAccess bool
	apps          []app.App
	opts          service.InstallOptions
	links         []string
	settings      map[string]string
	fresh         bool
}

func (m Model) newOnboarding() *onboarding {
	o := &onboarding{answers: &answers{exposure: service.ExposureLAN, adminUser: "admin", inputs: map[string]*string{}},
		checking: len(m.checks) == 0, checksFrom: m.frame, autoContinue: true, notice: m.backend.TelemetryNotice(),
		folders: newFolderPicker(m.backend), opened: m.opts.Now()}
	o.answers.fill(m.defaults)
	o.answers.easyNames = m.defaults["EASY_NAMES"] == "on"
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
	return m.onboardingShown() && m.onboarding.step == stepInitializing &&
		(!m.checksDone() || m.onboarding.autoContinue && m.frame < m.onboarding.checksFrom+(len(m.checks)+1)*revealEvery)
}

func (m Model) advanceInitializing() Model {
	if !m.onboardingShown() || m.onboarding.step != stepInitializing || !m.onboarding.autoContinue ||
		!m.checksDone() || m.defaults == nil || host.Worst(m.checks) == host.Fail ||
		m.frame < m.onboarding.checksFrom+(len(m.checks)+1)*revealEvery {
		return m
	}
	next, _ := m.openStep(stepWelcome)
	return next.(Model)
}

// checksArrived starts revealing the host checks when they are new to Onboarding.
func (m *Model) checksArrived() tea.Cmd {
	if !m.onboardingShown() || !m.onboarding.checking {
		return nil
	}
	m.onboarding.checksFrom, m.onboarding.checking = m.frame, false
	return m.startTicking()
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

// mediaApps are the chosen Apps that keep files in the media and downloads folders.
func mediaApps(cat *catalog.Catalog, p picks) []string {
	var names []string
	for _, a := range p.apps(cat) {
		if a.Info().UsesMedia {
			names = append(names, a.Info().Name)
		}
	}
	return names
}

// buildForm is the form of the What, Where or Who step over the answers so
// far. Each step's own explanation sits above it; the fields explain
// themselves in one line each.
func (m Model) buildForm(s step) *huh.Form {
	v := m.onboarding.answers
	cat := m.backend.Catalog()
	folders := m.onboarding.folders
	media, downloads := folders.input(&v.media), folders.input(&v.downloads)
	var groups []*huh.Group
	height := m.formHeight(s)
	switch s {
	case stepWhat:
		groups = m.inputGroups(cat)
		height-- // huh adds a line for its error
	case stepWhere:
		groups = append(groups,
			huh.NewGroup(
				huh.NewInput().Key(whereLAN).Title("LAN address").Value(&v.lan),
				huh.NewInput().Key(whereTZ).Title("Time zone").Value(&v.tz),
				huh.NewInput().Key(wherePUID).Title("User ID (PUID)").Value(&v.puid).Validate(numeric),
				huh.NewInput().Key(wherePGID).Title("Group ID (PGID)").Value(&v.pgid).Validate(numeric),
			).Title("Host settings").Description("Detected from this machine."),
			huh.NewGroup(
				media.Key(whereMedia).Title("Media folder"),
				downloads.Key(whereDownloads).Title("Downloads folder"),
			).Title("Folders").WithHideFunc(func() bool { return len(mediaApps(cat, v.picks)) == 0 }))
		groups[1].Description("Used by " + strings.Join(mediaApps(cat, v.picks), ", ") + ".")
	case stepWho:
		groups = append(groups, huh.NewGroup(
			huh.NewInput().Title("Admin username").Value(&v.adminUser).
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
	form := huh.NewForm(groups...).WithTheme(huh.ThemeFunc(huh.ThemeCharm)).WithShowHelp(s != stepWhere).WithWidth(m.formWidth())
	if s != stepWhere {
		return form.WithHeight(height)
	}
	media.WithKeyMap(folderKeyMap())
	downloads.WithKeyMap(folderKeyMap())
	// Where's pages are as tall as their own fields, so the explanation of
	// the focused field sits right under them, and scroll only past height.
	for _, g := range groups {
		raw := lipgloss.Height(g.Content())
		if g.Header() != "" {
			raw += lipgloss.Height(g.Header())
		}
		g.WithHeight(min(raw, height))
	}
	return form
}

func (m Model) formWidth() int { return min(max(m.width-8, 40), 100) }

// formHeight is what a form step has left under the step indicator and its
// explanation. The What list shares it with the hovered description, and
// Where keeps room under its form for the explanation of the focused field.
func (m Model) formHeight(s step) int {
	room := m.mainHeight() - 3 - len(m.stepIntro(s)) - 1
	if s == stepWhere {
		room -= whereExplainLines
		if len(mediaApps(m.backend.Catalog(), m.onboarding.answers.picks)) > 0 {
			room -= folderListLines
		}
	}
	return max(room, 6)
}

// stepIntro is why a step asks, in one or two calm sentences.
func (m Model) stepIntro(s step) []string {
	text := ""
	switch s {
	case stepWhat:
		text = "Pick the Apps you want to run, or a Recipe: a ready-made set of Apps that work together. You can add more later from the Catalog."
		if m.onboarding.answers.picks["homarr"] {
			text += " Homarr is preselected as your Apps' home page; unpick its App row to skip it."
		}
	case stepWhere:
		text = "This computer's address on your network, the settings your Apps share and where they keep their files."
	case stepAccess:
		text = "Choose how phones, TVs and laptops will open your Apps. Home network needs nothing to set up. " +
			"You can change this later in Settings, under Access."
	case stepWho:
		text = "One Admin login signs in to every App, so there is only one to remember. Choose a password, or leave it empty: " +
			"self-host generates a strong one, keeps it in your Project and shows it with self-host credentials. " +
			"The password is hidden as you type and never shown again."
	case stepLook:
		text = "self-host can draw its icons with a Nerd Font, a terminal font with extra symbols, or with plain symbols every font has. " +
			"Bars and spinners look the same either way."
	}
	return strings.Split(wrap(text, min(max(m.width-4, 20), 96)), "\n")
}

// The Where fields, by the key each answers to.
const (
	whereLAN       = "lan"
	whereTZ        = "tz"
	wherePUID      = "puid"
	wherePGID      = "pgid"
	whereMedia     = "media"
	whereDownloads = "downloads"
)

// whereExplainLines is the room Where keeps under its form for the
// explanation of the focused field, a blank line and two of text, and for the
// two lines a failed validation adds to the form.
const whereExplainLines = 5

// folderListLines is the room the folder fields add under their explanation
// for the folders inside the typed path.
const folderListLines = 2

// whereExplanations are the one-line explanations of the Where fields that
// do not change with the answers.
var whereExplanations = map[string]string{
	whereLAN:       "App links use this address, so TVs and phones can open them. It only builds links: the Access step decides who can connect.",
	whereTZ:        "The clock your Apps use for schedules and logs, for example Europe/Paris.",
	wherePUID:      "The user ID that owns the files your Apps write, so you can open them. Detected from this machine.",
	wherePGID:      "The group ID that owns those files. Detected from this machine.",
	whereMedia:     "Where movies, shows and music live. The folder must exist or sit inside one that does. " + folderKeysHint,
	whereDownloads: "Where downloads land before they move to media. The folder must exist or sit inside one that does. " + folderKeysHint,
}

// focusedKey is the key of the focused form field, or "" off a form.
func (o *onboarding) focusedKey() string {
	if o.form == nil {
		return ""
	}
	if f := o.form.GetFocusedField(); f != nil {
		return f.GetKey()
	}
	return ""
}

// tabAsEnter makes Tab on a folder field with nothing to complete move on, as
// it does on the other Where fields.
func (o *onboarding) tabAsEnter(msg tea.Msg) tea.Msg {
	press, ok := msg.(tea.KeyPressMsg)
	if !ok || press.Code != tea.KeyTab || press.Mod != 0 {
		return msg
	}
	typed := o.answers.media
	switch o.focusedKey() {
	case whereMedia:
	case whereDownloads:
		typed = o.answers.downloads
	default:
		return msg
	}
	if len(o.folders.suggestions(typed)) > 0 {
		return msg
	}
	return tea.KeyPressMsg{Code: tea.KeyEnter}
}

// helpPage is the page `?` opens: the help page of the highlighted Access
// option, on the Access step. A text input takes `?` itself.
func (o *onboarding) helpPage() (helpPage, bool) {
	if o.step != stepAccess || o.form != nil {
		return helpPage{}, false
	}
	return accessPage(accessOptions[o.access], o.answers.lan), true
}

// whereExplanation explains the focused Where field in the lines it fits.
func (m Model) whereExplanation() []string {
	key := m.onboarding.focusedKey()
	if key == "" {
		return nil
	}
	width := min(max(m.width-4, 20), 96)
	var lines []string
	for _, line := range strings.Split(wrap(whereExplanations[key], width), "\n") {
		lines = append(lines, "  "+m.theme.body().Render(strings.TrimRight(line, " ")))
	}
	lines = append([]string{""}, lines...)
	for _, line := range m.folderListing(key, width) {
		lines = append(lines, "  "+m.theme.dim().Render(line))
	}
	return lines
}

// folderListing lists the folders inside what the focused folder field holds.
func (m Model) folderListing(key string, width int) []string {
	o := m.onboarding
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
func (m Model) whatDetail() []string {
	list := m.onboarding.list
	if list == nil {
		return nil
	}
	rows := m.whatRows(list)
	if list.cursor >= len(rows) {
		return nil
	}
	t := m.theme
	kind, id, _ := strings.Cut(rows[list.cursor].key, ":")
	cat := m.backend.Catalog()
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
	width := max(m.width-4, 20)
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

// inputGroups ask each chosen App's own inputs; an answer survives the
// form being built again when the person comes back.
func (m Model) inputGroups(cat *catalog.Catalog) []*huh.Group {
	v := m.onboarding.answers
	var groups []*huh.Group
	for _, a := range v.picks.apps(cat) {
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
		groups = append(groups, huh.NewGroup(fields...).Title(a.Info().Name).Description(a.Info().Name+" needs a few answers of its own."))
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
	folders := newFolderPicker(m.backend)
	apps := v.picks.apps(cat)
	opts := service.InstallOptions{Exposure: v.exposure, EasyNames: v.easyNames, AdminUser: v.adminUser, AdminPassword: v.adminPassword,
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
		opts.MediaRoot, opts.DownloadsRoot = folders.expand(v.media), folders.expand(v.downloads)
	}
	settings := map[string]string{"TZ": v.tz, "LAN_IP": v.lan, "PUID": v.puid, "PGID": v.pgid, "EXPOSURE": v.exposure}
	if v.easyNames {
		settings["EASY_NAMES"] = "on"
	}
	if needsMedia {
		settings["MEDIA_ROOT"], settings["DOWNLOADS_ROOT"] = folders.expand(v.media), folders.expand(v.downloads)
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
func (m *Model) installEnded(finished []int) {
	o := m.onboarding
	if o == nil || o.task == 0 || !slices.Contains(finished, o.task) {
		return
	}
	o.err = ""
	if task := m.tasks.get(o.task); task != nil {
		o.err = task.snapshot().err
	}
	o.task, o.step, o.form = 0, stepReview, nil
	m.preboot = nil
}

func (m Model) handleOnboardingKey(msg tea.KeyPressMsg) (tea.Model, tea.Cmd) {
	o := m.onboarding
	if key.Matches(msg, m.keys.Help) {
		if _, found := m.contextHelp(); found {
			return m.openHelp()
		}
	}
	if o.list != nil {
		return m.whatKey(msg)
	}
	if o.form != nil {
		if msg.String() == "esc" && !takesEsc(o.form) {
			if o.step == stepAccess {
				return m.openStep(stepAccess)
			}
			if o.step == stepWhat {
				return m.openStep(stepWhat)
			}
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
	case "up", "k":
		switch o.step {
		case stepWelcome:
			if !o.experienceSaved {
				o.experience = max(o.experience-1, 0)
			}
		case stepLook:
			o.look = max(o.look-1, 0)
		case stepAccess:
			o.access = max(o.access-1, 0)
			m.setFlash("", levelInfo)
		}
	case "down", "j":
		switch o.step {
		case stepWelcome:
			if !o.experienceSaved {
				o.experience = min(o.experience+1, len(experienceChoices)-1)
			}
		case stepLook:
			o.look = min(o.look+1, len(glyphChoices)-1)
		case stepAccess:
			o.access = min(o.access+1, len(accessOptions)-1)
			m.setFlash("", levelInfo)
		}
	case "space":
		switch o.step {
		case stepWelcome:
			if !o.experienceSaved {
				o.answers.experience = experienceChoices[o.experience].level
			}
		case stepLook:
			m.glyphs = glyphChoices[o.look].glyphs
		case stepAccess:
			choice := accessOptions[o.access]
			if choice.explainsOnly() {
				m.setFlash(accessNote(choice, o.answers.exposure), levelInfo)
				break
			}
			o.answers.accessChoice, o.answers.accessChosen = choice.id, true
			m.setFlash("", levelInfo)
		}
	case "r":
		if o.step == stepInitializing && !o.checking {
			o.checking = true
			tick := m.startTicking()
			return m, tea.Batch(m.loadDoctor(), tick)
		}
	case "a":
		if o.step == stepReview && o.err != "" {
			return m.openStep(stepAccess)
		}
	case "w":
		if o.step == stepReview && o.err != "" {
			return m.openStep(stepWhere)
		}
	case "c":
		if o.step == stepReview && o.err != "" {
			return m, copyError(o.err)
		}
	case "e":
		if o.step == stepReview && o.err != "" {
			return m.openError(o.err)
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
	case stepAccess:
		choice, found := accessByID(o.answers.accessChoice)
		if !found {
			choice = accessOptions[0]
		}
		if choice.id == "tailscale" {
			if _, found := m.backend.Catalog().App("tailscale"); !found {
				m.setFlash("Tailscale is not in this Catalog", levelWarn)
				return m, nil
			}
			o.answers.picks["tailscale"] = true
			value := o.answers.inputs["tailscale.auth_key"]
			if value == nil {
				value = new(string)
				o.answers.inputs["tailscale.auth_key"] = value
			}
			input := huh.NewInput().Title("Tailscale auth key").Description("First enable HTTPS at login.tailscale.com/admin/dns: App names appear in a public certificate log. Then make a reusable, pre-approved key at login.tailscale.com/admin/settings/keys. Paste it only here, never into chat.").Value(value).EchoMode(huh.EchoModePassword).Validate(func(s string) error {
				if strings.TrimSpace(s) == "" {
					return errors.New("required")
				}
				return nil
			})
			o.form = huh.NewForm(huh.NewGroup(input)).WithWidth(m.formWidth()).WithHeight(m.formHeight(stepAccess))
			return m, o.form.Init()
		}
		if choice.explainsOnly() {
			m.setFlash(accessNote(choice, o.answers.exposure), levelInfo)
			return m, nil
		}
		if choice.id == "cloudflare" {
			o.answers.cloudflare = true
			m.setFlash("Choose your web addresses in Settings after the Apps are installed; nothing goes public yet", levelInfo)
			return m.openStep(stepWho)
		}
		o.answers.cloudflare = false
		o.answers.exposure = choice.value
		o.answers.easyNames, o.answers.accessChosen = choice.id == "names", true
		delete(o.answers.picks, "tailscale")
	case stepLook:
		return m.openStep(stepReview)
	case stepReview:
		if check := m.reviewNamesCheck(); !check.Available {
			o.err = check.Message
			return m, nil
		}
		if !m.opts.ReducedMotion {
			m.preboot = newPrebootScreen()
		}
		next, cmd := m.installPlan(o.plan)
		o.task, o.err = next.tasks.latest().id, ""
		cmds := []tea.Cmd{cmd, saveGlyphsWithInstall(m.backend, m.glyphs), m.reportOnboarding()}
		if !o.experienceSaved {
			cmds = append(cmds, saveExperienceWithInstall(m.backend, o.answers.experience))
		}
		return next.focusActivity(tea.Batch(cmds...))
	}
	return m.openStep(o.step + 1)
}

// openStep shows a step; the form steps get a form over the answers so far.
func (m Model) openStep(s step) (tea.Model, tea.Cmd) {
	o := m.onboarding
	o.step, o.form, o.list = s, nil, nil
	switch s {
	case stepWelcome:
		o.autoContinue = false
		o.experienceSaved = m.backend.Experience(context.Background()) != ""
		if o.answers.experience == "" {
			o.answers.experience = project.ExperienceNew
		}
		o.experience = max(slices.IndexFunc(experienceChoices, func(c experienceChoice) bool { return c.level == o.answers.experience }), 0)
	case stepWhat:
		if o.answers.picks == nil {
			o.answers.picks = picks{}
			if _, found := m.backend.Catalog().App("homarr"); found {
				o.answers.picks["homarr"] = true
			}
		}
		o.list = m.newWhatList()
	case stepWhere, stepWho:
		o.form = m.buildForm(s)
		return m, o.form.Init()
	case stepAccess:
		o.access = max(slices.IndexFunc(accessOptions, func(a accessOption) bool { return a.value == o.answers.exposure }), 0)
		if o.answers.easyNames {
			o.access = 1
		}
		if o.answers.cloudflare {
			o.access = slices.IndexFunc(accessOptions, func(a accessOption) bool { return a.id == "cloudflare" })
		}
		if o.answers.picks["tailscale"] {
			o.access = slices.IndexFunc(accessOptions, func(a accessOption) bool { return a.id == "tailscale" })
		}
		if o.answers.accessChoice != "" {
			o.access = max(slices.IndexFunc(accessOptions, func(a accessOption) bool { return a.id == o.answers.accessChoice }), 0)
		}
		o.answers.accessChoice = accessOptions[o.access].id
	case stepLook:
		o.look = slices.IndexFunc(glyphChoices, func(c glyphChoice) bool { return c.glyphs == m.glyphs })
		o.look = max(o.look, 0)
	case stepReview:
		o.plan, o.err = m.planFromAnswers(o.answers), ""
		if check := m.reviewNamesCheck(); !check.Available {
			o.err = check.Message
		}
	}
	return m, nil
}

func (m Model) reviewNamesCheck() service.NamesCheck {
	if m.onboarding.plan != nil && m.onboarding.plan.opts.EasyNames {
		return service.EasyNamesAddressCheck(m.onboarding.plan.opts.Settings["LAN_IP"])
	}
	return service.NamesCheck{Available: true}
}

// reportOnboarding sends the onboarding Telemetry event of the approved Review.
func (m Model) reportOnboarding() tea.Cmd {
	o := m.onboarding
	experience := o.answers.experience
	if o.experienceSaved {
		experience = m.backend.Experience(context.Background())
	}
	doctor := "ok"
	if host.Worst(m.checks) == host.Warn {
		doctor = "warn"
	}
	report := telemetry.Onboarding{
		Experience:   experience,
		Glyphs:       string(activity.ParseGlyphs(string(m.glyphs))),
		IntroSkipped: o.introSkipped,
		Doctor:       doctor,
		Duration:     m.opts.Now().Sub(o.opened),
	}
	backend := m.backend
	return func() tea.Msg {
		backend.ReportOnboarding(report)
		return nil
	}
}

// saveGlyphsWithInstall saves the glyph set with the Project in step with
// the install that creates it. A failure only warns, and the install goes on.
func saveGlyphsWithInstall(backend Backend, g activity.Glyphs) tea.Cmd {
	return func() tea.Msg {
		if err := backend.SetGlyphs(context.Background(), g); err != nil {
			return flashMsg{text: "! could not save the icons choice (" + firstLine(err.Error()) + "); change it later in Settings", level: levelWarn}
		}
		return nil
	}
}

// saveExperienceWithInstall saves the Experience level in the Profile in step
// with the install. A failure only warns, and the install goes on.
func saveExperienceWithInstall(backend Backend, level string) tea.Cmd {
	return func() tea.Msg {
		if err := backend.SetExperience(context.Background(), level); err != nil {
			return flashMsg{text: "! could not save your Experience level (" + firstLine(err.Error()) + "); change it later with self-host profile", level: levelWarn}
		}
		return nil
	}
}

func (m Model) backToWelcome() (tea.Model, tea.Cmd) {
	m.onboarding.step, m.onboarding.form, m.onboarding.list = stepWelcome, nil, nil
	m.setFlash("back at Welcome; nothing was installed", levelInfo)
	return m, nil
}

func (m Model) updateOnboardingForm(msg tea.Msg) (tea.Model, tea.Cmd) {
	o := m.onboarding
	msg = o.tabAsEnter(msg)
	next, cmd := o.form.Update(msg)
	o.form = next.(*huh.Form)
	switch o.form.State {
	case huh.StateAborted:
		return m.backToWelcome()
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
	onboardingChoose   = key.NewBinding(key.WithKeys("up", "down"), key.WithHelp("↑/↓", "focus"))
	onboardingSelect   = key.NewBinding(key.WithKeys("space"), key.WithHelp("space", "select"))
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
		chips := []key.Binding{onboardingNextKey, onboardingBack}
		if _, found := m.contextHelp(); found {
			chips = append(chips, moreKey)
		}
		return t.fg(t.accentText).Bold(true).Render("answering") + t.dim().Render(" · keys go to the form"), chips
	case stepAccess:
		if m.onboarding.form != nil {
			return t.fg(t.accentText).Bold(true).Render("answering"), []key.Binding{onboardingNextKey, onboardingBack}
		}
		return quit, []key.Binding{onboardingChoose, onboardingSelect, onboardingContinue, onboardingBack, moreKey}
	case stepWelcome:
		if m.onboarding.experienceSaved {
			return quit, []key.Binding{onboardingContinue, onboardingBack}
		}
		return quit, []key.Binding{onboardingChoose, onboardingSelect, onboardingContinue, onboardingBack}
	case stepLook:
		return quit, []key.Binding{onboardingChoose, onboardingSelect, onboardingContinue, onboardingBack}
	case stepReview:
		if m.onboarding.err != "" {
			chips := []key.Binding{hint("c", "copy error"), hint("e", "full error"), hint("a", "Access"), hint("w", "LAN address")}
			if m.reviewNamesCheck().Available {
				chips = append(chips, onboardingApprove)
			}
			return quit, append(chips, onboardingBack)
		}
		return quit, []key.Binding{onboardingApprove, onboardingBack}
	}
	return quit, []key.Binding{onboardingContinue, onboardingBack}
}

// renderLoading is the first screen, while the Project, the host checks
// and the detected settings are still being read.
func (m Model) renderLoading() string {
	t := m.theme
	block := lipgloss.JoinVertical(lipgloss.Center,
		t.title().Render(m.glyphs.Brand())+" "+t.active().Render("self-host"), "",
		t.fg(t.accentText).Render(activity.Spinner(m.frame))+" "+t.dim().Render("Getting ready…"))
	return lipgloss.Place(m.width, m.mainHeight(), lipgloss.Center, lipgloss.Center, block)
}

func (m Model) renderOnboarding() string {
	o := m.onboarding
	lines := []string{"", "  " + renderSteps(m.theme, o.step, m.width-4), ""}
	switch o.step {
	case stepInitializing, stepWelcome:
		body := m.renderChecks()
		if o.step == stepWelcome {
			body = m.renderWelcome()
		}
		room := max(m.mainHeight()-len(lines), 1)
		if o.step == stepInitializing {
			width := min(max(m.width-4, 1), 96)
			for i, line := range body {
				body[i] = truncate(strings.TrimPrefix(line, "  "), width)
			}
			block := fit(strings.Join(body, "\n"), width, min(room, 18))
			return strings.Join(lines, "\n") + "\n" + lipgloss.Place(m.width, room, lipgloss.Center, lipgloss.Center, block)
		}
		for i := len(body) - 1; i >= 0 && len(body) > room; i-- {
			if strings.TrimSpace(body[i]) == "" {
				body = slices.Delete(body, i, i+1)
			}
		}
		for i, line := range body {
			body[i] = truncate(strings.TrimRight(strings.TrimPrefix(line, "  "), " "), max(m.width-4, 1))
		}
		block := strings.Join(body, "\n")
		block = fit(block, lipgloss.Width(block), lipgloss.Height(block))
		return strings.Join(lines, "\n") + "\n" + lipgloss.Place(m.width, room, lipgloss.Center, lipgloss.Center, block)
	case stepAccess:
		if o.form != nil {
			lines = append(lines, lipgloss.NewStyle().PaddingLeft(2).Render(o.form.View()))
		} else {
			lines = append(lines, m.renderAccess()...)
		}
	case stepLook:
		lines = append(lines, m.renderLook()...)
	case stepReview:
		lines = append(lines, m.renderReview()...)
	default:
		for _, line := range m.stepIntro(o.step) {
			lines = append(lines, "  "+m.theme.body().Render(line))
		}
		lines = append(lines, "")
		if o.form != nil {
			form := lipgloss.NewStyle().PaddingLeft(2).Render(o.form.View())
			lines = append(lines, form)
			if o.step == stepWhere {
				lines = append(lines, m.whereExplanation()...)
			}
		}
		if o.list != nil {
			lines = append(lines, m.renderWhatList()...)
			lines = append(lines, "")
			lines = append(lines, m.whatDetail()...)
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
		hint, docs := "", ""
		if c.Level != host.OK {
			if c.Hint != "" {
				hint = "    " + t.fg(t.warn).Render("→ "+c.Hint)
			}
			if c.Docs != "" {
				docs = "    " + t.dim().Render(c.Docs)
			}
		}
		lines = append(lines, hint, docs)
	}
	if !m.checksDone() {
		return lines
	}
	for len(lines) < 16 {
		lines = append(lines, "")
	}
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

func (m Model) renderWelcome() []string {
	t := m.theme
	lines := []string{"  " + t.title().Render("Welcome to self-host"), ""}
	paragraph := func(text string, style lipgloss.Style) {
		for _, line := range strings.Split(wrap(text, min(max(m.width-4, 1), 76)), "\n") {
			lines = append(lines, "  "+style.Render(strings.TrimRight(line, " ")))
		}
	}
	paragraph("self-host runs the Apps you pick on this machine with Docker Compose, and sets them up for you: one Admin login, their API keys and the Links between them.", t.body())
	lines = append(lines, "")
	paragraph("Next you choose what to run, where it lives, who administers it and how it looks. Then you review the plan.", t.body())
	lines = append(lines, "")
	if !m.onboarding.experienceSaved {
		paragraph(experienceQuestion, t.heading())
		for i, c := range experienceChoices {
			lines = append(lines, "  "+truncate(radioRow(t, i == m.onboarding.experience, c.level == m.onboarding.answers.experience, c.label), m.width-2))
		}
		lines = append(lines, "")
	}
	paragraph("Nothing is written until you approve the plan at Review.", t.active())
	if m.onboarding.notice != "" {
		lines = append(lines, "")
		for _, line := range strings.Split(m.onboarding.notice, "\n") {
			lines = append(lines, "  "+t.dim().Render(truncate(line, m.width-4)))
		}
	}
	return lines
}

const experienceQuestion = "Have you run your own server or used Docker before, or is this all new to you?"

type experienceChoice struct{ level, label string }

var experienceChoices = []experienceChoice{
	{project.ExperienceNew, "New: this is all new to me"},
	{project.ExperienceAdvanced, "Advanced: I have run a server or used Docker"},
}

func (m Model) renderLook() []string {
	t := m.theme
	o := m.onboarding
	lines := []string{"  " + t.title().Render("How self-host looks")}
	for _, line := range m.stepIntro(stepLook) {
		lines = append(lines, "  "+t.body().Render(line))
	}
	lines = append(lines, "", truncate("  "+glyphSample(t, m.glyphs), m.width), "",
		"  "+t.heading().Render("Choose your symbols; the sample shows your selection."))
	answers := []string{"Nerd Font: use extra font icons", "Simple (default): use plain symbols"}
	for i, choice := range glyphChoices {
		lines = append(lines, "  "+truncate(radioRow(t, i == o.look, choice.glyphs == m.glyphs, answers[i]), m.width-2))
	}
	return append(lines, "", "  "+nerdFontsLine(t))
}

// renderAccess asks how the Apps will be opened: the options, with the
// explanation and diagram of the highlighted one under them.
func (m Model) renderAccess() []string {
	t := m.theme
	o := m.onboarding
	head := []string{"  " + t.title().Render("How you'll open your Apps")}
	for _, line := range m.stepIntro(stepAccess) {
		head = append(head, "  "+t.body().Render(line))
	}
	var options []string
	for i, option := range accessOptions {
		selected := option.id == o.answers.accessChoice
		options = append(options, "  "+truncate(radioRow(t, i == o.access, selected, accessLabel(t, option)), m.width-2))
	}
	const above = 3 // the blank line, the step indicator and a blank line
	width := min(max(m.width-4, 20), 96)
	block := func(lines []string) []string {
		room := m.mainHeight() - above - len(lines)
		return accessBlock(t, accessOptions[o.access], o.answers.exposure, o.answers.lan, width, room)
	}
	spaced := slices.Concat(head, []string{""}, options)
	packed := slices.Concat(head, options)
	if len(block(packed)) > len(block(spaced)) {
		return append(packed, block(packed)...)
	}
	return append(spaced, block(spaced)...)
}

func (m Model) renderReview() []string {
	t := m.theme
	o := m.onboarding
	lines := []string{"  " + t.title().Render("Review") + t.dim().Render("  nothing has been written yet")}
	if o.err != "" {
		lines = append(lines, "")
		preview := strings.Split(wrap("✗ "+o.err, max(m.width-4, 20)), "\n")
		for _, line := range preview[:min(len(preview), 4)] {
			lines = append(lines, "  "+t.fg(t.fail).Render(line))
		}
		lines = append(lines, "  "+t.dim().Render("c copies · e full error · a Access · w LAN address. Nothing installed."))
		if m.reviewNamesCheck().Available {
			lines = append(lines, "  "+t.dim().Render("Enter approves another attempt; esc goes back."))
		} else {
			lines = append(lines, "  "+t.dim().Render("Change Access or the LAN address before approval."))
		}
	}
	lines = append(lines, planLines(t, o.plan)...)
	if o.answers.cloudflare {
		lines = append(lines, "", "  "+t.body().Render("Your own web address: choose Apps in Settings after install; nothing public yet"))
	}
	return lines
}

// renderPlan is the Catalog's review of an install.
func renderPlan(t theme, p *plan, keys string) string {
	lines := []string{"", "  " + t.title().Render("Review") + t.dim().Render("  nothing has been written yet")}
	lines = append(lines, planLines(t, p)...)
	lines = append(lines, "", "  "+t.button("enter")+t.dim().Render(" "+keys))
	return strings.Join(lines, "\n")
}

// planLines are the plan as a table: the Apps with image and port, then
// Access, settings, folders, the Admin login and the Links.
func planLines(t theme, p *plan) []string {
	lines := []string{"", "  " + t.dim().Bold(true).Render(pad("APP", 20)+pad("IMAGE", 46)+"PORT")}
	for _, a := range p.apps {
		info := a.Info()
		lines = append(lines, "  "+t.dot("ok")+" "+pad(info.Name, 18)+pad(info.Image, 46)+strconv.Itoa(info.Port))
	}
	lines = append(lines, "")
	row := func(k, v string) string { return "  " + t.dim().Render(pad(k, 10)) + t.body().Render(v) }
	access := "Home network — addresses use " + p.settings["LAN_IP"]
	if p.opts.EasyNames {
		access = "Easy names at home · addresses with numbers kept"
	}
	if p.settings["EXPOSURE"] == service.ExposureLocal {
		access = "This computer only — other devices cannot connect"
	}
	lines = append(lines, row("Access", access))
	if !p.opts.EasyNames && p.settings["EXPOSURE"] != service.ExposureLocal {
		lines = append(lines, row("", "Reachability is not verified; check from another device."))
	}
	if slices.Contains(p.opts.Targets, "tailscale") {
		lines = append(lines, row("", "From anywhere, privately, with Tailscale"))
	}
	if p.privateAccess {
		for _, a := range p.apps {
			info := a.Info()
			if info.Port > 0 && !info.NoWebUI {
				lines = append(lines, row("", "Private: "+info.Name+" (only missing nodes while Tailscale is on)"))
			}
		}
	}
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
