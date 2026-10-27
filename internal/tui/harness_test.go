package tui

import (
	"context"
	"fmt"
	"image/color"
	"io"
	"io/fs"
	"os/exec"
	"reflect"
	"slices"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"

	tea "charm.land/bubbletea/v2"
	stepstatus "github.com/ajnart/self-host/internal/status"
	"github.com/charmbracelet/x/ansi"

	"github.com/ajnart/self-host/internal/activity"
	"github.com/ajnart/self-host/internal/app"
	"github.com/ajnart/self-host/internal/catalog"
	"github.com/ajnart/self-host/internal/events"
	"github.com/ajnart/self-host/internal/host"
	"github.com/ajnart/self-host/internal/service"
	"github.com/ajnart/self-host/internal/systemtest"
	"github.com/ajnart/self-host/internal/telemetry"
)

type fakeBackend struct {
	cloudflarePlan   func(service.CloudflareOptions) (service.CloudflarePlan, error)
	mu               sync.Mutex
	folders          *systemtest.Folders
	home             string
	status           service.Status
	checks           []host.Check
	onboardingChecks []host.Check
	onboardingCheck  func(context.Context, service.InstallOptions) []host.Check
	actions          []string
	opened           []string
	// tools maps a program name to its path on PATH; executed are the
	// commands ExecTool was given, and toolErr is what they exit with.
	tools       map[string]string
	executed    []*exec.Cmd
	toolErr     error
	aliases     map[string]string
	catalog     *catalog.Catalog
	install     []service.InstallOptions
	fail        error
	latest      string
	review      []service.SettingReview
	containers  []service.ContainerStatus
	updates     map[string]string
	updateCalls int
	// compose replaces every App's Compose file when set.
	compose string
	// statusErr is what Status returns, such as ErrNoProject before an
	// install creates the Project.
	statusErr error
	glyphs    activity.Glyphs
	saved     []activity.Glyphs
	// glyphErr is what SetGlyphs returns.
	glyphErr error
	// experience is the saved Experience level and savedExperience every
	// level SetExperience received.
	experience      string
	savedExperience []string
	// holdLogs makes Logs follow a never-ending stream until it is
	// cancelled; logStarts counts the streams opened and logsRunning those
	// still open.
	holdLogs    bool
	logStarts   int
	logsRunning int
	// usage is what the Usage stream reports; usageStarts counts the streams
	// opened and usageRunning those still open.
	usage        []service.ContainerUsage
	usageStarts  int
	usageRunning int
	// archives is what Backups lists, archiveApps the Apps in each archive's
	// manifest by path, archivePass the passphrase that opens encrypted
	// ones, and requests every Request Run received.
	archives    []service.BackupInfo
	archiveApps map[string][]string
	archivePass string
	backupLists int
	requests    []Request
	// skipped is the release the person last skipped, skips what SkipUpdate
	// saved; selfUpdates counts SelfUpdate calls (it installs updateTo or
	// fails with updateErr) and restarts the Restart calls (restartErr).
	skipped     string
	skips       []string
	selfUpdates int
	updateTo    string
	updateErr   error
	restarts    int
	restartErr  error
	// telemetryNotice is what TelemetryNotice returns.
	telemetryNotice string
	// onboardingReports is every event ReportOnboarding received.
	onboardingReports []telemetry.Onboarding
}

func (b *fakeBackend) CloudflarePlan(opts service.CloudflareOptions) (service.CloudflarePlan, error) {
	if b.cloudflarePlan != nil {
		return b.cloudflarePlan(opts)
	}
	p := service.CloudflarePlan{Risk: "Anyone in the world can reach the login page. A flaw could let strangers in. Cloudflare sees traffic."}
	for _, id := range opts.Apps {
		a := service.CloudflareApp{App: id, Name: id + "." + opts.Domain, Address: "https://" + id + "." + opts.Domain}
		if candidate, ok := b.catalog.App(id); ok {
			a.Warning, _ = service.CloudflarePublicationWarning(candidate.Info())
		}
		p.Publish = append(p.Publish, a)
		p.Additions = append(p.Additions, a)
	}
	return p, nil
}

func (f *fakeBackend) ListFolders(dir string) ([]string, error) {
	if f.folders == nil {
		return nil, fs.ErrNotExist
	}
	return f.folders.List(dir)
}

func (f *fakeBackend) UserHome() string { return f.home }

func (f *fakeBackend) TelemetryNotice() string {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.telemetryNotice
}

func (f *fakeBackend) ReportOnboarding(o telemetry.Onboarding) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.onboardingReports = append(f.onboardingReports, o)
}

func (f *fakeBackend) reportedOnboarding() []telemetry.Onboarding {
	f.mu.Lock()
	defer f.mu.Unlock()
	return append([]telemetry.Onboarding(nil), f.onboardingReports...)
}

func (f *fakeBackend) usageStreams() (started, running int) {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.usageStarts, f.usageRunning
}

func (f *fakeBackend) Usage(ctx context.Context, emit func([]service.ContainerUsage)) error {
	f.mu.Lock()
	f.usageStarts++
	f.usageRunning++
	usage := f.usage
	f.mu.Unlock()
	defer func() {
		f.mu.Lock()
		f.usageRunning--
		f.mu.Unlock()
	}()
	emit(usage)
	<-ctx.Done()
	return ctx.Err()
}

func (f *fakeBackend) logStreams() (started, running int) {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.logStarts, f.logsRunning
}

func (f *fakeBackend) Glyphs(context.Context) activity.Glyphs {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.glyphs
}

func (f *fakeBackend) SetGlyphs(_ context.Context, g activity.Glyphs) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.glyphs = g
	f.saved = append(f.saved, g)
	return f.glyphErr
}

