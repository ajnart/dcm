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

	"charm.land/bubbles/v2/help"
	"charm.land/bubbles/v2/key"
	"charm.land/bubbles/v2/spinner"
	tea "charm.land/bubbletea/v2"

	"github.com/ajnart/self-host/internal/events"
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
	releaseMsg  struct{ version string }
	reviewMsg   struct {
		rows []service.SettingReview
		err  error
	}
	containersMsg struct {
		containers []service.ContainerStatus
		err        error
	}
	tickMsg     time.Time
	taskDoneMsg struct {
		id    int
		title string
		err   error
	}
	logChunkMsg struct {
		stream *logStream
		text   string
		done   bool
	}
	composeMsg struct {
		id, text string
		err      error
	}
	clickMsg     struct{ id string }
	clipboardMsg struct{ text, what string }
	flashMsg     struct {
		text  string
		level level
	}
)

type Options struct {
	Version string
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
	dark          bool
	theme         theme
	keys          keyMap
	help          help.Model
	spin          spinner.Model

	status    service.Status
	checks    []host.Check
	updates   map[string]string
	updatesAt time.Time
	latest    string
	loaded    bool
	statusErr string
	refreshed time.Time

	containers    []service.ContainerStatus
	containersErr string

	defaults map[string]string

	tasks *taskManager

	flash      string
	flashLevel level

	surface   surface
	showHelp  bool
	dashboard *dashboardView
	install   *installView
	settings  *settingsView
	stack     *stackView
	workflow  *workflowView
	helpView  *helpView
	menu      *actionMenu
	wizard    *wizard
}

func New(backend Backend, opts Options) Model {
	if opts.Now == nil {
		opts.Now = time.Now
	}
	return Model{
		backend:   backend,
		opts:      opts,
		dark:      true,
		theme:     newTheme(true),
		keys:      newKeyMap(),
		help:      help.New(),
		spin:      spinner.New(spinner.WithSpinner(spinner.MiniDot)),
		tasks:     &taskManager{},
		dashboard: newDashboardView(),
		helpView:  newHelpView(),
	}
}

func (m Model) Init() tea.Cmd {
	return tea.Batch(tea.RequestBackgroundColor, m.loadStatus(), m.loadDoctor(), m.loadRelease(), m.spin.Tick, tick(),
		tea.Tick(3*time.Second, func(time.Time) tea.Msg { return updatesTick{} }))
}

func tick() tea.Cmd {
	return tea.Tick(refreshEvery, func(t time.Time) tea.Msg { return tickMsg(t) })
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
		return releaseMsg{version: backend.LatestRelease(ctx)}
	}
}

