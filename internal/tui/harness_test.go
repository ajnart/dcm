package tui

import (
	"context"
	"image/color"
	"io"
	"reflect"
	"slices"
	"strings"
	"sync"
	"testing"
	"time"

	"charm.land/bubbles/v2/spinner"
	tea "charm.land/bubbletea/v2"
	"github.com/charmbracelet/x/ansi"

	"github.com/ajnart/self-host/internal/catalog"
	"github.com/ajnart/self-host/internal/events"
	"github.com/ajnart/self-host/internal/host"
	"github.com/ajnart/self-host/internal/service"
)

type fakeBackend struct {
	mu      sync.Mutex
	status  service.Status
	checks  []host.Check
	actions []string
	opened  []string
	catalog *catalog.Catalog
	install []service.InstallOptions
	fail    error
	latest  string
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

func (f *fakeBackend) Status(context.Context) (service.Status, error) { return f.status, nil }
func (f *fakeBackend) Doctor(context.Context) []host.Check            { return f.checks }
func (f *fakeBackend) Updates(context.Context, service.Status) map[string]string {
	return map[string]string{}
}
func (f *fakeBackend) Credentials(context.Context) (service.Credentials, error) {
	var c service.Credentials
	c.Admin.Username, c.Admin.Password = "admin", "s3cret-pass"
	return c, nil
}
func (f *fakeBackend) Compose(_ context.Context, id string) (string, error) {
	return "services:\n  " + id + ":\n    image: example/" + id + ":latest\n", nil
}
func (f *fakeBackend) Logs(_ context.Context, id string, w io.Writer) error {
	io.WriteString(w, id+"-1  | ready on :80\n")
	return nil
}
func (f *fakeBackend) OpenURL(url string) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.opened = append(f.opened, url)
	return nil
}
func (f *fakeBackend) Run(_ context.Context, req Request, log *events.Logger) error {
	f.mu.Lock()
	entry := strings.TrimSpace(string(req.Action) + " " + strings.Join(req.IDs, " "))
	f.actions = append(f.actions, entry)
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
		Project: "/home/alice/self-host", Exposure: "lan", LANIP: "192.168.1.20",
		Settings: map[string]string{"TZ": "Europe/Paris", "PUID": "1000", "PGID": "1000", "UMASK": "022"},
		Apps: []service.AppStatus{
			{ID: "jellyfin", Name: "Jellyfin", Managed: true, URL: "http://192.168.1.20:8096", Port: 8096, State: "running", Health: "healthy", Setup: "ok", Image: "lscr.io/linuxserver/jellyfin:latest"},
			{ID: "sonarr", Name: "Sonarr", Managed: true, URL: "http://192.168.1.20:8989", Port: 8989, State: "running", Setup: "incomplete",
				Steps: []service.StepStatus{{ID: "download-client", Status: "fail", Error: "qBittorrent refused login", Hint: "Add qBittorrent under Settings › Download Clients."}}},
			{ID: "whoami", Name: "whoami", URL: "http://192.168.1.20:8099", Port: 8099, State: "exited", Setup: "unmanaged"},
		},
	}
}

func sample(t *testing.T, width, height int) (Model, *fakeBackend) {
	t.Helper()
	backend := &fakeBackend{status: sampleStatus(), checks: []host.Check{
		{ID: "docker", Title: "Docker", Level: host.OK}, {ID: "compose", Title: "Docker Compose", Level: host.OK},
		{ID: "firewall", Title: "Firewall", Level: host.Warn, Detail: "ufw is active", Hint: "sudo ufw allow from 192.168.0.0/16 to any port 8096"},
	}}
	m := New(backend, Options{Version: "1.0.0", Now: func() time.Time { return time.Date(2026, 10, 6, 12, 0, 0, 0, time.UTC) }})
	m = update(t, m, tea.WindowSizeMsg{Width: width, Height: height})
	m = drive(t, m, statusMsg{status: backend.status})
	m = update(t, m, doctorMsg{checks: backend.checks})
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
		case tickMsg, tea.QuitMsg, spinner.TickMsg, updatesTick:
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
	case <-time.After(200 * time.Millisecond):
		return nil // long-lived listeners (log follow) are dropped
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
	case "space":
		return tea.KeyPressMsg{Code: tea.KeySpace, Text: " "}
	}
	r := []rune(s)[0]
	return tea.KeyPressMsg{Code: r, Text: s}
}

func screen(m Model) string { return ansi.Strip(m.View().Content) }

func statusMsgFor(err error) statusMsg { return statusMsg{err: err} }

func windowSize(w, h int) tea.WindowSizeMsg { return tea.WindowSizeMsg{Width: w, Height: h} }

func ctrlC() tea.KeyPressMsg { return tea.KeyPressMsg{Code: 'c', Mod: tea.ModCtrl} }

func lightBackground() tea.BackgroundColorMsg { return tea.BackgroundColorMsg{Color: color.White} }