func (f *fakeBackend) savedGlyphs() []activity.Glyphs {
	f.mu.Lock()
	defer f.mu.Unlock()
	return append([]activity.Glyphs(nil), f.saved...)
}

func (f *fakeBackend) Experience(context.Context) string {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.experience
}

func (f *fakeBackend) SetExperience(_ context.Context, level string) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.experience = level
	f.savedExperience = append(f.savedExperience, level)
	return nil
}

func (f *fakeBackend) savedExperiences() []string {
	f.mu.Lock()
	defer f.mu.Unlock()
	return append([]string(nil), f.savedExperience...)
}

func (f *fakeBackend) ReviewSettings(context.Context) ([]service.SettingReview, error) {
	return f.review, nil
}

func (f *fakeBackend) Catalog() *catalog.Catalog {
	if f.catalog == nil {
		return catalog.New(nil, nil)
	}
	return f.catalog
}
func (f *fakeBackend) Detect(context.Context) map[string]string {
	return map[string]string{"TZ": "Europe/Paris", "LAN_IP": "192.168.1.20", "PUID": "1000", "PGID": "1000",
		"MEDIA_ROOT": "/home/alice/media", "DOWNLOADS_ROOT": "/home/alice/downloads"}
}
func (f *fakeBackend) installs() []service.InstallOptions {
	f.mu.Lock()
	defer f.mu.Unlock()
	return append([]service.InstallOptions(nil), f.install...)
}

func (f *fakeBackend) LatestRelease(context.Context) string { return f.latest }

func (f *fakeBackend) SkippedUpdate() string {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.skipped
}

func (f *fakeBackend) SkipUpdate(version string) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.skips = append(f.skips, version)
}

func (f *fakeBackend) SelfUpdate(context.Context) (string, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.selfUpdates++
	return f.updateTo, f.updateErr
}

func (f *fakeBackend) Restart() error {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.restarts++
	return f.restartErr
}

func (f *fakeBackend) Status(context.Context) (service.Status, error) { return f.status, f.statusErr }
func (f *fakeBackend) Doctor(context.Context) []host.Check            { return f.checks }
func (f *fakeBackend) OnboardingChecks(ctx context.Context, opts service.InstallOptions) []host.Check {
	if f.onboardingCheck != nil {
		return f.onboardingCheck(ctx, opts)
	}
	return f.onboardingChecks
}
func (f *fakeBackend) Containers(context.Context) ([]service.ContainerStatus, error) {
	return f.containers, nil
}
func (f *fakeBackend) Updates(context.Context, service.Status) map[string]string {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.updateCalls++
	if f.updates == nil {
		return map[string]string{}
	}
	return f.updates
}
func (f *fakeBackend) Credentials(context.Context) (service.Credentials, error) {
	var c service.Credentials
	c.Admin.Username, c.Admin.Password = "admin", "s3cret-pass"
	c.Admin.Aliases = f.aliases
	c.Apps = map[string]map[string]string{"jellyfin": {"JELLYFIN_API_KEY": "synthetic-api-key"}}
	return c, nil
}
func (f *fakeBackend) Compose(_ context.Context, id string) (string, error) {
	if f.compose != "" {
		return f.compose, nil
	}
	return "services:\n  " + id + ":\n    image: example/" + id + ":latest\n", nil
}
func (f *fakeBackend) Logs(_ context.Context, id string, w io.Writer) error {
	f.mu.Lock()
	f.logStarts++
	hold := f.holdLogs
	if hold {
		f.logsRunning++
	}
	f.mu.Unlock()
	if !hold {
		io.WriteString(w, id+"-1  | ready on :80\n")
		return nil
	}
	defer func() {
		f.mu.Lock()
		f.logsRunning--
		f.mu.Unlock()
	}()
	for {
		if _, err := io.WriteString(w, id+"-1  | still here\n"); err != nil {
			return err
		}
	}
}
func (f *fakeBackend) OpenURL(url string) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.opened = append(f.opened, url)
	return nil
}
func (f *fakeBackend) LookTool(name string) (string, bool) {
	path, ok := f.tools[name]
	return path, ok
}

func (f *fakeBackend) ExecTool(cmd *exec.Cmd, done func(error) tea.Msg) tea.Cmd {
	f.mu.Lock()
	f.executed = append(f.executed, cmd)
	f.mu.Unlock()
	return func() tea.Msg { return done(f.toolErr) }
}

func (f *fakeBackend) Run(_ context.Context, req Request, log *events.Logger) error {
	f.mu.Lock()
	entry := strings.TrimSpace(string(req.Action) + " " + strings.Join(append(req.IDs, req.Pairs...), " "))
	f.actions = append(f.actions, entry)
	f.requests = append(f.requests, req)
	if req.Install != nil {
		f.install = append(f.install, *req.Install)
	}
	f.mu.Unlock()
	log.Emit(events.Event{Event: events.StepOK, Step: string(req.Action), Msg: string(req.Action) + " done"})
	return f.fail
}
func (f *fakeBackend) Actions() []string {
	f.mu.Lock()
	defer f.mu.Unlock()
	return append([]string(nil), f.actions...)
}

func sampleStatus() service.Status {
	return service.Status{
		Project: "/home/alice/.self-host", Exposure: "lan", LANIP: "192.168.1.20",
		Settings: map[string]string{"TZ": "Europe/Paris", "PUID": "1000", "PGID": "1000", "UMASK": "022"},
		Apps: []service.AppStatus{
			{ID: "jellyfin", Name: "Jellyfin", Managed: true, URL: "http://192.168.1.20:8096", Port: 8096, State: "running", Health: "healthy", Setup: stepstatus.SetupOK, Image: "lscr.io/linuxserver/jellyfin:latest"},
			{ID: "sonarr", Name: "Sonarr", Managed: true, URL: "http://192.168.1.20:8989", Port: 8989, State: "running", Setup: stepstatus.SetupIncomplete,
				Steps: []service.StepStatus{{ID: "download-client", Status: stepstatus.StepFail, Error: "qBittorrent refused login", Hint: "Add qBittorrent under Settings › Download Clients."}}},
			{ID: "whoami", Name: "whoami", URL: "http://192.168.1.20:8099", Port: 8099, State: "exited", Setup: stepstatus.SetupUnmanaged},
		},
	}
}