// releaseNotice tells the user how to install the newer release.
func (m Model) releaseNotice() string {
	return releaseNotice(m.latest)
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

// ctx is the read/ask view of the Model handed to the active view.
func (m Model) ctx() *viewContext {
	return &viewContext{
		width: m.width, height: m.height, dark: m.dark, theme: m.theme,
		keys: m.keys, help: m.help, spin: m.spin,
		status: m.status, checks: m.checks, updates: m.updates, updatesAt: m.updatesAt,
		latest: m.latest, loaded: m.loaded, statusErr: m.statusErr, refreshed: m.refreshed,
		containers: m.containers, containersErr: m.containersErr,
		defaults: m.defaults, backend: m.backend, tasks: m.tasks, opts: m.opts,
		flash: m.flash, flashLevel: m.flashLevel,
	}
}

// absorb copies the shared fields a view may have changed back onto the Model.
func (m *Model) absorb(ctx *viewContext) {
	m.width, m.height = ctx.width, ctx.height
	m.containers, m.containersErr = ctx.containers, ctx.containersErr
	m.flash, m.flashLevel = ctx.flash, ctx.flashLevel
	m.help, m.spin = ctx.help, ctx.spin
	m.defaults = ctx.defaults
}

func (m Model) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	switch msg := msg.(type) {
	case tea.WindowSizeMsg:
		m.width, m.height = msg.Width, msg.Height
		m.relayout()
		return m, nil

	case tea.BackgroundColorMsg:
		m.dark = msg.IsDark()
		m.theme = newTheme(m.dark)
		m.help.Styles = help.DefaultStyles(m.dark)
		m.relayout()
		return m, nil

	case tea.FocusMsg:
		return m, tea.Batch(m.loadStatus(), m.loadDoctor())

	case tickMsg:
		return m, tea.Batch(m.loadStatus(), tick())

	case defaultsMsg:
		m.defaults = msg.settings
		if m.wizard != nil && m.wizard.stage == stageWelcome {
			m.wizard = m.newWizard()
		}
		return m, nil

	case statusMsg:
		return m.handleStatus(msg)

	case doctorMsg:
		m.checks = msg.checks
		m.relayout()
		return m, nil

	case updatesTick:
		return m, tea.Batch(m.loadUpdates(), tea.Tick(checkUpdatesEvery, func(time.Time) tea.Msg { return updatesTick{} }))

	case updatesMsg:
		m.updates = msg.updates
		m.updatesAt = m.opts.Now()
		m.applyUpdates()
		m.relayout()
		return m, nil

	case releaseMsg:
		if newer, err := release.Newer(m.opts.Version, msg.version); err == nil && newer {
			m.latest = msg.version
			if m.flash == "" {
				m.setFlash(m.releaseNotice(), levelInfo)
			}
		}
		return m, nil

	case spinner.TickMsg:
		var cmd tea.Cmd
		m.spin, cmd = m.spin.Update(msg)
		return m, cmd

	case taskDoneMsg:
		return m.handleTaskDone(msg)

	case logChunkMsg, composeMsg:
		return m.dispatchDashboard(msg)

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
		return m, nil

	case clickMsg:
		return m.handleClick(msg.id)

	case clipboardMsg:
		m.setFlash("copied "+msg.what, levelOK)
		return m, tea.SetClipboard(msg.text)
	case copyOptionsMsg:
		return m.dispatchDashboard(msg)

	case flashMsg:
		m.setFlash(msg.text, msg.level)
		return m, nil

	case tea.MouseWheelMsg:
		return m.dispatchActive(msg)

	case tea.KeyPressMsg:
		return m.handleKey(msg)
	}
	if m.wizard != nil && m.wizard.stage == stageForm {
		return m.updateWizardForm(msg)
	}
	return m, nil
}

func (m Model) handleStatus(msg statusMsg) (tea.Model, tea.Cmd) {
	m.loaded = true
	if errors.Is(msg.err, service.ErrNoProject) {
		if m.wizard == nil {
			m.wizard = m.newWizard()
			return m, m.loadDefaults()
		}
		return m, nil
	}
	if msg.err != nil {
		m.statusErr = msg.err.Error()
		return m, nil
	}
	if m.wizard != nil && m.wizard.stage != stageInstalling {
		m.wizard = nil
	}
	m.statusErr = ""
	m.status = msg.status
	m.tasks.acknowledge(msg.finishedTasks)
	m.applyUpdates()
	m.refreshed = m.opts.Now()
	ctxView := m.ctx()
	m.dashboard.clampCursor(ctxView)
	m.relayout()
	cmd := m.dashboard.syncDetails(ctxView)
	m.absorb(ctxView)
	return m, cmd
}

func (m Model) handleTaskDone(msg taskDoneMsg) (tea.Model, tea.Cmd) {
	m.tasks.finish(msg.id, msg.err)
	if m.wizard != nil && m.wizard.stage == stageInstalling && msg.id == m.wizard.taskID {
		if msg.err != nil && !errors.Is(msg.err, service.ErrIncomplete) && !errors.Is(msg.err, service.ErrManual) {
			m.wizard.stage, m.wizard.err = stageReview, msg.err.Error()
			m.setFlash("✗ "+firstLine(msg.err.Error()), levelError)
			return m, nil
		}
		m.wizard = nil
	}
	switch {
	case errors.Is(msg.err, service.ErrIncomplete), errors.Is(msg.err, service.ErrManual):
		m.setFlash("! "+msg.title+": Setup needs attention (see Needs attention)", levelWarn)
	case msg.err != nil:
		m.setFlash("✗ "+msg.title+": "+firstLine(msg.err.Error()), levelError)
	default:
		m.setFlash("✓ "+msg.title, levelOK)
	}
	cmds := []tea.Cmd{m.loadStatus(), m.loadDoctor()}
	if strings.HasPrefix(msg.title, "config") {
		// URLs and Compose files may have changed with the settings.
		clear(m.dashboard.compose)
	}
	if strings.HasPrefix(msg.title, "update") {
		cmds = append(cmds, m.loadUpdates())
	}
	return m, tea.Batch(cmds...)
}

