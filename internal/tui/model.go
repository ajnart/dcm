// Package tui is the Dashboard: a tabbed command center (Overview, Apps,
// Activity, Catalog, Settings) over one Project. It owns no logic of its
// own; every Action goes through the Backend, the same Service the CLI uses.
package tui

import (
	"context"
	"errors"
	"strconv"
	"strings"
	"time"

	"charm.land/bubbles/v2/key"
	tea "charm.land/bubbletea/v2"

	"github.com/ajnart/self-host/internal/activity"
	"github.com/ajnart/self-host/internal/host"
	"github.com/ajnart/self-host/internal/release"
	"github.com/ajnart/self-host/internal/service"
)

type level int

const (
	levelInfo level = iota
	levelOK
	levelWarn
	levelError
)

const (
	refreshEvery      = 5 * time.Second
	checkUpdatesEvery = 30 * time.Minute
)

// Messages.
type (
	statusMsg struct {
		status        service.Status
		err           error
		finishedTasks []int
	}
	defaultsMsg struct{ settings map[string]string }
	doctorMsg   struct{ checks []host.Check }
	updatesMsg  struct{ updates map[string]string }
	updatesTick struct{}
	releaseMsg  struct{ version, skipped string }
	reviewMsg   struct {
		rows []service.SettingReview
		err  error
	}
	containersMsg struct {
		containers []service.ContainerStatus
		err        error
	}
	tickMsg time.Time
	// frameMsg advances the animation by one frame.
	frameMsg    struct{}
	taskDoneMsg struct {
		id     int
		title  string
		action Action
		err    error
	}
	logChunkMsg struct {
		stream *logStream
		text   string
		done   bool
	}
	usageMsg struct {
		stream *usageStream
		usage  []service.ContainerUsage
		done   bool
	}
	composeMsg struct {
		id, text string
		err      error
	}
	clickMsg     struct{ id string }
	clipboardMsg struct{ text, what string }
	// appearanceMsg carries the Project's glyph set.
	appearanceMsg struct{ glyphs activity.Glyphs }
	flashMsg      struct {
		text  string
		level level
	}
)

type Options struct {
	Version string
	// NoColor is NO_COLOR: the pre-boot screen keeps its motion without colour.
	NoColor bool
	// NoUpdatePrompt keeps the "Update now?" question away, for CI and
	// SELF_HOST_NO_UPDATE_CHECK; the header still shows a newer release.
	NoUpdatePrompt bool
	// Now is the clock shown in the header; tests pin it.
	Now func() time.Time
}

// Model keeps the state every view shares and the active tab. Each view
// owns its own state and its own key handling; the Model handles the global
// keys.
type Model struct {
	backend Backend
	opts    Options

	width, height int
	theme         theme
	glyphs        activity.Glyphs
	keys          keyMap

	// frame is the animation frame; it advances only while ticking, which
	// lasts while something runs or a transition still plays.
	frame   int
	ticking bool
	tracker *activity.Tracker

	status    service.Status
	checks    []host.Check
	updates   map[string]string
	updatesAt time.Time
	latest    string
	loaded    bool
	statusErr string
	refreshed time.Time
	// releaseChecked is whether the release check found the newest release.
	releaseChecked bool

	// upgrade is the prompt to install a newer release; skipped is the release
	// the person last declined, offered once per session; restart is set
	// once an update installed, so Run starts the new binary after quitting.
	upgrade   *updatePrompt
	skipped   string
	offered   bool
	restart   bool
	updatedTo string

	containers    []service.ContainerStatus
	containersErr string

	defaults map[string]string

	tasks *taskManager

	flash      string
	flashLevel level
	// resultFlash is the flash that reports the last Action's result, which
	// the Overview's Now strip shows instead of the status line.
	resultFlash string
	// flashHeld keeps a flash a key just set on the status line over the
	// running Action's progress until the next key.
	flashHeld bool

	surface   surface
	showHelp  bool
	quitting  bool
	dashboard *dashboardView
	install   *installView
	settings  *settingsView
	apps      *appsView
	activity  *activityView
	helpView  *helpView
	menu      *actionMenu

	// onboarding is set from the first run until the Project exists.
	onboarding             *onboarding
	cloudflareAfterInstall bool
	// preboot is set while the first install's pre-boot screen is on screen.
	preboot *prebootScreen
}