func sample(t *testing.T, width, height int) (Model, *fakeBackend) {
	t.Helper()
	backend := &fakeBackend{status: sampleStatus(), checks: []host.Check{
		{ID: "docker", Title: "Docker", Level: host.OK}, {ID: "compose", Title: "Docker Compose", Level: host.OK},
		{ID: "firewall", Title: "Firewall", Level: host.Warn, Detail: "ufw is active", Hint: "sudo ufw allow from 192.168.0.0/16 to any port 8096"},
	}}
	m := New(backend, Options{Version: "1.0.0", NoStartupPrompts: true, Now: func() time.Time { return time.Date(2026, 10, 6, 12, 0, 0, 0, time.UTC) }})
	m = update(t, m, tea.WindowSizeMsg{Width: width, Height: height})
	m = drive(t, m, statusMsg{status: backend.status})
	m = update(t, m, doctorMsg{checks: backend.checks})
	m.opening = 0
	return m, backend
}

func update(t *testing.T, m Model, msg tea.Msg) Model {
	t.Helper()
	next, _ := m.Update(msg)
	return next.(Model)
}

// drive applies msg and runs resulting commands until quiet, feeding their
// messages back, like the Bubble Tea runtime would.
func drive(t *testing.T, m Model, msg tea.Msg) Model {
	t.Helper()
	queue := []tea.Msg{msg}
	for steps := 0; len(queue) > 0 && steps < 200; steps++ {
		next, cmd := m.Update(queue[0])
		m, queue = next.(Model), queue[1:]
		queue = append(queue, runCmd(cmd)...)
	}
	return m
}

// cmdWait is how long drive waits for a command before it takes it for a
// listener or a timer. The Backend fake answers at once, so it is short.
const cmdWait = 40 * time.Millisecond

func runCmd(cmd tea.Cmd) []tea.Msg {
	if cmd == nil {
		return nil
	}
	done := make(chan tea.Msg, 1)
	go func() { done <- cmd() }()
	select {
	case msg := <-done:
		switch msg := msg.(type) {
		case nil:
			return nil
		case tea.BatchMsg:
			var out []tea.Msg
			for _, c := range msg {
				out = append(out, runCmd(c)...)
			}
			return out
		case tickMsg, tea.QuitMsg, frameMsg, updatesTick:
			return nil
		default:
			// tea.Sequence yields an unexported []tea.Cmd; run it in order.
			if v := reflect.ValueOf(msg); v.Kind() == reflect.Slice && v.Type().Elem() == reflect.TypeFor[tea.Cmd]() {
				var out []tea.Msg
				for i := 0; i < v.Len(); i++ {
					out = append(out, runCmd(v.Index(i).Interface().(tea.Cmd))...)
				}
				return out
			}
			return []tea.Msg{msg}
		}
	case <-time.After(cmdWait):
		return nil // long-lived listeners (log follow) and cursor blinks are dropped
	}
}

func press(s string) tea.KeyPressMsg {
	switch s {
	case "enter":
		return tea.KeyPressMsg{Code: tea.KeyEnter}
	case "esc":
		return tea.KeyPressMsg{Code: tea.KeyEscape}
	case "tab":
		return tea.KeyPressMsg{Code: tea.KeyTab}
	case "down":
		return tea.KeyPressMsg{Code: tea.KeyDown}
	case "up":
		return tea.KeyPressMsg{Code: tea.KeyUp}
	case "left":
		return tea.KeyPressMsg{Code: tea.KeyLeft}
	case "right":
		return tea.KeyPressMsg{Code: tea.KeyRight}
	case "shift+tab":
		return tea.KeyPressMsg{Code: tea.KeyTab, Mod: tea.ModShift}
	case "space":
		return tea.KeyPressMsg{Code: tea.KeySpace, Text: " "}
	case "backspace":
		return tea.KeyPressMsg{Code: tea.KeyBackspace}
	case "ctrl+u":
		return tea.KeyPressMsg{Code: 'u', Mod: tea.ModCtrl}
	}
	r := []rune(s)[0]
	return tea.KeyPressMsg{Code: r, Text: s}
}

func ctrlS() tea.KeyPressMsg { return tea.KeyPressMsg{Code: 's', Mod: tea.ModCtrl} }

func pgupKey() tea.KeyPressMsg   { return tea.KeyPressMsg{Code: tea.KeyPgUp} }
func pgdownKey() tea.KeyPressMsg { return tea.KeyPressMsg{Code: tea.KeyPgDown} }

func wheelMsg(down bool) tea.MouseWheelMsg {
	button := tea.MouseWheelUp
	if down {
		button = tea.MouseWheelDown
	}
	return tea.MouseWheelMsg{Button: button}
}

func screen(m Model) string { return ansi.Strip(m.View().Content) }

func statusMsgFor(err error) statusMsg { return statusMsg{err: err} }

func windowSize(w, h int) tea.WindowSizeMsg { return tea.WindowSizeMsg{Width: w, Height: h} }

func ctrlC() tea.KeyPressMsg { return tea.KeyPressMsg{Code: 'c', Mod: tea.ModCtrl} }

func lightBackground() tea.BackgroundColorMsg { return tea.BackgroundColorMsg{Color: color.White} }

