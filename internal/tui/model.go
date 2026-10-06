// Package tui is the full-screen dashboard. It owns no logic of its own:
// every action goes through the Backend, the same Service the CLI uses.
package tui

import (
	"context"
	"fmt"
	"io"
	"strings"
	"time"

	"charm.land/bubbles/v2/help"
	"charm.land/bubbles/v2/key"
	"charm.land/bubbles/v2/spinner"
	"charm.land/bubbles/v2/textinput"
	"charm.land/bubbles/v2/viewport"
	tea "charm.land/bubbletea/v2"

	"github.com/ajnart/self-host/internal/events"
	"github.com/ajnart/self-host/internal/host"
	"github.com/ajnart/self-host/internal/service"
)

type screenID int

const (
	screenApps screenID = iota
	screenCatalog
	screenUpdates
	screenDoctor
	screenBackups
)

var screenNames = []string{"Apps", "Catalog", "Updates", "Doctor", "Backups"}

type mode int

const (
	modeNormal mode = iota
	modeFilter
	modeConfirm
	modeHelp
	modeTasks
)

type sidebarTab int

const (
	tabLogs sidebarTab = iota
	tabSetup
	tabInfo
)

var sidebarTabs = []string{"logs", "setup", "info"}

type level int

const (
	levelInfo level = iota
	levelOK
	levelWarn
	levelError
)

const refreshEvery = 5 * time.Second

// Messages.
type (
	statusMsg struct {
		status service.Status
		err    error
	}
	doctorMsg    struct{ checks []host.Check }
	tickMsg      time.Time
	taskDoneMsg  struct {
		id    int
		title string
		err   error
	}
	logChunkMsg struct {
		stream *logStream
		text   string
		done   bool
	}
	clickMsg     struct{ id string }
	clipboardMsg struct{ text, what string }
	flashMsg     struct {
		text  string
		level level
	}
)

type confirmation struct {
	question string
	detail   string
	action   Action
	ids      []string
	title    string
}

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

	screen screenID
	mode   mode

	status    service.Status
	checks    []host.Check
	loaded    bool
	statusErr string
	refreshed time.Time

	cursor int
	filter textinput.Model

	sidebarVisible bool
	tab            sidebarTab
	follow         bool
	pinned         string
	logs           viewport.Model
	logLines       []string
	stream         *logStream

	tasks      *taskManager
	taskCursor int
	confirm    *confirmation

	flash      string
	flashLevel level
}

func New(backend Backend, opts Options) Model {
	filter := textinput.New()
	filter.Prompt = "/ "
	filter.Placeholder = "filter apps"
	if opts.Now == nil {
		opts.Now = time.Now
	}
	m := Model{
		backend:        backend,
		opts:           opts,
		dark:           true,
		theme:          newTheme(true),
		keys:           newKeyMap(),
		help:           help.New(),
		spin:           spinner.New(spinner.WithSpinner(spinner.MiniDot)),
		filter:         filter,
		sidebarVisible: true,
		follow:         true,
		logs:           viewport.New(),
		tasks:          &taskManager{},
	}
	return m
}

