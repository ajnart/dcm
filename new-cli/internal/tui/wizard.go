package tui

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"slices"
	"strconv"
	"strings"

	"charm.land/bubbles/v2/progress"
	tea "charm.land/bubbletea/v2"
	"charm.land/huh/v2"
	"charm.land/lipgloss/v2"

	"github.com/ajnart/self-host/internal/app"
	"github.com/ajnart/self-host/internal/catalog"
	"github.com/ajnart/self-host/internal/events"
	"github.com/ajnart/self-host/internal/host"
	"github.com/ajnart/self-host/internal/service"
)

type wizardStage int

const (
	stageWelcome wizardStage = iota
	stageForm
	stageReview
	stageInstalling
)

// wizardValues is shared by pointer so huh's bindings survive Model copies.
type wizardValues struct {
	exposure                 string
	selected                 []string
	tz, lan, puid, pgid      string
	media, downloads         string
	adminUser, adminPassword string
	inputs                   map[string]*string
}

type wizard struct {
	stage  wizardStage
	form   *huh.Form
	values *wizardValues
	plan   *plan
	taskID int
	err    string
}

// plan is a reviewed install: what will happen, before anything is written.
type plan struct {
	apps     []app.App
	opts     service.InstallOptions
	links    []string
	settings map[string]string
	fresh    bool
}