func TestOverviewShowsAppsNeedsAttentionAndNowStrip(t *testing.T) {
	m, _ := sample(t, 140, 32)

	out := screen(m)

	for _, want := range []string{"self-host", "LAN 192.168.1.20", "1 warning",
		"Apps", "Jellyfin", "192.168.1.20:8096", "Sonarr", "whoami",
		"Needs attention", "Now"} {
		if !strings.Contains(out, want) {
			t.Errorf("dashboard lacks %q\n%s", want, out)
		}
	}
	v := m.View()
	if !v.AltScreen || v.MouseMode != tea.MouseModeCellMotion || !v.ReportFocus || !strings.Contains(v.WindowTitle, "self-host") {
		t.Fatal("dashboard must use alt screen, mouse, focus reporting and a window title")
	}
}

func TestStatusLevelsAreOkAttentionBroken(t *testing.T) {
	want := map[string]string{"jellyfin": "ok", "sonarr": "broken", "whoami": "broken"}
	for _, app := range sampleStatus().Apps {
		if got := service.Level(app); got != want[app.ID] {
			t.Errorf("%s Status = %s, want %s", app.ID, got, want[app.ID])
		}
	}
	starting := service.AppStatus{State: "running", Health: "starting", Setup: stepstatus.SetupOK}
	if got := service.Level(starting); got != "attention" {
		t.Errorf("starting App Status = %s, want attention", got)
	}
}

func TestNeedsAttentionNamesTheActionForEachProblem(t *testing.T) {
	m, _ := sample(t, 140, 40)
	m = update(t, m, updatesMsg{updates: map[string]string{"jellyfin": "available"}})

	out := screen(m)

	for _, want := range []string{
		"Sonarr: download-client failed", "a r retry Setup",
		"whoami is stopped", "a s start",
		"Jellyfin has an update", "a u update",
		"Firewall: ufw is active",
	} {
		if !strings.Contains(out, want) {
			t.Errorf("Needs attention lacks %q\n%s", want, out)
		}
	}
}

func TestNothingNeedsAttentionWhenAllIsWell(t *testing.T) {
	m, backend := sample(t, 140, 32)
	backend.status.Apps = backend.status.Apps[:1]
	m = update(t, m, statusMsg{status: backend.status})
	m = update(t, m, doctorMsg{checks: []host.Check{{ID: "docker", Title: "Docker", Level: host.OK}}})

	if !strings.Contains(screen(m), "Nothing needs your attention") {
		t.Fatalf("calm state not shown\n%s", screen(m))
	}
}

// The keybind audit: the Dashboard's keys are exactly the global, pane,
// read-only and Action menu keys
// docs/adr/0004-tabbed-command-center-action-chords.md lists, and each
// pane's own hints as the bar and help show them. No key changes an App or
// the Project directly, and no Stack key survives: the Apps tab holds its
// containers. Adding one means changing the ADR and this test on purpose.
func TestKeybindAudit(t *testing.T) {
	want := []string{
		// Global keys.
		"tabs: 1 2 3 4 5", "previous tab: left", "next tab: right", "Project: A", "help: ?", "quit: q ctrl+c",
		// Moving within a tab.
		"up: up k", "down: down j", "next pane: tab", "previous pane: shift+tab",
		"previous sub-tab: [", "next sub-tab: ]", "page up: pgup", "page down: pgdown",
		// The App's Action menu and the read-only keys.
		"actions: a", "resolve: a", "open: o", "copy: c", "search: /", "back: esc", "go to App: enter", "details: enter",
		// Settings applies its pending changes.
		"apply: ctrl+s", "select: space", "focus: ↑/↓", "copy error: c", "full error: e",
		// The open Action menu.
		"highlight an Action: letter", "run: enter", "run; destructive Actions need it twice: enter", "close: esc",
		// Pane hints for the bar and help.
		"select: ↑/↓", "scroll: ↑/↓", "sub-tab: [/]", "page: pgup/pgdn",
		"copy: enter", "refresh: r", "error/hint: enter", "collapse: space",
		"pick: space", "review: enter", "install: enter", "next input: tab",
		"edit: enter", "accept: enter", "cancel: esc", "next choice: tab",
		"done: enter", "clear: esc",
		// Settings' About sub-tab and the pre-boot screen open the donation
		// pages; pre-boot also skips to Activity.
		"coffee: c", "sponsor: s", "Ko-fi: c", "GitHub Sponsors: s", "Star us on GitHub: g", "skip: enter",
		// Settings' Appearance pane saves the highlighted glyph set at once.
		"choose: enter",
		// ? opens the help page of an Access option, in Onboarding's Access step and Settings' Access sub-tab; esc or ? closes it.
		"more: ?", "close: esc/?",
		// Settings' Backups sub-tab.
		"back up: b", "restore: enter",
		"continue: enter", "choose App: y/n", "confirm word: enter",
	}
	ctx := testViewContext(&fakeBackend{})
	views := []view{newDashboardView(newAppsView()), newAppsView(), &activityView{}, newInstallView(ctx), newSettingsView(ctx), newHelpView()}
	bindings := append(newKeyMap().all(), menuKeys...)
	bindings = append(bindings, menuHelpKeys...)
	bindings = append(bindings, prebootKeys...)
	for _, v := range views {
		bindings = append(bindings, v.Keys()...)
		for _, p := range v.Panes() {
			bindings = append(bindings, p.keys...)
		}
	}
	var got []string
	seen := map[string]bool{}
	for _, b := range bindings {
		s := b.Help().Desc + ": " + strings.Join(b.Keys(), " ")
		if seen[s] {
			continue
		}
		seen[s] = true
		got = append(got, s)
	}
	slices.Sort(want)
	slices.Sort(got)
	if !slices.Equal(got, want) {
		t.Fatalf("keybinds changed:\n got %q\nwant %q", got, want)
	}
	var panes []string
	for _, p := range newSettingsView(ctx).Panes() {
		panes = append(panes, p.name)
	}
	if !slices.Contains(panes, "Access") || slices.Contains(panes, "Exposure row") || slices.Contains(panes, "Exposure choice") {
		t.Fatalf("Settings has an Access pane and no Exposure panes: %q", panes)
	}
}