func New(backend Backend, opts Options) Model {
	if opts.Now == nil {
		opts.Now = time.Now
	}
	apps := newAppsView()
	return Model{
		backend:   backend,
		opts:      opts,
		theme:     newTheme(true),
		glyphs:    activity.Simple,
		keys:      newKeyMap(),
		ticking:   true,
		tracker:   &activity.Tracker{},
		tasks:     &taskManager{},
		apps:      apps,
		dashboard: newDashboardView(apps),
		helpView:  newHelpView(),
	}
}

func (m Model) Init() tea.Cmd {
	return tea.Batch(tea.RequestBackgroundColor, m.loadStatus(), m.loadDoctor(), m.loadRelease(), m.loadGlyphs(), m.frameTick(), tick(),
		tea.Tick(3*time.Second, func(time.Time) tea.Msg { return updatesTick{} }))
}

func tick() tea.Cmd {
	return tea.Tick(refreshEvery, func(t time.Time) tea.Msg { return tickMsg(t) })
}

func (m Model) frameTick() tea.Cmd {
	return tea.Tick(m.framePeriod(), func(time.Time) tea.Msg { return frameMsg{} })
}

// startTicking runs the frame ticker unless it already runs.
func (m *Model) startTicking() tea.Cmd {
	if m.ticking {
		return nil
	}
	m.ticking = true
	return m.frameTick()
}

// nextFrame advances the animation and keeps ticking only while the Project
// is still being read, Onboarding reveals the host checks, pre-boot plays, an
// Action runs or a transition still plays.
func (m Model) nextFrame() (tea.Model, tea.Cmd) {
	activityFrame := m.preboot == nil || m.preboot.frame%prebootFramesPerActivity == 0
	if activityFrame {
		m.frame++
	}
	s := m.ctx().snapshot()
	if activityFrame {
		m.tracker.Observe(s, m.frame)
	}
	m = m.advancePreboot(s)
	m = m.advanceInitializing()
	if m.preboot != nil || !m.loaded || m.onboardingAnimating() || m.tasks.running() > 0 || activity.Animating(s, m.tracker.Motion(m.frame)) {
		return m, m.frameTick()
	}
	m.ticking = false
	return m, nil
}

func (m Model) loadStatus() tea.Cmd {
	backend := m.backend
	tasks := m.tasks
	return func() tea.Msg {
		ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
		defer cancel()
		finished := tasks.terminalIDs()
		status, err := backend.Status(ctx)
		return statusMsg{status: status, err: err, finishedTasks: finished}
	}
}

// loadRelease looks up the newest release in the background; failures are silent.
func (m Model) loadRelease() tea.Cmd {
	backend := m.backend
	return func() tea.Msg {
		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		return releaseMsg{version: backend.LatestRelease(ctx), skipped: backend.SkippedUpdate()}
	}
}

// releaseNotice tells the user how to install the newer release.
func (m Model) releaseNotice() string {
	return releaseNotice(m.latest)
}

func (m Model) loadGlyphs() tea.Cmd {
	backend := m.backend
	return func() tea.Msg { return appearanceMsg{glyphs: backend.Glyphs(context.Background())} }
}

func (m Model) loadUpdates() tea.Cmd {
	backend, status := m.backend, m.status
	return func() tea.Msg {
		return updatesMsg{updates: backend.Updates(context.Background(), status)}
	}
}

// applyUpdates copies known update states onto the status rows.
func (m *Model) applyUpdates() {
	for i := range m.status.Apps {
		if state, found := m.updates[m.status.Apps[i].ID]; found {
			m.status.Apps[i].Update = state
		}
	}
}

func (m Model) loadDefaults() tea.Cmd {
	backend := m.backend
	return func() tea.Msg { return defaultsMsg{settings: backend.Detect(context.Background())} }
}

func (m Model) loadDoctor() tea.Cmd {
	backend := m.backend
	return func() tea.Msg {
		ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
		defer cancel()
		return doctorMsg{checks: backend.Doctor(ctx)}
	}
}

