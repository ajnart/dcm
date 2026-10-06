// Package tui is the Dashboard: one screen showing every App with its
// Status, what Needs action, and the selected App's details. It owns no
// logic of its own; every Action goes through the Backend, the same Service
// the CLI uses.
package tui

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"charm.land/bubbles/v2/help"
	"charm.land/bubbles/v2/key"
	"charm.land/bubbles/v2/spinner"
	"charm.land/bubbles/v2/viewport"
	tea "charm.land/bubbletea/v2"

	"github.com/ajnart/self-host/internal/events"
	"github.com/ajnart/self-host/internal/host"
	"github.com/ajnart/self-host/internal/release"
	"github.com/ajnart/self-host/internal/service"
)

// detailTab is one tab of App details.
type detailTab int

const (
	tabLogs detailTab = iota
	tabSetup
	tabInfo
	tabCompose
)

var detailTabs = []string{"logs", "setup", "info", "compose"}

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
		status service.Status
		err    error
	}
	defaultsMsg struct{ settings map[string]string }
	doctorMsg   struct{ checks []host.Check }
	updatesMsg  struct{ updates map[string]string }
	updatesTick struct{}
	releaseMsg  struct{ version string }
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

// logStream follows one App's logs until cancelled.
type logStream struct {
	target string
	ch     chan string
	cancel context.CancelFunc
}

type chanWriter struct{ ch chan string }

func (w chanWriter) Write(p []byte) (int, error) {
	w.ch <- string(p)
	return len(p), nil
}

type Options struct {
	Version string
	// Now is the clock shown in the header; tests pin it.
	Now func() time.Time
}

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
	latest    string
	loaded    bool
	statusErr string
	refreshed time.Time

	cursor int
	tab    detailTab
	// details scrolls the logs and compose tabs.
	details  viewport.Model
	logLines []string
	stream   *logStream
	compose  map[string]string

	showHelp bool
	picker   *picker
	wizard   *wizard
	defaults map[string]string

	tasks    *taskManager
	lastTask int

	flash      string
	flashLevel level
}