func TestRemovedKeysDoNothing(t *testing.T) {
	m, backend := sample(t, 140, 32)
	m = update(t, m, updatesMsg{updates: map[string]string{"jellyfin": service.UpdateAvailable}})
	before := screen(m)

	// i, s, d and w opened views before the tabs replaced them; u, r and b
	// updated, retried Setup and backed up before the Action menu.
	for _, k := range []string{"i", "s", "d", "w", "u", "r", "b", "x", "X", "S", "t", "l", "L", "f", "U", "e"} {
		m = drive(t, m, press(k))
	}

	if len(backend.Actions()) != 0 || screen(m) != before {
		t.Fatalf("removed keys must be inert; actions %v\n%s", backend.Actions(), screen(m))
	}
}

func TestNoTabHasADirectMutatingKey(t *testing.T) {
	m, backend := appsHost(t)
	m = update(t, m, updatesMsg{updates: map[string]string{"jellyfin": service.UpdateAvailable}})

	for _, tab := range []string{"1", "2", "3"} {
		m = drive(t, m, press(tab))
		for _, k := range []string{"enter", "u", "r", "b", "enter"} {
			m = drive(t, m, press(k))
		}
	}

	if got := backend.Actions(); len(got) != 0 {
		t.Fatalf("enter, u, r and b must not change anything: %v", got)
	}
}

func TestSetupTabShowsFailedStepAndHint(t *testing.T) {
	m, _ := sample(t, 140, 32)

	m = drive(t, m, press("2"))
	m = drive(t, m, press("j"))
	m = drive(t, m, press("]"))

	out := screen(m)
	if !strings.Contains(out, "qBittorrent refused login") || !strings.Contains(out, "→ Add qBittorrent") {
		t.Fatalf("setup tab lacks failed step and hint\n%s", out)
	}
}

func TestOpenUsesTheLANURLAndCopyGetsThePassword(t *testing.T) {
	m, backend := sample(t, 140, 32)
	m = drive(t, m, press("o"))
	m = drive(t, m, press("c"))
	if !slices.Equal(backend.opened, []string{"http://192.168.1.20:8096"}) {
		t.Fatalf("opened %v", backend.opened)
	}
	if !strings.Contains(screen(m), "Admin password") || !strings.Contains(screen(m), "Jellyfin API key") {
		t.Fatal("copy picker must offer password and selected App API key")
	}
	for _, value := range []string{"s3cret-pass", "synthetic-api-key"} {
		if strings.Contains(screen(m), value) {
			t.Fatal("copy picker displayed a credential value")
		}
	}
	next, cmd := m.Update(press("enter"))
	m = next.(Model)
	copied, ok := cmd().(clipboardMsg)
	if !ok || copied.text != "s3cret-pass" {
		t.Fatal("password choice must copy the Admin password")
	}
	m = drive(t, m, press("c"))
	m = drive(t, m, press("down"))
	next, cmd = m.Update(press("enter"))
	m = next.(Model)
	copied, ok = cmd().(clipboardMsg)
	if !ok || copied.text != "synthetic-api-key" {
		t.Fatal("API key choice must copy the selected App API key")
	}
	m = drive(t, m, press("c"))
	m = drive(t, m, press("esc"))
	if m.apps.copy != nil {
		t.Fatal("esc must close the copy picker")
	}
}

func TestCopyPickerNamesAndCopiesAnAppLoginAlias(t *testing.T) {
	m, backend := sample(t, 140, 32)
	backend.aliases = map[string]string{"jellyfin": "selfhost-admin"}

	m = drive(t, m, press("c"))
	if !strings.Contains(screen(m), "Jellyfin username") {
		t.Fatalf("copy picker must name the App's Admin login alias\n%s", screen(m))
	}
	if strings.Contains(screen(m), "selfhost-admin") {
		t.Fatal("copy picker displayed the alias value")
	}
	m = drive(t, m, press("down"))
	next, cmd := m.Update(press("enter"))
	m = next.(Model)
	copied, ok := cmd().(clipboardMsg)
	if !ok || copied.text != "selfhost-admin" {
		t.Fatal("username choice must copy the App's Admin login alias")
	}
}

func TestStatusLineShowsTheRunningActionThenItsResult(t *testing.T) {
	m, _ := sample(t, 140, 32)

	m = drive(t, m, press("a"))
	m = drive(t, m, press("t"))
	next, cmd := m.Update(press("enter"))
	m = next.(Model)
	if !strings.Contains(statusLine(screen(m)), "restart jellyfin") {
		t.Fatalf("the status line should name the running Action\n%s", statusLine(screen(m)))
	}
	for _, msg := range runCmd(cmd) {
		m = drive(t, m, msg)
	}
	if !strings.Contains(statusLine(screen(m)), "✓ restart jellyfin") {
		t.Fatalf("the status line should report the result\n%s", statusLine(screen(m)))
	}
}

// helpText opens help and reads it to the end, page by page, the way a
// person scrolls it.
func helpText(t *testing.T, m Model) string {
	t.Helper()
	m = drive(t, m, press("?"))
	var pages []string
	for range 20 {
		page := ansi.Strip(m.renderOverlay())
		if len(pages) > 0 && page == pages[len(pages)-1] {
			break
		}
		pages = append(pages, page)
		m = drive(t, m, pgdownKey())
	}
	return strings.Join(pages, "\n")
}

func lastLine(s string) string {
	lines := strings.Split(s, "\n")
	return lines[len(lines)-1]
}