func (m Model) loadContainers() tea.Cmd {
	backend := m.backend
	return func() tea.Msg {
		ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
		defer cancel()
		containers, err := backend.Containers(ctx)
		return containersMsg{containers: containers, err: err}
	}
}

func (m Model) loadReview() tea.Cmd {
	backend := m.backend
	return func() tea.Msg {
		rows, err := backend.ReviewSettings(context.Background())
		return reviewMsg{rows: rows, err: err}
	}
}

func (m *Model) setFlash(text string, l level) {
	m.flash, m.flashLevel = text, l
}

func (m Model) mainHeight() int { return max(m.height-3, 3) }

// ctx is the read/ask view of the Model handed to the active view. It builds
// the Activity snapshot once, for everything that reads it.
func (m Model) ctx() *viewContext {
	return &viewContext{
		width: m.width, height: m.height, theme: m.theme, glyphs: m.glyphs,
		keys: m.keys, motion: m.tracker.Motion(m.frame),
		status: m.status, checks: m.checks, updates: m.updates, updatesAt: m.updatesAt, latest: m.latest,
		releaseChecked: m.releaseChecked, version: m.opts.Version,
		containers: m.containers, containersErr: m.containersErr,
		backend: m.backend, tasks: m.tasks,
		flash: m.flash, flashLevel: m.flashLevel,
		shared: true,
	}
}

// absorb copies what a view may have changed back onto the Model: the glyph
// set it chose and the flash it set.
func (m *Model) absorb(ctx *viewContext) {
	m.glyphs = ctx.glyphs
	m.flashHeld = m.flashHeld || ctx.flashed
	m.flash, m.flashLevel = ctx.flash, ctx.flashLevel
}

func (m Model) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	next, cmd := m.update(msg)
	m = next.(Model).offerUpdate()
	return m, tea.Batch(cmd, m.syncLogs(), m.syncUsage())
}

// syncLogs follows the selected App's logs while the Apps tab shows them and
// stops following as soon as they leave the screen.
func (m Model) syncLogs() tea.Cmd {
	details := m.apps.details
	shown := m.surface == surfaceApps && details.tab == tabLogs && m.loaded && m.statusErr == "" && !m.onboardingShown() && !m.quitting
	if !shown {
		details.stopLogs()
		return nil
	}
	ctxView := m.ctx()
	app, found := m.apps.selected(ctxView)
	if !found {
		details.stopLogs()
		return nil
	}
	return details.syncLogs(ctxView, app.ID)
}

// syncUsage follows the containers' load while the Apps tab shows its
// containers sub-tab and stops as soon as it leaves the screen.
func (m Model) syncUsage() tea.Cmd {
	details := m.apps.details
	shown := m.surface == surfaceApps && details.tab == tabContainers && m.loaded && m.statusErr == "" && !m.onboardingShown() && !m.quitting
	if !shown {
		details.stopUsage()
		return nil
	}
	if _, found := m.apps.selected(m.ctx()); !found {
		details.stopUsage()
		return nil
	}
	return details.syncUsage(m.ctx())
}