func (m Model) Init() tea.Cmd {
	return tea.Batch(tea.RequestBackgroundColor, m.loadStatus(), m.loadDoctor(), m.spin.Tick, tick())
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

func (m Model) loadDoctor() tea.Cmd {
	backend := m.backend
	return func() tea.Msg {
		ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
		defer cancel()
		return doctorMsg{checks: backend.Doctor(ctx)}
	}
}

// rows returns the Apps shown in the table after filtering.
func (m Model) rows() []service.AppStatus {
	query := strings.ToLower(strings.TrimSpace(m.filter.Value()))
	if query == "" {
		return m.status.Apps
	}
	var rows []service.AppStatus
	for _, app := range m.status.Apps {
		haystack := strings.ToLower(strings.Join([]string{app.ID, app.Name, app.URL, app.State, app.Health, app.Setup, app.Image}, " "))
		if strings.Contains(haystack, query) {
			rows = append(rows, app)
		}
	}
	return rows
}

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
	n := len(m.rows())
	if m.cursor >= n {
		m.cursor = n - 1
	}
	if m.cursor < 0 {
		m.cursor = 0
	}
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

	case statusMsg:
		m.loaded = true
		if msg.err != nil {
			m.statusErr = msg.err.Error()
			return m, nil
		}
		m.statusErr = ""
		m.status = msg.status
		m.refreshed = m.opts.Now()
		m.clampCursor()
		return m, m.syncLogs()

	case doctorMsg:
		m.checks = msg.checks
		return m, nil

	case spinner.TickMsg:
		var cmd tea.Cmd
		m.spin, cmd = m.spin.Update(msg)
		return m, cmd

	case taskDoneMsg:
		m.tasks.finish(msg.id, msg.err)
		if msg.err != nil {
			m.setFlash("✗ "+msg.title+": "+firstLine(msg.err.Error())+" (t: details)", levelError)
		} else {
			m.setFlash("✓ "+msg.title, levelOK)
		}
		return m, tea.Batch(m.loadStatus(), m.loadDoctor())

	case logChunkMsg:
		if msg.stream != m.stream {
			return m, nil
		}
		if msg.done {
			return m, nil
		}
		m.appendLogs(msg.text)
		return m, waitLog(msg.stream)

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
			m.logs.ScrollUp(3)
			m.follow = false
		} else {
			m.logs.ScrollDown(3)
		}
		return m, nil

	case tea.KeyPressMsg:
		return m.handleKey(msg)
	}
	return m, nil
}

func firstLine(s string) string {
	line, _, _ := strings.Cut(s, "\n")
	return line
}

func (m Model) handleKey(msg tea.KeyPressMsg) (tea.Model, tea.Cmd) {
	switch m.mode {
	case modeFilter:
		return m.handleFilterKey(msg)
	case modeConfirm:
		return m.handleConfirmKey(msg)
	case modeHelp:
		if key.Matches(msg, m.keys.Help, m.keys.Clear, m.keys.Quit) {
			m.mode = modeNormal
		}
		return m, nil
	case modeTasks:
		return m.handleTasksKey(msg)
	}
	return m.handleNormalKey(msg)
}

func (m Model) handleFilterKey(msg tea.KeyPressMsg) (tea.Model, tea.Cmd) {
	switch msg.String() {
	case "enter":
		m.mode = modeNormal
		m.filter.Blur()
		return m, m.syncLogs()
	case "esc":
		m.mode = modeNormal
		m.filter.Blur()
		m.filter.Reset()
		m.clampCursor()
		return m, m.syncLogs()
	}
	var cmd tea.Cmd
	m.filter, cmd = m.filter.Update(msg)
	m.cursor = 0
	return m, cmd
}

func (m Model) handleConfirmKey(msg tea.KeyPressMsg) (tea.Model, tea.Cmd) {
	switch {
	case key.Matches(msg, m.keys.Confirm):
		c := m.confirm
		m.confirm, m.mode = nil, modeNormal
		return m.runTask(c.action, c.ids, c.title)
	case key.Matches(msg, m.keys.Cancel):
		m.confirm, m.mode = nil, modeNormal
		m.setFlash("cancelled", levelInfo)
	}
	return m, nil
}

func (m Model) handleTasksKey(msg tea.KeyPressMsg) (tea.Model, tea.Cmd) {
	snaps := m.tasks.snapshots()
	switch {
	case key.Matches(msg, m.keys.Tasks, m.keys.Clear, m.keys.Quit):
		m.mode = modeNormal
	case key.Matches(msg, m.keys.Up):
		m.taskCursor = max(m.taskCursor-1, 0)
	case key.Matches(msg, m.keys.Down):
		m.taskCursor = min(m.taskCursor+1, max(len(snaps)-1, 0))
	case key.Matches(msg, m.keys.Remove):
		if m.taskCursor < len(snaps) {
			if t := m.tasks.get(snaps[m.taskCursor].id); t != nil {
				t.cancel()
				m.setFlash("cancelling "+t.title, levelWarn)
			}
		}
	}
	return m, nil
}