// statusLine is the row above the bar.
func statusLine(s string) string {
	lines := strings.Split(s, "\n")
	return lines[len(lines)-2]
}

func TestInstallOpensTheCatalogAndInstallsThePick(t *testing.T) {
	m, backend := sample(t, 140, 32)
	backend.catalog = wizardCatalog()

	m = drive(t, m, press("4"))
	if !strings.Contains(screen(m), "Catalog") || !strings.Contains(screen(m), "ntfy") {
		t.Fatalf("Catalog not shown\n%s", screen(m))
	}
	m = drive(t, m, press("/"))
	m = typeText(t, m, "ntfy")
	m = drive(t, m, press("enter"))
	if rows := m.installRows(); len(rows) != 1 || rows[0].key != "app:ntfy" {
		t.Fatalf("filter did not narrow to ntfy: %+v", rows)
	}
	m = drive(t, m, press("space"))
	m = drive(t, m, press("enter"))
	if !strings.Contains(screen(m), "Review") {
		t.Fatalf("no review\n%s", screen(m))
	}
	m = drive(t, m, press("enter"))

	got := backend.installs()
	if len(got) != 1 || strings.Join(got[0].Targets, ",") != "ntfy" {
		t.Fatalf("installs %+v", got)
	}
	if out := screen(m); m.surface != surfaceActivity || !strings.Contains(out, "✓ install ntfy") {
		t.Fatalf("approving the install should hand focus to Activity\n%s", out)
	}
	m = drive(t, m, press("4"))
	if strings.Contains(screen(m), "Review") {
		t.Fatalf("the Catalog should start afresh after an install\n%s", screen(m))
	}
}

func TestEscapeLeavesTheCatalogWithoutInstalling(t *testing.T) {
	m, backend := sample(t, 140, 32)
	backend.catalog = wizardCatalog()

	m = drive(t, m, press("4"))
	m = drive(t, m, press("esc"))

	if !strings.Contains(screen(m), "Needs attention") || len(backend.installs()) != 0 {
		t.Fatalf("esc must return to the Overview and install nothing\n%s", screen(m))
	}
}

func TestHelpListsEveryKey(t *testing.T) {
	m, _ := sample(t, 140, 100)

	help := helpText(t, m)
	for _, want := range []string{"tabs", "Project", "actions", "highlight an Action", "open", "copy", "select", "go to App", "quit"} {
		if !strings.Contains(help, want) {
			t.Errorf("help lacks %q\n%s", want, help)
		}
	}
}

func TestNarrowTerminalKeepsAppsAndNeedsAction(t *testing.T) {
	m, _ := sample(t, 80, 24)

	out := screen(m)
	for _, want := range []string{"Jellyfin", "Needs attention"} {
		if !strings.Contains(out, want) {
			t.Errorf("narrow layout lacks %q\n%s", want, out)
		}
	}
	for _, line := range strings.Split(out, "\n") {
		if ansi.StringWidth(line) > 80 {
			t.Fatalf("line wider than 80 columns: %q", line)
		}
	}
}

func TestMouseClickSelectsRow(t *testing.T) {
	m, _ := sample(t, 140, 32)

	m = drive(t, m, clickMsg{id: rowLayerID(2)})

	if m.selectedID() != "whoami" {
		t.Fatalf("selected %q", m.selectedID())
	}
}

func TestFocusRefreshesStatus(t *testing.T) {
	m, _ := sample(t, 140, 32)

	if _, cmd := m.Update(tea.FocusMsg{}); cmd == nil {
		t.Fatal("focus should trigger a refresh")
	}
}

func TestLightBackgroundSwitchesPalette(t *testing.T) {
	m, _ := sample(t, 140, 32)
	dark := m.View().Content

	m = update(t, m, lightBackground())

	if m.View().Content == dark {
		t.Fatal("palette did not change for a light terminal")
	}
}

func TestUpdatesSurviveStatusRefresh(t *testing.T) {
	m, _ := sample(t, 140, 32)
	m = update(t, m, updatesMsg{updates: map[string]string{"jellyfin": "available"}})

	m = update(t, m, statusMsg{status: sampleStatus()})

	if !strings.Contains(screen(m), "⚠ 1 update") {
		t.Fatal("refresh dropped update information")
	}
}

// inputCatalog has one App with a long description and a Required input.
func inputCatalog() *catalog.Catalog {
	return catalog.New([]app.App{
		stubApp{info: app.Info{ID: "arr", Name: "Arr", Category: "Media",
			Description: "A deliberately long description of what this App does, wrapping over several lines so the whole thing must be shown and then it ends with the marker ZINTAIL.",
			Image:       "example/arr:latest", Port: 1234, Docs: "https://example.test/arr"},
			inputs: []app.Input{{Key: "api", Prompt: "API key", Required: true}}},
	}, nil)
}

// bigCatalog is 40 Apps in one category, to prove the list scrolls.
func bigCatalog() *catalog.Catalog {
	var apps []app.App
	for i := 0; i < 40; i++ {
		id := fmt.Sprintf("app%02d", i)
		apps = append(apps, stubApp{info: app.Info{ID: id, Name: fmt.Sprintf("App %02d", i),
			Description: "an App", Category: "Group"}})
	}
	return catalog.New(apps, nil)
}

func TestInstallSearchFiltersAndShowsTheFullDescription(t *testing.T) {
	m, backend := sample(t, 140, 40)
	backend.catalog = wizardCatalog()

	m = drive(t, m, press("4"))
	m = drive(t, m, press("/"))
	m = typeText(t, m, "notif")
	m = drive(t, m, press("enter"))

	rows := m.installRows()
	if len(rows) != 1 || rows[0].key != "app:ntfy" {
		t.Fatalf("'notif' should filter to ntfy, got %+v", rows)
	}
	if !m.install.searching && m.install.filter != "notif" {
		t.Fatalf("filter not kept after enter: %q", m.install.filter)
	}

	m2, backend2 := sample(t, 140, 40)
	backend2.catalog = inputCatalog()
	m2 = drive(t, m2, press("4"))
	out := screen(m2)
	if !strings.Contains(out, "ZINTAIL") {
		t.Fatalf("the full description must be shown untruncated\n%s", out)
	}
}