func (m Model) update(msg tea.Msg) (tea.Model, tea.Cmd) {
	switch msg := msg.(type) {
	case tea.WindowSizeMsg:
		m.width, m.height = msg.Width, msg.Height
		m.relayout()
		return m, nil

	case tea.BackgroundColorMsg:
		m.theme = newTheme(msg.IsDark())
		m.relayout()
		return m, nil

	case tea.FocusMsg:
		var frame tea.Cmd
		if m.onboardingShown() && m.onboarding.step == stepInitializing {
			m.onboarding.checking = true
			frame = m.startTicking()
		}
		return m, tea.Batch(m.loadStatus(), m.loadDoctor(), frame)

	case tickMsg:
		return m, tea.Batch(m.loadStatus(), tick())

	case defaultsMsg:
		m.defaults = msg.settings
		if m.onboarding != nil {
			m.onboarding.answers.fill(m.defaults)
			if !m.onboarding.answers.accessChosen {
				m.onboarding.answers.easyNames = m.defaults["EASY_NAMES"] == "on"
				m.onboarding.answers.accessChoice = ""
			}
		}
		return m.advanceInitializing(), nil

	case statusMsg:
		return m.handleStatus(msg)

	case doctorMsg:
		m.checks = msg.checks
		m.relayout()
		cmd := m.checksArrived()
		return m, cmd

	case updatesTick:
		return m, tea.Batch(m.loadUpdates(), tea.Tick(checkUpdatesEvery, func(time.Time) tea.Msg { return updatesTick{} }))

	case updatesMsg:
		m.updates = msg.updates
		m.updatesAt = m.opts.Now()
		m.applyUpdates()
		m.relayout()
		return m, nil

	case updateDoneMsg:
		return m.handleUpdateDone(msg)

	case releaseMsg:
		m.releaseChecked = msg.version != ""
		m.skipped = msg.skipped
		if newer, err := release.Newer(m.opts.Version, msg.version); err == nil && newer {
			m.latest = msg.version
			if m.flash == "" {
				m.setFlash(m.releaseNotice(), levelInfo)
			}
		}
		return m, nil

	case frameMsg:
		return m.nextFrame()

	case taskDoneMsg:
		return m.handleTaskDone(msg)

	case logChunkMsg, composeMsg, usageMsg:
		return m.dispatchApps(msg)

	case backupsMsg, backupAppsMsg:
		return m.dispatchSettings(msg)

	case reviewMsg:
		if m.settings != nil {
			m.settings.apply(msg.rows, msg.err)
		}
		return m, nil

	case containersMsg:
		m.containers, m.containersErr = msg.containers, ""
		if msg.err != nil {
			m.containersErr = msg.err.Error()
		}
		m.relayout()
		return m, nil

	case clickMsg:
		return m.handleClick(msg.id)

	case appearanceMsg:
		m.glyphs = msg.glyphs
		return m, nil

	case clipboardMsg:
		m.setFlash("copied "+msg.what, levelOK)
		return m, tea.SetClipboard(msg.text)
	case copyOptionsMsg:
		return m.dispatchApps(msg)

	case toolDoneMsg:
		if msg.err != nil {
			m.setFlash(msg.name+" exited with an error: "+msg.err.Error(), levelError)
		} else {
			m.setFlash("back from "+msg.name, levelInfo)
		}
		return m, nil

	case flashMsg:
		m.setFlash(msg.text, msg.level)
		return m, nil

	case tea.MouseWheelMsg:
		if m.preboot != nil || m.upgrade != nil {
			return m, nil
		}
		if m.showHelp && m.helpView.page != nil {
			return m.dispatchHelp(msg)
		}
		return m.dispatchActive(msg)

	case tea.KeyPressMsg:
		return m.handleKey(msg)
	}
	if m.onboardingShown() && m.onboarding.form != nil {
		return m.updateOnboardingForm(msg)
	}
	return m, nil
}

func (m Model) handleStatus(msg statusMsg) (tea.Model, tea.Cmd) {
	m.loaded = true
	if errors.Is(msg.err, service.ErrNoProject) {
		if m.onboarding == nil {
			m.onboarding = m.newOnboarding()
			tick := m.startTicking()
			return m, tea.Batch(m.loadDefaults(), tick)
		}
		m.installEnded(msg.finishedTasks)
		return m, nil
	}
	if msg.err != nil {
		m.statusErr = msg.err.Error()
		return m, nil
	}
	if m.onboarding != nil && m.onboarding.answers != nil && m.onboarding.answers.cloudflare {
		m.cloudflareAfterInstall = true
	}
	m.onboarding = nil
	m.statusErr = ""
	m.status = msg.status
	m.tasks.acknowledge(msg.finishedTasks)
	m.applyUpdates()
	m.refreshed = m.opts.Now()
	ctxView := m.ctx()
	if m.cloudflareAfterInstall && m.tasks.running() == 0 && m.tasks.latest() != nil && m.tasks.latest().snapshot().state == taskOK {
		m.cloudflareAfterInstall = false
		m.settings = newSettingsView(ctxView)
		m.settings.tab = tabAccess
		m.settings.cloudflare = newCloudflarePane(ctxView)
		m.surface, m.preboot = surfaceSettings, nil
	}
	m.apps.clampCursor(ctxView)
	m.relayout()
	return m, m.apps.syncDetails(ctxView)
}