func (m Model) handleNormalKey(msg tea.KeyPressMsg) (tea.Model, tea.Cmd) {
	k := m.keys
	switch {
	case key.Matches(msg, k.Quit):
		m.tasks.cancelAll()
		m.stopLogs()
		return m, tea.Quit
	case key.Matches(msg, k.Help):
		m.mode = modeHelp
		return m, nil
	case key.Matches(msg, k.Tasks):
		m.mode = modeTasks
		m.taskCursor = max(len(m.tasks.snapshots())-1, 0)
		return m, nil
	case key.Matches(msg, k.Apps):
		return m.switchScreen(screenApps)
	case key.Matches(msg, k.Catalog):
		return m.switchScreen(screenCatalog)
	case key.Matches(msg, k.Updates):
		return m.switchScreen(screenUpdates)
	case key.Matches(msg, k.Doctor):
		return m.switchScreen(screenDoctor)
	case key.Matches(msg, k.Backups):
		return m.switchScreen(screenBackups)
	case key.Matches(msg, k.Refresh):
		m.setFlash("refreshing…", levelInfo)
		return m, tea.Batch(m.loadStatus(), m.loadDoctor())
	}
	if m.screen != screenApps {
		return m, nil
	}
	app, found := m.selected()
	switch {
	case key.Matches(msg, k.Up):
		return m.move(-1)
	case key.Matches(msg, k.Down):
		return m.move(1)
	case key.Matches(msg, k.Filter):
		m.mode = modeFilter
		return m, m.filter.Focus()
	case key.Matches(msg, k.Clear):
		if m.filter.Value() != "" {
			m.filter.Reset()
			m.clampCursor()
			m.setFlash("filter cleared", levelInfo)
			return m, m.syncLogs()
		}
		return m, nil
	case key.Matches(msg, k.Sidebar):
		m.sidebarVisible = !m.sidebarVisible
		m.relayout()
		return m, m.syncLogs()
	case key.Matches(msg, k.SidebarTab):
		m.tab = (m.tab + 1) % sidebarTab(len(sidebarTabs))
		return m, m.syncLogs()
	case key.Matches(msg, k.Follow):
		m.follow = !m.follow
		if m.follow {
			m.logs.GotoBottom()
		}
		return m, nil
	case key.Matches(msg, k.PageUp):
		m.logs.PageUp()
		m.follow = false
		return m, nil
	case key.Matches(msg, k.PageDown):
		m.logs.PageDown()
		return m, nil
	case key.Matches(msg, k.Pin):
		if m.pinned != "" {
			m.pinned = ""
			m.setFlash("logs follow the selection", levelInfo)
		} else if found {
			m.pinned = app.ID
			m.setFlash("logs pinned to "+app.ID, levelInfo)
		}
		return m, m.syncLogs()
	case key.Matches(msg, k.UpdateAll):
		return m.runTask(ActionUpdate, nil, "update all")
	}
	if !found {
		return m, nil
	}
	switch {
	case key.Matches(msg, k.Toggle):
		if app.State == "running" || app.State == "degraded" {
			return m.runTask(ActionStop, []string{app.ID}, "stop "+app.ID)
		}
		return m.runTask(ActionStart, []string{app.ID}, "start "+app.ID)
	case key.Matches(msg, k.Stop):
		return m.runTask(ActionStop, []string{app.ID}, "stop "+app.ID)
	case key.Matches(msg, k.Restart):
		return m.runTask(ActionRestart, []string{app.ID}, "restart "+app.ID)
	case key.Matches(msg, k.Update):
		return m.runTask(ActionUpdate, []string{app.ID}, "update "+app.ID)
	case key.Matches(msg, k.Setup):
		if !app.Managed {
			m.setFlash(app.ID+" is unmanaged: no automatic Setup", levelWarn)
			return m, nil
		}
		return m.runTask(ActionSetup, []string{app.ID}, "setup "+app.ID)
	case key.Matches(msg, k.Remove):
		m.confirm = &confirmation{question: "Remove " + app.Name + "?", detail: "Containers are deleted; data stays in apps/" + app.ID + "/.",
			action: ActionRemove, ids: []string{app.ID}, title: "remove " + app.ID}
		m.mode = modeConfirm
		return m, nil
	case key.Matches(msg, k.Purge):
		m.confirm = &confirmation{question: "Remove " + app.Name + " and DELETE its data?", detail: "apps/" + app.ID + "/ is deleted. This cannot be undone.",
			action: ActionPurge, ids: []string{app.ID}, title: "purge " + app.ID}
		m.mode = modeConfirm
		return m, nil
	case key.Matches(msg, k.Open):
		if app.URL == "" {
			m.setFlash(app.ID+" has no URL", levelWarn)
			return m, nil
		}
		backend, url := m.backend, app.URL
		return m, func() tea.Msg {
			if err := backend.OpenURL(url); err != nil {
				return flashMsg{text: "could not open browser: " + err.Error(), level: levelError}
			}
			return flashMsg{text: "opened " + url, level: levelOK}
		}
	case key.Matches(msg, k.CopyURL):
		if app.URL == "" {
			return m, nil
		}
		url := app.URL
		return m, func() tea.Msg { return clipboardMsg{text: url, what: url} }
	case key.Matches(msg, k.CopyPassword):
		backend := m.backend
		return m, func() tea.Msg {
			creds, err := backend.Credentials(context.Background())
			if err != nil {
				return flashMsg{text: err.Error(), level: levelError}
			}
			return clipboardMsg{text: creds.Admin.Password, what: "the Admin password for " + creds.Admin.Username}
		}
	}
	return m, nil
}