func TestInstallListScrollsToTheLastOfFortyApps(t *testing.T) {
	m, backend := sample(t, 80, 24)
	backend.catalog = bigCatalog()

	m = drive(t, m, press("4"))
	for i := 0; i < 60; i++ {
		m = drive(t, m, press("down"))
	}
	rows := m.installRows()
	if m.install.cursor != len(rows)-1 {
		t.Fatalf("cursor %d, want last of %d", m.install.cursor, len(rows))
	}
	if last := rows[len(rows)-1].name; !strings.Contains(screen(m), last) {
		t.Fatalf("the last item %q should be on screen\n%s", last, screen(m))
	}
}

func TestInstallReviewAsksForRequiredInputs(t *testing.T) {
	m, backend := sample(t, 140, 40)
	backend.catalog = inputCatalog()

	m = drive(t, m, press("4"))
	m = drive(t, m, press("space"))
	m = drive(t, m, press("enter"))
	if !strings.Contains(screen(m), "Required inputs") {
		t.Fatalf("review should ask for the Required input\n%s", screen(m))
	}
	m = typeText(t, m, "s3cret")
	m = drive(t, m, press("enter"))

	got := backend.installs()
	if len(got) != 1 {
		t.Fatalf("installs %+v", got)
	}
	if !slices.Contains(got[0].Sets, "arr.api=s3cret") {
		t.Fatalf("Sets %v should carry the required input", got[0].Sets)
	}
}

func settingsHost(t *testing.T) (Model, *fakeBackend) {
	t.Helper()
	return settingsHostWith(t, service.ExposureLAN)
}

// settingsHostWith is Settings on a Project whose stored Exposure is the one given.
func settingsHostWith(t *testing.T, exposure string) (Model, *fakeBackend) {
	t.Helper()
	m, backend := sample(t, 140, 40)
	backend.status.Exposure = exposure
	m = drive(t, m, statusMsg{status: backend.status})
	backend.review = []service.SettingReview{
		{Key: "EXPOSURE", Current: exposure, Choices: []string{"lan", "local"}},
		{Key: "LAN_IP", Current: "192.168.1.20", Detected: "192.168.1.20", Choices: []string{"192.168.1.20"}},
		{Key: "TZ", Current: "Europe/Paris", Detected: "Europe/Paris"},
		{Key: "PUID", Current: "1000", Detected: "1000"},
		{Key: "PGID", Current: "1000", Detected: "1000"},
		{Key: "UMASK", Current: "022"},
		{Key: "MEDIA_ROOT", Current: "/home/alice/media"},
		{Key: "DOWNLOADS_ROOT", Current: "/home/alice/downloads"},
	}
	m = drive(t, m, press("5"))
	return m, backend
}

func TestSettingsAppliesEveryChangeAtOnce(t *testing.T) {
	m, backend := settingsHost(t)

	for i := 0; i < 2; i++ { // LAN_IP, TZ → PUID
		m = drive(t, m, press("down"))
	}
	m = drive(t, m, press("enter"))
	m = drive(t, m, press("ctrl+u"))
	m = typeText(t, m, "1001")
	m = drive(t, m, press("enter"))
	for i := 0; i < 4; i++ { // PUID → DOWNLOADS_ROOT
		m = drive(t, m, press("down"))
	}
	m = drive(t, m, press("enter"))
	m = drive(t, m, press("ctrl+u"))
	m = typeText(t, m, "/srv/downloads")
	m = drive(t, m, press("enter"))
	m = drive(t, m, ctrlS())

	if got := backend.Actions(); !slices.Equal(got, []string{"config PUID=1001 DOWNLOADS_ROOT=/srv/downloads"}) {
		t.Fatalf("actions %v", got)
	}
	if m.surface != surfaceActivity || m.settings != nil {
		t.Fatal("ctrl+s should close Settings and hand focus to Activity")
	}
}

func TestSettingsRejectsAnInvalidValueInline(t *testing.T) {
	m, _ := settingsHost(t)

	for i := 0; i < 2; i++ {
		m = drive(t, m, press("down"))
	}
	m = drive(t, m, press("enter"))
	m = drive(t, m, press("ctrl+u"))
	m = typeText(t, m, "abc")
	m = drive(t, m, press("enter"))

	if m.settings.err == "" || !strings.Contains(screen(m), "PUID: a non-negative integer") {
		t.Fatalf("invalid PUID should be rejected inline\n%s", screen(m))
	}
	if len(m.settings.pairs()) != 0 {
		t.Fatal("an invalid value must not become a pending change")
	}
}

func TestSettingsEscapeWithPendingChangesAsksToDiscard(t *testing.T) {
	m, backend := settingsHostWith(t, service.ExposureLocal)

	m = pickHomeNetwork(t, m) // access: this computer only → Home network
	m = drive(t, m, press("esc"))

	if !m.settings.confirmDiscard || !strings.Contains(screen(m), "discard 1 changes? y/n") {
		t.Fatalf("esc with pending changes should ask before discarding\n%s", screen(m))
	}
	if len(backend.Actions()) != 0 {
		t.Fatal("nothing may be applied while asking")
	}
	m = drive(t, m, press("y"))
	if m.surface != surfaceDashboard || len(backend.Actions()) != 0 {
		t.Fatal("y should discard and return without applying")
	}
}