func (m Model) handleTaskDone(msg taskDoneMsg) (tea.Model, tea.Cmd) {
	m.tasks.finish(msg.id, msg.err)
	if msg.err != nil {
		m.preboot = nil
	}
	switch {
	case errors.Is(msg.err, service.ErrIncomplete), errors.Is(msg.err, service.ErrManual):
		m.setFlash("! "+msg.title+": Setup needs attention (see Needs attention)", levelWarn)
	case msg.err != nil:
		m.setFlash("✗ "+msg.title+": "+firstLine(msg.err.Error()), levelError)
	default:
		m.setFlash("✓ "+msg.title, levelOK)
	}
	m.resultFlash, m.flashHeld = m.flash, false
	cmds := []tea.Cmd{m.loadStatus(), m.loadDoctor()}
	if msg.action == ActionConfig {
		// URLs and Compose files may have changed with the settings.
		clear(m.apps.details.compose)
	}
	if msg.action == ActionBackup || msg.action == ActionRestore {
		cmds = append(cmds, loadBackups(m.backend))
	}
	if msg.action == ActionUpdate {
		cmds = append(cmds, m.loadUpdates())
	}
	return m, tea.Batch(cmds...)
}

// relayout sizes the dashboard viewport; call it whenever the layout can move.
func (m *Model) relayout() {
	ctxView := m.ctx()
	m.apps.refreshDetails(ctxView)
	if m.onboardingShown() && m.onboarding.form != nil {
		m.onboarding.form.WithWidth(m.formWidth())
	}
	if m.install != nil {
		m.install.resize(m.width)
	}
	if m.showHelp && m.helpView.page != nil {
		m.helpView.layoutPage(ctxView)
	}
}

// openTab switches to a tab. Every tab keeps its state while another is on
// screen; entering Apps refreshes containers and updates, and entering
// Settings reloads the Host review.
func (m Model) openTab(s surface) (tea.Model, tea.Cmd) {
	if s != m.surface {
		m.apps.searching = false
		if m.activity != nil {
			m.activity.searching = false
		}
	}
	m.surface = s
	switch s {
	case surfaceApps:
		return m, tea.Batch(m.loadContainers(), m.loadUpdates())
	case surfaceActivity:
		if m.activity == nil {
			m.activity = &activityView{}
		}
	case surfaceInstall:
		if m.install == nil {
			m.install = newInstallView(m.ctx())
			m.install.cursor = firstSelectable(m.install.installItems(m.ctx()))
		}
	case surfaceSettings:
		if m.settings == nil {
			m.settings = newSettingsView(m.ctx())
		}
		return m, tea.Batch(m.loadReview(), loadBackups(m.backend))
	}
	return m, nil
}

// firstSelectable skips category headers when the view opens.
func firstSelectable(items []installItem) int {
	for i, it := range items {
		if !it.header {
			return i
		}
	}
	return 0
}

// openHelp shows help scrolled into a viewport: the help page of what is
// focused when it has one, else the key reference. The page is the more
// specific help, and the key reference stays one move away: off that row, or
// on any other tab.
func (m Model) openHelp() (tea.Model, tea.Cmd) {
	m.showHelp = true
	if page, found := m.contextHelp(); found {
		m.helpView.openPage(m.ctx(), page)
		return m, nil
	}
	m.helpView.open(m.ctx(), m.helpGroups())
	return m, nil
}

// contextHelp is the help page of what has the focus, where there is one and
// the focus is not a text input: an Access option, in Onboarding's Access
// step and Settings' Access sub-tab.
func (m Model) contextHelp() (helpPage, bool) {
	if m.onboardingShown() {
		return m.onboarding.helpPage()
	}
	if m.surface == surfaceSettings && m.settings != nil {
		return m.settings.helpPage()
	}
	return helpPage{}, false
}

// helpGroups are the global keys, then every pane of every tab in tab order.
func (m Model) helpGroups() []pane {
	groups := []pane{{name: "Global", keys: m.keys.global()}, {name: "Action menu", keys: menuHelpKeys}}
	ctxView := m.ctx()
	views := []view{newDashboardView(newAppsView()), newAppsView(), &activityView{}, newInstallView(ctxView), newSettingsView(ctxView)}
	for i, v := range views {
		panes := v.Panes()
		for _, p := range panes {
			name := tabs[i].label
			if len(panes) > 1 {
				name += " · " + p.name
			}
			groups = append(groups, pane{name: name, keys: p.keys})
		}
	}
	return groups
}