func TestDashboardShowsAppsNeedsActionAndDetails(t *testing.T) {
	m, _ := sample(t, 140, 32)

	out := screen(m)

	for _, want := range []string{"self-host", "LAN 192.168.1.20", "1 warning",
		"Apps", "Jellyfin", "http://192.168.1.20:8096", "Sonarr", "whoami",
		"Needs action", "logs", "setup", "info", "compose"} {
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
	starting := service.AppStatus{State: "running", Health: "starting", Setup: "ok"}
	if got := service.Level(starting); got != "attention" {
		t.Errorf("starting App Status = %s, want attention", got)
	}
}

func TestNeedsActionNamesTheActionForEachProblem(t *testing.T) {
	m, _ := sample(t, 140, 40)
	m = update(t, m, updatesMsg{updates: map[string]string{"jellyfin": "available"}})

	out := screen(m)

	for _, want := range []string{
		"Sonarr: download-client failed", "r retry Setup",
		"whoami is stopped", "enter start",
		"Jellyfin has an update", "u update",
		"Firewall: ufw is active",
	} {
		if !strings.Contains(out, want) {
			t.Errorf("Needs action lacks %q\n%s", want, out)
		}
	}
}

func TestNothingNeedsActionWhenAllIsWell(t *testing.T) {
	m, backend := sample(t, 140, 32)
	backend.status.Apps = backend.status.Apps[:1]
	m = update(t, m, statusMsg{status: backend.status})
	m = update(t, m, doctorMsg{checks: []host.Check{{ID: "docker", Title: "Docker", Level: host.OK}}})

	if !strings.Contains(screen(m), "Nothing needs your attention") {
		t.Fatalf("calm state not shown\n%s", screen(m))
	}
}

// The keybind audit: the Dashboard has exactly the keys docs/adr/0002 lists.
// Adding one means changing the ADR and this test on purpose.
func TestKeybindAudit(t *testing.T) {
	want := []string{
		"select up: up k", "select down: down j", "next tab: tab", "start/stop: enter",
		"open: o", "copy password: c", "update: u", "retry Setup: r", "install: i",
		"backup: b", "help: ?", "quit: q ctrl+c", "scroll up: pgup", "scroll down: pgdown",
	}
	var got []string
	for _, b := range newKeyMap().all() {
		got = append(got, b.Help().Desc+": "+strings.Join(b.Keys(), " "))
	}
	slices.Sort(want)
	slices.Sort(got)
	if !slices.Equal(got, want) {
		t.Fatalf("keybinds changed:\n got %q\nwant %q", got, want)
	}
}

func TestRemovedKeysDoNothing(t *testing.T) {
	m, backend := sample(t, 140, 32)
	before := screen(m)

	for _, k := range []string{"x", "X", "S", "s", "/", "t", "1", "2", "5", "l", "L", "f", "U", "e"} {
		m = drive(t, m, press(k))
	}

	if len(backend.Actions()) != 0 || screen(m) != before {
		t.Fatalf("removed keys must be inert; actions %v\n%s", backend.Actions(), screen(m))
	}
}

func TestTabCyclesDetailsIncludingCompose(t *testing.T) {
	m, _ := sample(t, 140, 32)

	m = drive(t, m, press("tab"))
	if !strings.Contains(screen(m), "Setup has finished") && !strings.Contains(screen(m), "✓") {
		t.Errorf("setup tab not shown\n%s", screen(m))
	}
	m = drive(t, m, press("tab"))
	if !strings.Contains(screen(m), "lscr.io/linuxserver/jellyfin:latest") {
		t.Errorf("info tab not shown\n%s", screen(m))
	}
	m = drive(t, m, press("tab"))
	if !strings.Contains(screen(m), "image: example/jellyfin:latest") {
		t.Errorf("compose tab does not show the App's Compose file\n%s", screen(m))
	}
	m = drive(t, m, press("tab"))
	if !strings.Contains(screen(m), "ready on :80") {
		t.Errorf("tab should wrap back to logs\n%s", screen(m))
	}
}

func TestSetupTabShowsFailedStepAndHint(t *testing.T) {
	m, _ := sample(t, 140, 32)

	m = drive(t, m, press("j"))
	m = drive(t, m, press("tab"))

	out := screen(m)
	if !strings.Contains(out, "qBittorrent refused login") || !strings.Contains(out, "→ Add qBittorrent") {
		t.Fatalf("setup tab lacks failed step and hint\n%s", out)
	}
}

func TestEnterStopsARunningAppAndStartsAStoppedOne(t *testing.T) {
	m, backend := sample(t, 140, 32)

	m = drive(t, m, press("enter"))
	m = drive(t, m, press("j"))
	m = drive(t, m, press("j"))
	drive(t, m, press("enter"))

	if got := backend.Actions(); !slices.Equal(got, []string{"stop jellyfin", "start whoami"}) {
		t.Fatalf("actions %v", got)
	}
}

func TestUpdateRunsOnlyWhenAnUpdateIsKnown(t *testing.T) {
	m, backend := sample(t, 140, 32)

	m = drive(t, m, press("u"))
	if len(backend.Actions()) != 0 || !strings.Contains(screen(m), "no update known for Jellyfin") {
		t.Fatalf("u without a known update should only explain\n%s", screen(m))
	}
	m = update(t, m, updatesMsg{updates: map[string]string{"jellyfin": "available"}})
	drive(t, m, press("u"))

	if got := backend.Actions(); !slices.Equal(got, []string{"update jellyfin"}) {
		t.Fatalf("actions %v", got)
	}
}

func TestRetrySetupOnlyForManagedApps(t *testing.T) {
	m, backend := sample(t, 140, 32)

	m = drive(t, m, press("j"))
	m = drive(t, m, press("r"))
	m = drive(t, m, press("j"))
	m = drive(t, m, press("r"))

	if got := backend.Actions(); !slices.Equal(got, []string{"setup sonarr"}) {
		t.Fatalf("actions %v", got)
	}
	if !strings.Contains(screen(m), "whoami has no automatic Setup") {
		t.Fatalf("unmanaged App should explain\n%s", screen(m))
	}
}

func TestBackupRunsForEveryApp(t *testing.T) {
	m, backend := sample(t, 140, 32)

	drive(t, m, press("b"))

	if got := backend.Actions(); !slices.Equal(got, []string{"backup"}) {
		t.Fatalf("actions %v", got)
	}
}

func TestOpenUsesTheLANURLAndCopyGetsThePassword(t *testing.T) {
	m, backend := sample(t, 140, 32)

	m = drive(t, m, press("o"))
	_, cmd := m.Update(press("c"))

	if !slices.Equal(backend.opened, []string{"http://192.168.1.20:8096"}) {
		t.Fatalf("opened %v", backend.opened)
	}
	if cmd == nil {
		t.Fatal("c should fetch the Admin password for the clipboard")
	}
}

func TestFooterShowsTheRunningActionThenItsResult(t *testing.T) {
	m, _ := sample(t, 140, 32)

	next, _ := m.Update(press("enter"))
	m = next.(Model)
	if !strings.Contains(lastLine(screen(m)), "stop jellyfin") {
		t.Fatalf("footer should name the running Action\n%s", lastLine(screen(m)))
	}
	m = drive(t, m, press("b"))
	if !strings.Contains(lastLine(screen(m)), "✓ backup") {
		t.Fatalf("footer should report the result\n%s", lastLine(screen(m)))
	}
}

func lastLine(s string) string {
	lines := strings.Split(s, "\n")
	return lines[len(lines)-1]
}

func TestInstallOpensTheCatalogAndInstallsThePick(t *testing.T) {
	m, backend := sample(t, 140, 32)
	backend.catalog = wizardCatalog()

	m = drive(t, m, press("i"))
	if !strings.Contains(screen(m), "Install") || !strings.Contains(screen(m), "Notifications") {
		t.Fatalf("install picker not shown\n%s", screen(m))
	}
	for !strings.Contains(m.renderOverlay(), "> ") || !strings.Contains(currentPick(m), "ntfy") {
		m = drive(t, m, press("j"))
		if m.picker == nil || m.picker.cursor > 10 {
			t.Fatal("ntfy not found in picker")
		}
	}
	m = drive(t, m, press("space"))
	m = drive(t, m, press("enter"))
	if !strings.Contains(screen(m), "Review") {
		t.Fatalf("no review\n%s", screen(m))
	}
	drive(t, m, press("enter"))

	got := backend.installs()
	if len(got) != 1 || strings.Join(got[0].Targets, ",") != "ntfy" {
		t.Fatalf("installs %+v", got)
	}
}

func currentPick(m Model) string {
	items := m.pickerItems()
	if m.picker == nil || m.picker.cursor >= len(items) {
		return ""
	}
	return items[m.picker.cursor].key
}

func TestEscapeClosesTheInstallPickerWithoutInstalling(t *testing.T) {
	m, backend := sample(t, 140, 32)
	backend.catalog = wizardCatalog()

	m = drive(t, m, press("i"))
	m = drive(t, m, press("esc"))

	if m.picker != nil || len(backend.installs()) != 0 {
		t.Fatal("esc must close the picker and install nothing")
	}
}

func TestHelpListsEveryKey(t *testing.T) {
	m, _ := sample(t, 140, 40)

	m = drive(t, m, press("?"))

	help := ansi.Strip(m.renderOverlay())
	for _, want := range []string{"start/stop", "open", "copy password", "update", "retry Setup", "install", "backup", "quit"} {
		if !strings.Contains(help, want) {
			t.Errorf("help lacks %q\n%s", want, help)
		}
	}
}

func TestNarrowTerminalKeepsAppsAndNeedsAction(t *testing.T) {
	m, _ := sample(t, 80, 24)

	out := screen(m)
	for _, want := range []string{"Jellyfin", "Needs action"} {
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