func appsHost(t *testing.T) (Model, *fakeBackend) {
	t.Helper()
	m, backend := sample(t, 140, 40)
	backend.containers = []service.ContainerStatus{
		{App: "jellyfin", Service: "jellyfin", Image: "lscr.io/linuxserver/jellyfin:latest", State: "running", Health: "healthy", Status: "Up 2 hours", Ports: []string{"0.0.0.0:8096→8096"}},
		{App: "sonarr", Service: "sonarr", State: "running", Status: "Up 2 hours", Ports: []string{"0.0.0.0:8989→8989"}},
		{App: "sonarr", Service: "sonarr-db", State: "running", Status: "Up 2 hours"},
		{App: "sonarr", Service: "sonarr-proxy", State: "running", Status: "Up 2 hours"},
		{App: "whoami", Service: "whoami", State: "running", Status: "Up 1 hour", Ports: []string{"0.0.0.0:8099→80"}},
		{App: "whoami", Service: "whoami-sidecar", State: "exited", Status: "Exited (0) 1 hour ago"},
		{App: "whoami", Service: "whoami-cache", State: "created", Status: "Created"},
	}
	backend.updates = map[string]string{"jellyfin": "available"}
	m = drive(t, m, press("2"))
	return m, backend
}

func TestEveryViewFitsEightyColumns(t *testing.T) {
	m, backend := sample(t, 80, 24)
	backend.catalog = inputCatalog()
	backend.containers = []service.ContainerStatus{
		{App: "jellyfin", Service: "jellyfin", State: "running", Health: "healthy", Status: "Up 2 hours", Ports: []string{"0.0.0.0:8096→8096"}},
	}
	backend.usage = []service.ContainerUsage{{Service: "jellyfin", CPU: 0.18, Mem: 0.31, MemBytes: 2540 << 20}}

	check := func(name string, m Model) {
		t.Helper()
		for _, line := range strings.Split(screen(m), "\n") {
			if ansi.StringWidth(line) > 80 {
				t.Fatalf("%s: line wider than 80 columns: %q", name, line)
			}
		}
	}
	sets := []activity.Glyphs{activity.Simple, activity.NerdFont}
	for _, set := range sets {
		m := drive(t, m, appearanceMsg{glyphs: set})
		for i, label := range tabLabels {
			check(string(set)+" "+label, drive(t, m, press(strconv.Itoa(i+1))))
		}
		settings := drive(t, m, press("5"))
		for _, name := range []string{"Access", "Appearance", "Backups", "Tools", "About"} {
			settings = drive(t, settings, press("]"))
			check(string(set)+" Settings "+name, settings)
		}
		check(string(set)+" Apps containers", drive(t, drive(t, m, press("2")), press("[")))
		check(string(set)+" Overview search", typeText(t, drive(t, m, press("/")), "son"))
		check(string(set)+" Apps search", typeText(t, drive(t, drive(t, m, press("2")), press("/")), "son"))
		check(string(set)+" help", drive(t, m, press("?")))
		access := drive(t, drive(t, m, press("5")), press("]"))
		check(string(set)+" Settings Access", access)
		check(string(set)+" Settings Access help", drive(t, access, press("?")))
		option := access
		for i := range accessOptions[1:] {
			option = drive(t, option, press("down"))
			check(fmt.Sprintf("%s Settings Access option %d", set, i+1), option)
			check(fmt.Sprintf("%s Settings Access option %d help", set, i+1), drive(t, option, press("?")))
		}
		check(string(set)+" Settings Access Bring your own note", drive(t, option, press("enter")))
		local, _ := settingsHostWith(t, service.ExposureLocal)
		local = update(t, local, windowSize(80, 24))
		check(string(set)+" Settings Access this computer only", drive(t, local, press("]")))
		check(string(set)+" Settings Access pending", drive(t, pickHomeNetwork(t, local), press("]")))
	}
	task := m.tasks.start("update every App in a Project with a long name")
	t.Cleanup(m.tasks.cancelAll)
	task.append(events.Event{Event: events.StepStart, Step: "pull", Msg: "pull 1 image"})
	task.append(events.Event{Event: events.PullProgress, Image: "example/image:latest", Layer: "l1", Current: 1, Total: 2})
	for _, set := range sets {
		m := drive(t, m, appearanceMsg{glyphs: set})
		check(string(set)+" Overview running", m)
		check(string(set)+" Activity running", drive(t, m, press("3")))
		check(string(set)+" App menu", drive(t, m, press("a")))
		check(string(set)+" Project menu", drive(t, m, press("A")))
	}
	for _, set := range sets {
		walkOnboarding(t, 80, 24, set, func(name string, m Model) { check(string(set)+" Onboarding "+name, m) })
	}
	pre, _, _ := approved(t, 80, 24)
	play(pre, pullStart("2"), downloading("ghcr.io/homarr-labs/homarr:latest"), pulledImage("binwiederhier/ntfy:latest"))
	for _, step := range []int{1, 30} {
		check("pre-boot pull", frames(t, pre, step))
	}
	play(pre, events.Event{Event: events.StepOK, Step: "pull"})
	for _, step := range []int{1, 30, 40} {
		pre = frames(t, pre, step)
		check("pre-boot exit", pre)
	}
}

// pickHomeNetwork takes Home network on Settings' Access sub-tab, from the
// Host sub-tab, and returns to the Host sub-tab.
func pickHomeNetwork(t *testing.T, m Model) Model {
	t.Helper()
	m = focusHomeNetwork(t, drive(t, m, press("]")))
	m = drive(t, m, press("enter"))
	return drive(t, m, press("["))
}

func focusHomeNetwork(t *testing.T, m Model) Model {
	t.Helper()
	for range accessOptions {
		m = drive(t, m, press("up"))
	}
	return m
}