func (m Model) newWizard() *wizard {
	defaults := m.defaults
	v := &wizardValues{
		exposure: service.ExposureLAN, tz: defaults["TZ"], lan: defaults["LAN_IP"],
		puid: defaults["PUID"], pgid: defaults["PGID"],
		media: defaults["MEDIA_ROOT"], downloads: defaults["DOWNLOADS_ROOT"],
		adminUser: "admin", inputs: map[string]*string{},
	}
	return &wizard{values: v}
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
		options = append(options, huh.NewOption(info.Name+" — "+info.Description, "app:"+info.ID).Selected(info.ID == "homarr"))
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

func (m Model) buildWizardForm(w *wizard) *huh.Form {
	v := w.values
	cat := m.backend.Catalog()
	needsMedia := func() bool {
		for _, a := range expand(cat, v.selected) {
			if a.Info().UsesMedia {
				return true
			}
		}
		return false
	}
	groups := []*huh.Group{
		huh.NewGroup(huh.NewSelect[string]().Title("Who should reach your Apps?").
			Description("You can change this later with: self-host config set EXPOSURE=…").
			Options(
				huh.NewOption("My local network — TVs, phones and other computers can connect", service.ExposureLAN),
				huh.NewOption("This machine only — nothing else on the network can connect", service.ExposureLocal),
			).Value(&v.exposure)),
		huh.NewGroup(huh.NewMultiSelect[string]().Title("What do you want to self-host?").
			Description("space or x toggles · / filters · enter continues").
			Options(catalogOptions(cat, nil)...).Filterable(true).Height(14).Value(&v.selected).
			Validate(func(s []string) error {
				if len(s) == 0 {
					return errors.New("pick at least one Recipe or App")
				}
				return nil
			})),
		huh.NewGroup(
			huh.NewInput().Title("Time zone").Value(&v.tz),
			huh.NewInput().Title("LAN address").Description("Shown in App URLs").Value(&v.lan),
			huh.NewInput().Title("User ID (PUID)").Description("Files are owned by this user").Value(&v.puid).Validate(numeric),
			huh.NewInput().Title("Group ID (PGID)").Value(&v.pgid).Validate(numeric),
		).Title("Host settings").Description("Detected from this machine; every App uses them."),
		huh.NewGroup(
			huh.NewInput().Title("Media folder").Description("Movies, shows and music live here").Value(&v.media).Validate(validFolder),
			huh.NewInput().Title("Downloads folder").Value(&v.downloads).Validate(validFolder),
		).WithHideFunc(func() bool { return !needsMedia() }),
		huh.NewGroup(
			huh.NewInput().Title("Admin username").Description("One login for every App").Value(&v.adminUser).
				Validate(func(s string) error {
					if strings.TrimSpace(s) == "" {
						return errors.New("required")
					}
					return nil
				}),
			huh.NewInput().Title("Admin password").Description("Leave empty to generate a strong one").
				EchoMode(huh.EchoModePassword).Value(&v.adminPassword).Validate(validPassword),
		).Title("Admin login"),
	}
	for _, a := range cat.Apps() {
		inputs := a.Inputs()
		if len(inputs) == 0 {
			continue
		}
		id := a.Info().ID
		var fields []huh.Field
		for _, in := range inputs {
			value := in.Default
			if in.Private {
				value = ""
			}
			v.inputs[id+"."+in.Key] = &value
			field := huh.NewInput().Title(in.Prompt).Description(in.Help).Value(&value)
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
	return huh.NewForm(groups...).WithTheme(huh.ThemeFunc(huh.ThemeCharm)).WithShowHelp(true).
		WithWidth(min(max(m.width-8, 40), 100))
}

func numeric(s string) error {
	if _, err := strconv.Atoi(strings.TrimSpace(s)); err != nil {
		return errors.New("a number")
	}
	return nil
}

// planFromWizard turns completed answers into a reviewed install.
func (m Model) planFromWizard(v *wizardValues) *plan {
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

func (m Model) handleWizardKey(msg tea.KeyPressMsg) (tea.Model, tea.Cmd) {
	w := m.wizard
	switch w.stage {
	case stageWelcome:
		switch msg.String() {
		case "q", "ctrl+c":
			return m, tea.Quit
		case "r":
			return m, m.loadDoctor()
		case "enter":
			if host.Worst(m.checks) == host.Fail {
				m.setFlash("fix the failed checks first (r rechecks)", levelError)
				return m, nil
			}
			w.stage, w.err = stageForm, ""
			w.form = m.buildWizardForm(w)
			return m, w.form.Init()
		}
		return m, nil
	case stageReview:
		switch msg.String() {
		case "enter", "y":
			w.stage = stageInstalling
			next, cmd := m.installPlan(w.plan)
			next.wizard.taskID = next.tasks.lastID
			return next, cmd
		case "esc", "n":
			w.stage = stageWelcome
			w.values = m.newWizard().values
			return m, nil
		}
		return m, nil
	case stageInstalling:
		return m, nil
	}
	return m.updateWizardForm(msg)
}

func (m Model) updateWizardForm(msg tea.Msg) (tea.Model, tea.Cmd) {
	w := m.wizard
	if w.form == nil {
		return m, nil
	}
	next, cmd := w.form.Update(msg)
	w.form = next.(*huh.Form)
	switch w.form.State {
	case huh.StateAborted:
		w.stage, w.form = stageWelcome, nil
		w.values = m.newWizard().values
		m.setFlash("setup cancelled; nothing was installed", levelInfo)
		return m, nil
	case huh.StateCompleted:
		w.plan = m.planFromWizard(w.values)
		w.stage, w.form = stageReview, nil
		return m, nil
	}
	return m, cmd
}

func (m Model) renderWizard() string {
	t := m.theme
	w := m.wizard
	switch w.stage {
	case stageWelcome:
		lines := []string{"", "  " + t.title().Render("Welcome to self-host"), "",
			"  " + t.body().Render("Pick Apps or a Recipe, choose who can reach them, and self-host installs and"),
			"  " + t.body().Render("configures everything with Docker Compose. Nothing is written until you review it."), "",
			"  " + t.heading().Render("This machine")}
		if len(m.checks) == 0 {
			lines = append(lines, "  "+t.dim().Render(m.spin.View()+" checking Docker…"))
		}
		for _, c := range m.checks {
			lines = append(lines, "  "+t.dot(string(c.Level))+" "+pad(c.Title, 18)+" "+t.dim().Render(c.Detail))
			if c.Level != host.OK {
				lines = append(lines, "      "+t.fg(t.warn).Render("→ "+c.Hint), "      "+t.dim().Render(c.Docs))
			}
		}
		lines = append(lines, "")
		if host.Worst(m.checks) == host.Fail {
			lines = append(lines, "  "+t.fg(t.fail).Render("Fix the checks above, then press r to check again."))
		} else {
			lines = append(lines, "  "+t.chip("enter", t.accent)+t.dim().Render(" start   r recheck   q quit"))
		}
		return strings.Join(lines, "\n")
	case stageForm:
		if w.form == nil {
			return ""
		}
		return lipgloss.NewStyle().Padding(1, 2).Render(w.form.View())
	case stageReview:
		return m.renderPlan(w.plan, "enter install · esc start over")
	case stageInstalling:
		return m.renderInstalling(w.taskID)
	}
	return ""
}

// renderPlan is shared by the wizard's review and the Install view.
func (m Model) renderPlan(p *plan, keys string) string {
	return renderPlan(m.theme, p, keys)
}

func renderPlan(t theme, p *plan, keys string) string {
	lines := []string{"", "  " + t.title().Render("Review") + t.dim().Render("  nothing has been written yet"), ""}
	lines = append(lines, "  "+t.dim().Bold(true).Render(pad("APP", 20)+pad("IMAGE", 46)+"PORT"))
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
		admin := p.opts.AdminUser + " / generated password (shown with: self-host credentials)"
		if p.opts.AdminPassword != "" {
			admin = p.opts.AdminUser + " / your password"
		}
		lines = append(lines, row("Admin", admin))
	}
	if len(p.links) > 0 {
		lines = append(lines, "", "  "+t.heading().Render("Links"))
		for _, l := range p.links {
			lines = append(lines, "  "+t.dim().Render("⇄ ")+t.body().Render(l))
		}
	}
	lines = append(lines, "", "  "+t.chip("enter", t.accent)+t.dim().Render(" "+keys))
	return strings.Join(lines, "\n")
}

func (m Model) renderInstalling(taskID int) string {
	t := m.theme
	task := m.tasks.get(taskID)
	if task == nil {
		return ""
	}
	s := task.snapshot()
	lines := []string{"", "  " + t.title().Render("Installing") + " " + t.fg(t.accent).Render(m.spin.View()), ""}
	if images := pullImages(s.events); len(images) > 0 {
		bar := progress.New(progress.WithWidth(24), progress.WithoutPercentage(),
			progress.WithFillCharacters('█', '░'))
		for _, img := range images {
			lines = append(lines, "  "+t.body().Render(pad(img.image, 30))+bar.ViewAs(float64(img.percent())/100))
		}
		lines = append(lines, "")
	}
	evs := s.events
	visible := max(m.mainHeight()-6, 5)
	if len(evs) > visible {
		evs = evs[len(evs)-visible:]
	}
	for _, e := range evs {
		if e.Event == events.StepStart || e.Event == events.PullProgress {
			continue
		}
		lines = append(lines, "  "+truncate(formatEvent(t, e), m.width-4))
	}
	return strings.Join(lines, "\n")
}

// installProgress is the share of Apps whose Setup has finished.
func (m Model) installProgress() (int, bool) {
	if m.wizard == nil || m.wizard.stage != stageInstalling || m.wizard.plan == nil {
		return 0, false
	}
	task := m.tasks.get(m.wizard.taskID)
	if task == nil {
		return 0, false
	}
	done := map[string]bool{}
	for _, e := range task.snapshot().events {
		if e.Step == "check" || (e.Step == "setup" && e.Event == events.StepFail) {
			done[e.App] = true
		}
	}
	total := max(len(m.wizard.plan.apps), 1)
	return min(len(done)*100/total, 100), true
}