// activeView is the view of the active tab; Help is an overlay over it.
func (m Model) activeView() view {
	switch m.surface {
	case surfaceInstall:
		return m.install
	case surfaceSettings:
		return m.settings
	case surfaceApps:
		return m.apps
	case surfaceActivity:
		return m.activity
	default:
		return m.dashboard
	}
}

func (m *Model) setActive(v view) {
	switch m.surface {
	case surfaceInstall:
		if iv, ok := v.(*installView); ok {
			m.install = iv
		}
	case surfaceSettings:
		if sv, ok := v.(*settingsView); ok {
			m.settings = sv
		}
	case surfaceApps:
		if av, ok := v.(*appsView); ok {
			m.apps = av
		}
	case surfaceActivity:
		if wv, ok := v.(*activityView); ok {
			m.activity = wv
		}
	default:
		if dv, ok := v.(*dashboardView); ok {
			m.dashboard = dv
		}
	}
}

// handleKey routes a key: pre-boot, Help and Onboarding take every key; a view that
// is capturing text takes every key but ctrl+c; otherwise the global keys
// act first and the rest go to the active tab.
func (m Model) handleKey(msg tea.KeyPressMsg) (tea.Model, tea.Cmd) {
	m.flashHeld = false
	switch {
	case m.upgrade != nil:
		return m.handleUpdateKey(msg)
	case m.preboot != nil:
		return m.handlePrebootKey(msg)
	case m.showHelp:
		if m.helpView.page != nil && m.helpView.page.copyText != "" && msg.String() == "ctrl+c" {
			return m.quit()
		}
		return m.dispatchHelp(msg)
	case m.onboardingShown():
		return m.handleOnboardingKey(msg)
	case msg.String() == "ctrl+c":
		return m.quit()
	case m.menu != nil:
		return m.menuKey(msg)
	case m.activeView().Capturing():
		return m.dispatchActive(msg)
	}
	if m.surface == surfaceActivity && m.activity != nil {
		if text := m.activity.errorText(m.ctx()); text != "" {
			switch msg.String() {
			case "c":
				return m, copyError(text)
			case "e":
				return m.openError(text)
			}
		}
	}
	k := m.keys
	switch {
	case key.Matches(msg, k.Quit):
		return m.quit()
	case key.Matches(msg, k.Help):
		return m.openHelp()
	}
	if !m.loaded || m.statusErr != "" {
		return m.dispatchActive(msg)
	}
	switch {
	case key.Matches(msg, k.Tabs):
		n, _ := strconv.Atoi(msg.String())
		return m.openTab(surface(n - 1))
	case key.Matches(msg, k.PrevTab):
		return m.openTab((m.surface + surface(len(tabs)) - 1) % surface(len(tabs)))
	case key.Matches(msg, k.NextTab):
		return m.openTab((m.surface + 1) % surface(len(tabs)))
	case key.Matches(msg, k.ProjectMenu):
		m.menu = &actionMenu{}
		return m, nil
	case key.Matches(msg, k.AppMenu):
		return m.openAppMenu()
	}
	return m.dispatchActive(msg)
}

func (m Model) quit() (tea.Model, tea.Cmd) {
	m.quitting = true
	m.tasks.cancelAll()
	m.apps.details.stopLogs()
	m.apps.details.stopUsage()
	return m, tea.Quit
}

// dispatchActive hands a message to the active view and applies its nav.
// A view that started an Action hands focus to Activity.
func (m Model) dispatchActive(msg tea.Msg) (tea.Model, tea.Cmd) {
	v := m.activeView()
	if v == nil {
		return m, nil
	}
	started := m.tasks.latest()
	ctxView := m.ctx()
	next, cmd, nv := v.Update(ctxView, msg)
	m.setActive(next)
	m.absorb(ctxView)
	model, cmd := m.applyNav(nv, cmd)
	m = model.(Model)
	if m.tasks.latest() != started {
		return m.focusActivity(cmd)
	}
	return m, cmd
}