func New(backend Backend, opts Options) Model {
	if opts.Now == nil {
		opts.Now = time.Now
	}
	return Model{
		backend: backend,
		opts:    opts,
		dark:    true,
		theme:   newTheme(true),
		keys:    newKeyMap(),
		help:    help.New(),
		spin:    spinner.New(spinner.WithSpinner(spinner.MiniDot)),
		details: viewport.New(),
		compose: map[string]string{},
		tasks:   &taskManager{},
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
	return func() tea.Msg {
		ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
		defer cancel()
		status, err := backend.Status(ctx)
		return statusMsg{status: status, err: err}
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
	return "v" + strings.TrimPrefix(m.latest, "v") + " is available: run self-host self-update"
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

func (m Model) loadCompose(id string) tea.Cmd {
	backend := m.backend
	return func() tea.Msg {
		text, err := backend.Compose(context.Background(), id)
		return composeMsg{id: id, text: text, err: err}
	}
}

func (m Model) rows() []service.AppStatus { return m.status.Apps }

func (m Model) selected() (service.AppStatus, bool) {
	rows := m.rows()
	if m.cursor < 0 || m.cursor >= len(rows) {
		return service.AppStatus{}, false
	}
	return rows[m.cursor], true
}

func (m Model) selectedID() string {
	app, _ := m.selected()
	return app.ID
}

func (m *Model) clampCursor() {
	m.cursor = max(min(m.cursor, len(m.rows())-1), 0)
}

func (m *Model) setFlash(text string, l level) {
	m.flash, m.flashLevel = text, l
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
		m.applyUpdates()
		m.refreshed = m.opts.Now()
		m.clampCursor()
		m.relayout()
		return m, m.syncDetails()

	case doctorMsg:
		m.checks = msg.checks
		m.relayout()
		return m, nil

	case updatesTick:
		return m, tea.Batch(m.loadUpdates(), tea.Tick(checkUpdatesEvery, func(time.Time) tea.Msg { return updatesTick{} }))

	case updatesMsg:
		m.updates = msg.updates
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
		m.tasks.finish(msg.id, msg.err)
		if m.wizard != nil && m.wizard.stage == stageInstalling && msg.id == m.wizard.taskID {
			if msg.err != nil && !errors.Is(msg.err, service.ErrIncomplete) {
				m.wizard.stage, m.wizard.err = stageReview, msg.err.Error()
				m.setFlash("✗ "+firstLine(msg.err.Error()), levelError)
				return m, nil
			}
			m.wizard = nil
		}
		switch {
		case errors.Is(msg.err, service.ErrIncomplete):
			m.setFlash("! "+msg.title+": Setup needs attention (see Needs action)", levelWarn)
		case msg.err != nil:
			m.setFlash("✗ "+msg.title+": "+firstLine(msg.err.Error()), levelError)
		default:
			m.setFlash("✓ "+msg.title, levelOK)
		}
		cmds := []tea.Cmd{m.loadStatus(), m.loadDoctor()}
		if strings.HasPrefix(msg.title, "update") {
			cmds = append(cmds, m.loadUpdates())
		}
		return m, tea.Batch(cmds...)

	case logChunkMsg:
		if msg.stream != m.stream || msg.done {
			return m, nil
		}
		m.appendLogs(msg.text)
		return m, waitLog(msg.stream)

	case composeMsg:
		text := msg.text
		if msg.err != nil {
			text = "could not read the Compose file: " + msg.err.Error()
		}
		m.compose[msg.id] = text
		m.syncDetailsContent()
		return m, nil

	case clickMsg:
		return m.handleClick(msg.id)

	case clipboardMsg:
		m.setFlash("copied "+msg.what, levelOK)
		return m, tea.SetClipboard(msg.text)

	case flashMsg:
		m.setFlash(msg.text, msg.level)
		return m, nil

	case tea.MouseWheelMsg:
		if msg.Button == tea.MouseWheelUp {
			m.details.ScrollUp(3)
		} else {
			m.details.ScrollDown(3)
		}
		return m, nil

	case tea.KeyPressMsg:
		return m.handleKey(msg)
	}
	if m.wizard != nil && m.wizard.stage == stageForm {
		return m.updateWizardForm(msg)
	}
	return m, nil
}

func firstLine(s string) string {
	line, _, _ := strings.Cut(s, "\n")
	return line
}

func (m Model) handleKey(msg tea.KeyPressMsg) (tea.Model, tea.Cmd) {
	switch {
	case m.wizard != nil:
		return m.handleWizardKey(msg)
	case m.picker != nil:
		return m.handlePickerKey(msg)
	case m.showHelp:
		m.showHelp = false
		return m, nil
	}
	k := m.keys
	switch {
	case key.Matches(msg, k.Quit):
		m.tasks.cancelAll()
		m.stopLogs()
		return m, tea.Quit
	case key.Matches(msg, k.Help):
		m.showHelp = true
		return m, nil
	case key.Matches(msg, k.Up):
		return m.move(-1)
	case key.Matches(msg, k.Down):
		return m.move(1)
	case key.Matches(msg, k.Tab):
		m.tab = (m.tab + 1) % detailTab(len(detailTabs))
		return m, m.syncDetails()
	case key.Matches(msg, k.ScrollUp):
		m.details.PageUp()
		return m, nil
	case key.Matches(msg, k.ScrollDown):
		m.details.PageDown()
		return m, nil
	case key.Matches(msg, k.Install):
		return m.openPicker()
	case key.Matches(msg, k.Backup):
		return m.run(Request{Action: ActionBackup}, "backup")
	case key.Matches(msg, k.Copy):
		backend := m.backend
		return m, func() tea.Msg {
			creds, err := backend.Credentials(context.Background())
			if err != nil {
				return flashMsg{text: err.Error(), level: levelError}
			}
			return clipboardMsg{text: creds.Admin.Password, what: "the Admin password for " + creds.Admin.Username}
		}
	}
	app, found := m.selected()
	if !found {
		return m, nil
	}
	switch {
	case key.Matches(msg, k.Toggle):
		if app.State == "running" || app.State == "degraded" {
			return m.run(Request{Action: ActionStop, IDs: []string{app.ID}}, "stop "+app.ID)
		}
		return m.run(Request{Action: ActionStart, IDs: []string{app.ID}}, "start "+app.ID)
	case key.Matches(msg, k.Update):
		if app.Update != service.UpdateAvailable {
			m.setFlash("no update known for "+app.Name+" (checked every 30 minutes)", levelInfo)
			return m, nil
		}
		return m.run(Request{Action: ActionUpdate, IDs: []string{app.ID}}, "update "+app.ID)
	case key.Matches(msg, k.Retry):
		if !app.Managed {
			m.setFlash(app.Name+" has no automatic Setup (it was added by hand)", levelWarn)
			return m, nil
		}
		return m.run(Request{Action: ActionSetup, IDs: []string{app.ID}}, "setup "+app.ID)
	case key.Matches(msg, k.Open):
		if app.URL == "" {
			m.setFlash(app.Name+" has no URL", levelWarn)
			return m, nil
		}
		backend, url := m.backend, app.URL
		return m, func() tea.Msg {
			if err := backend.OpenURL(url); err != nil {
				return flashMsg{text: "could not open a browser: " + err.Error() + " — " + url, level: levelError}
			}
			return flashMsg{text: "opened " + url, level: levelOK}
		}
	}
	return m, nil
}

func (m Model) move(delta int) (tea.Model, tea.Cmd) {
	m.cursor += delta
	m.clampCursor()
	return m, m.syncDetails()
}

func (m Model) handleClick(id string) (tea.Model, tea.Cmd) {
	var n int
	switch {
	case strings.HasPrefix(id, "row:"):
		fmt.Sscanf(id, "row:%d", &n)
		m.cursor = n
		m.clampCursor()
		return m, m.syncDetails()
	case strings.HasPrefix(id, "tab:"):
		fmt.Sscanf(id, "tab:%d", &n)
		m.tab = detailTab(n)
		return m, m.syncDetails()
	case strings.HasPrefix(id, "app:"):
		for i, app := range m.rows() {
			if app.ID == strings.TrimPrefix(id, "app:") {
				m.cursor = i
			}
		}
		return m, m.syncDetails()
	}
	return m, nil
}

// run starts a background Action; the footer shows its progress.
func (m Model) run(req Request, title string) (tea.Model, tea.Cmd) {
	t := m.tasks.start(title)
	m.lastTask = t.id
	backend := m.backend
	run := func() tea.Msg {
		log := events.New(events.SinkFunc(t.append))
		err := backend.Run(t.ctx, req, log)
		return taskDoneMsg{id: t.id, title: title, err: err}
	}
	return m, tea.Batch(run, m.spin.Tick)
}

// Details

// syncDetails loads what the current tab shows for the selected App.
func (m *Model) syncDetails() tea.Cmd {
	m.syncDetailsContent()
	switch m.tab {
	case tabLogs:
		return m.syncLogs()
	case tabCompose:
		if id := m.selectedID(); id != "" {
			return m.loadCompose(id)
		}
	}
	return nil
}

func (m *Model) syncDetailsContent() {
	switch m.tab {
	case tabLogs:
		m.details.SetContentLines(m.logLines)
		m.details.GotoBottom()
	case tabCompose:
		m.details.SetContent(m.compose[m.selectedID()])
		m.details.GotoTop()
	}
}

func (m *Model) stopLogs() {
	if m.stream != nil {
		m.stream.cancel()
		m.stream = nil
	}
}

// syncLogs (re)starts the log stream when the selected App changes.
func (m *Model) syncLogs() tea.Cmd {
	target := m.selectedID()
	if target == "" || (m.stream != nil && m.stream.target == target) {
		return nil
	}
	m.stopLogs()
	m.logLines = nil
	m.details.SetContent("")
	ctx, cancel := context.WithCancel(context.Background())
	stream := &logStream{target: target, ch: make(chan string, 64), cancel: cancel}
	m.stream = stream
	backend := m.backend
	go func() {
		backend.Logs(ctx, target, chanWriter{stream.ch})
		close(stream.ch)
	}()
	return waitLog(stream)
}

func waitLog(stream *logStream) tea.Cmd {
	return func() tea.Msg {
		text, ok := <-stream.ch
		return logChunkMsg{stream: stream, text: text, done: !ok}
	}
}

const maxLogLines = 2000

// appendLogs adds lines and keeps following the end unless scrolled up.
func (m *Model) appendLogs(text string) {
	following := m.details.AtBottom()
	for _, line := range strings.Split(strings.TrimRight(text, "\n"), "\n") {
		if strings.TrimSpace(line) != "" {
			m.logLines = append(m.logLines, line)
		}
	}
	if len(m.logLines) > maxLogLines {
		m.logLines = m.logLines[len(m.logLines)-maxLogLines:]
	}
	if m.tab != tabLogs {
		return
	}
	m.details.SetContentLines(m.logLines)
	if following {
		m.details.GotoBottom()
	}
}