func (m Model) move(delta int) (tea.Model, tea.Cmd) {
	m.cursor += delta
	m.clampCursor()
	return m, m.syncLogs()
}

func (m Model) switchScreen(s screenID) (tea.Model, tea.Cmd) {
	m.screen = s
	m.relayout()
	return m, nil
}

func (m Model) handleClick(id string) (tea.Model, tea.Cmd) {
	switch {
	case strings.HasPrefix(id, "row:"):
		var row int
		fmt.Sscanf(id, "row:%d", &row)
		m.cursor = row
		m.clampCursor()
		return m, m.syncLogs()
	case strings.HasPrefix(id, "tab:"):
		var s int
		fmt.Sscanf(id, "tab:%d", &s)
		return m.switchScreen(screenID(s))
	case strings.HasPrefix(id, "side:"):
		var t int
		fmt.Sscanf(id, "side:%d", &t)
		m.tab = sidebarTab(t)
		return m, m.syncLogs()
	}
	return m, nil
}

// runTask starts a background action and reports it in the tasks overlay.
func (m Model) runTask(action Action, ids []string, title string) (tea.Model, tea.Cmd) {
	t := m.tasks.start(title)
	backend := m.backend
	m.setFlash("… "+title, levelInfo)
	run := func() tea.Msg {
		log := events.New(events.SinkFunc(t.append))
		err := backend.Run(t.ctx, action, ids, log)
		return taskDoneMsg{id: t.id, title: title, err: err}
	}
	return m, tea.Batch(run, m.spin.Tick)
}

// Logs

func (m Model) logTarget() string {
	if m.pinned != "" {
		return m.pinned
	}
	return m.selectedID()
}

func (m *Model) stopLogs() {
	if m.stream != nil {
		m.stream.cancel()
		m.stream = nil
	}
}

// syncLogs (re)starts the log stream when the target changes.
func (m *Model) syncLogs() tea.Cmd {
	if !m.sidebarShown() || m.tab != tabLogs || m.screen != screenApps {
		return nil
	}
	target := m.logTarget()
	if target == "" || (m.stream != nil && m.stream.target == target) {
		return nil
	}
	m.stopLogs()
	m.logLines = nil
	m.logs.SetContent("")
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

func (m *Model) appendLogs(text string) {
	for _, line := range strings.Split(strings.TrimRight(text, "\n"), "\n") {
		if strings.TrimSpace(line) != "" {
			m.logLines = append(m.logLines, line)
		}
	}
	if len(m.logLines) > maxLogLines {
		m.logLines = m.logLines[len(m.logLines)-maxLogLines:]
	}
	m.logs.SetContentLines(m.logLines)
	if m.follow {
		m.logs.GotoBottom()
	}
}

var _ io.Writer = chanWriter{}