// relayout sizes the dashboard viewport; call it whenever the layout can move.
func (m *Model) relayout() {
	ctxView := m.ctx()
	m.dashboard.relayout(ctxView)
	m.help.SetWidth(m.width)
	if m.install != nil {
		m.install.resize(m.width)
	}
}

// openTab switches to a tab. Every tab keeps its state while another is on
// screen; entering Apps refreshes containers and updates, and entering
// Settings reloads the Host review.
func (m Model) openTab(s surface) (tea.Model, tea.Cmd) {
	m.surface = s
	switch s {
	case surfaceStack:
		if m.stack == nil {
			m.stack = &stackView{}
		}
		return m, tea.Batch(m.loadContainers(), m.loadUpdates())
	case surfaceWorkflow:
		if m.workflow == nil {
			m.workflow = &workflowView{}
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
		return m, m.loadReview()
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

// openHelp shows the key reference, scrolled into a viewport.
func (m Model) openHelp() (tea.Model, tea.Cmd) {
	m.showHelp = true
	m.helpView.open(m.ctx(), m.helpGroups())
	return m, nil
}

// helpGroups are the global keys, then every pane of every tab in tab order.
func (m Model) helpGroups() []pane {
	groups := []pane{{name: "Global", keys: m.keys.global()}, {name: "Action menu", keys: menuHelpKeys}}
	ctxView := m.ctx()
	views := []view{newDashboardView(), &stackView{}, &workflowView{}, newInstallView(ctxView), newSettingsView(ctxView)}
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
	case surfaceStack:
		return m.stack
	case surfaceWorkflow:
		return m.workflow
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
	case surfaceStack:
		if sv, ok := v.(*stackView); ok {
			m.stack = sv
		}
	case surfaceWorkflow:
		if wv, ok := v.(*workflowView); ok {
			m.workflow = wv
		}
	default:
		if dv, ok := v.(*dashboardView); ok {
			m.dashboard = dv
		}
	}
}

// handleKey routes a key: the wizard and Help take every key; a view that
// is capturing text takes every key but ctrl+c; otherwise the global keys
// act first and the rest go to the active tab.
func (m Model) handleKey(msg tea.KeyPressMsg) (tea.Model, tea.Cmd) {
	switch {
	case m.wizard != nil:
		return m.handleWizardKey(msg)
	case m.showHelp:
		return m.dispatchHelp(msg)
	case msg.String() == "ctrl+c":
		return m.quit()
	case m.menu != nil:
		return m.menuKey(msg)
	case m.activeView().Capturing():
		return m.dispatchActive(msg)
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
	m.tasks.cancelAll()
	m.dashboard.stopLogs()
	return m, tea.Quit
}

// dispatchActive hands a message to the active view and applies its nav.
func (m Model) dispatchActive(msg tea.Msg) (tea.Model, tea.Cmd) {
	v := m.activeView()
	if v == nil {
		return m, nil
	}
	ctxView := m.ctx()
	next, cmd, nv := v.Update(ctxView, msg)
	m.setActive(next)
	m.absorb(ctxView)
	return m.applyNav(nv, cmd)
}

// dispatchDashboard delivers an asynchronous dashboard message (logs, Compose)
// even when another view is on screen, so its state keeps updating.
func (m Model) dispatchDashboard(msg tea.Msg) (tea.Model, tea.Cmd) {
	ctxView := m.ctx()
	next, cmd, _ := m.dashboard.Update(ctxView, msg)
	if dv, ok := next.(*dashboardView); ok {
		m.dashboard = dv
	}
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
	}
	return m, cmd
}

func (m Model) handleClick(id string) (tea.Model, tea.Cmd) {
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
	t := m.tasks.start(title)
	backend := m.backend
	run := func() tea.Msg {
		log := events.New(events.SinkFunc(t.append))
		err := backend.Run(t.ctx, req, log)
		return taskDoneMsg{id: t.id, title: title, err: err}
	}
	return m, tea.Batch(run, m.spin.Tick)
}

// Test-facing accessors kept on the Model.

func (m Model) selectedID() string {
	return m.dashboard.selectedID(m.ctx())
}

func (m Model) installRows() []installItem {
	if m.install == nil {
		return nil
	}
	return m.install.rows(m.ctx())
}

// renderOverlay is the Help overlay, empty unless it is open.
func (m Model) renderOverlay() string {
	if !m.showHelp {
		return ""
	}
	return m.helpView.View(m.ctx(), m.width, m.mainHeight())
}