// focusActivity shows the Activity tab, where the Action that just started
// plays, and starts the frame ticker.
func (m Model) focusActivity(cmd tea.Cmd) (tea.Model, tea.Cmd) {
	m.surface = surfaceActivity
	if m.activity == nil {
		m.activity = &activityView{}
	}
	tick := m.startTicking()
	return m, tea.Batch(cmd, tick)
}

// dispatchApps delivers an asynchronous App details message (logs, Compose,
// credential choices) even when another tab is on screen, so its state keeps
// updating.
func (m Model) dispatchApps(msg tea.Msg) (tea.Model, tea.Cmd) {
	ctxView := m.ctx()
	_, cmd, _ := m.apps.Update(ctxView, msg)
	m.absorb(ctxView)
	return m, cmd
}

// dispatchSettings delivers an asynchronous Backups message (the archives, an
// archive's Apps) even when another tab is on screen.
func (m Model) dispatchSettings(msg tea.Msg) (tea.Model, tea.Cmd) {
	if m.settings == nil {
		return m, nil
	}
	ctxView := m.ctx()
	_, cmd, _ := m.settings.Update(ctxView, msg)
	m.absorb(ctxView)
	return m, cmd
}

func (m Model) dispatchHelp(msg tea.Msg) (tea.Model, tea.Cmd) {
	ctxView := m.ctx()
	_, cmd, nv := m.helpView.Update(ctxView, msg)
	m.absorb(ctxView)
	if nv.kind == navBack {
		m.showHelp = false
	}
	return m, cmd
}

func (m Model) applyNav(nv nav, cmd tea.Cmd) (tea.Model, tea.Cmd) {
	switch nv.kind {
	case navDone:
		switch m.surface {
		case surfaceInstall:
			m.install = nil
		case surfaceSettings:
			m.settings = nil
		}
		m.surface = surfaceDashboard
	case navBack:
		m.surface = surfaceDashboard
	case navTo:
		next, open := m.openTab(nv.to)
		if nv.app != "" && nv.to == surfaceInstall {
			model := next.(Model)
			model.install.picked = picks{nv.app: true}
			ctx := model.ctx()
			_, review, _ := model.install.planPicked(ctx)
			model.absorb(ctx)
			return model, tea.Batch(cmd, open, review)
		}
		return next, tea.Batch(cmd, open)
	}
	return m, cmd
}

func (m Model) handleClick(id string) (tea.Model, tea.Cmd) {
	if m.apps.copy != nil {
		return m, nil
	}
	if m.upgrade != nil {
		return m, nil
	}
	if m.showHelp && m.helpView.page != nil {
		return m, nil
	}
	if m.menu != nil {
		if strings.HasPrefix(id, "menu:") {
			return m.menuClick(id)
		}
		return m, nil
	}
	if name, ok := strings.CutPrefix(id, "nav:"); ok {
		for i, tab := range tabs {
			if tab.name == name {
				return m.openTab(surface(i))
			}
		}
		return m, nil
	}
	return m.dispatchActive(clickMsg{id: id})
}

// run starts a background Action; the status line shows its progress.
func (m Model) run(req Request, title string) (tea.Model, tea.Cmd) {
	var secrets []string
	if o := m.onboarding; o != nil && o.answers != nil {
		secrets = append(secrets, o.answers.adminPassword)
		for _, a := range m.backend.Catalog().Apps() {
			for _, input := range a.Inputs() {
				if value := o.answers.inputs[a.Info().ID+"."+input.Key]; input.Private && value != nil {
					secrets = append(secrets, *value)
				}
			}
		}
	}
	cmd := m.ctx().run(req, title, secrets...)
	tick := m.startTicking()
	return m, tea.Batch(cmd, tick)
}

// Test-facing accessors kept on the Model.

func (m Model) selectedID() string {
	return m.apps.selectedID(m.ctx())
}

func (m Model) installRows() []installItem {
	if m.install == nil {
		return nil
	}
	return m.install.rows(m.ctx())
}

// renderOverlay is the Help overlay, empty unless it is open.
func (m Model) renderOverlay() string {
	if m.upgrade != nil {
		return m.renderUpdate()
	}
	if !m.showHelp || m.helpView.page != nil {
		return ""
	}
	return m.helpView.View(m.ctx(), m.width, m.mainHeight())
}
