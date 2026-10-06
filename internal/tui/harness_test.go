package tui

import (
	"context"
	"image/color"
	"io"
	"strings"
	"sync"
	"testing"
	"time"

	"charm.land/bubbles/v2/spinner"
	tea "charm.land/bubbletea/v2"
	"github.com/charmbracelet/x/ansi"

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
	fail    error
}

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
func (f *fakeBackend) Run(_ context.Context, action Action, ids []string, log *events.Logger) error {
	f.mu.Lock()
	f.actions = append(f.actions, string(action)+" "+strings.Join(ids, " "))
	f.mu.Unlock()
	log.Emit(events.Event{Event: events.StepOK, Step: string(action), Msg: string(action) + " done"})
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
		{ID: "firewall", Title: "Firewall", Level: host.Warn, Detail: "ufw is active"},
	}}
	m := New(backend, Options{Version: "1.0.0", Now: func() time.Time { return time.Date(2026, 10, 6, 12, 0, 0, 0, time.UTC) }})
	m = update(t, m, tea.WindowSizeMsg{Width: width, Height: height})
	m = update(t, m, statusMsg{status: backend.status})
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
		case tickMsg, tea.QuitMsg, spinner.TickMsg:
			return nil
		default:
			return []tea.Msg{msg}
		}
	case <-time.After(200 * time.Millisecond):
		return nil // long-lived listeners (log follow, task events) are dropped
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
	}
	r := []rune(s)[0]
	return tea.KeyPressMsg{Code: r, Text: s}
}

func screen(m Model) string { return ansi.Strip(m.View().Content) }

func TestDashboardShowsProjectHealthAndApps(t *testing.T) {
	m, _ := sample(t, 140, 32)

	out := screen(m)

	for _, want := range []string{"self-host", "LAN 192.168.1.20", "Jellyfin", "http://192.168.1.20:8096", "Sonarr", "incomplete", "whoami", "unmanaged", "1 warning"} {
		if !strings.Contains(out, want) {
			t.Errorf("dashboard lacks %q\n%s", want, out)
		}
	}
	v := m.View()
	if !v.AltScreen || v.MouseMode != tea.MouseModeCellMotion || !v.ReportFocus {
		t.Fatal("dashboard must use alt screen, mouse and focus reporting")
	}
	if !strings.Contains(v.WindowTitle, "self-host") {
		t.Fatalf("window title %q", v.WindowTitle)
	}
}

func TestDotsReflectAppHealth(t *testing.T) {
	cases := map[string]string{"jellyfin": "ok", "sonarr": "fail", "whoami": "fail"}
	for _, app := range sampleStatus().Apps {
		if got := service.Level(app); got != cases[app.ID] {
			t.Errorf("%s level = %s, want %s", app.ID, got, cases[app.ID])
		}
	}
}

func TestNavigationAndSetupSidebar(t *testing.T) {
	m, _ := sample(t, 140, 32)

	m = update(t, m, press("j"))
	m = update(t, m, press("tab")) // logs -> setup

	if m.selectedID() != "sonarr" {
		t.Fatalf("selected %q", m.selectedID())
	}
	out := screen(m)
	if !strings.Contains(out, "qBittorrent refused login") || !strings.Contains(out, "→ Add qBittorrent") {
		t.Fatalf("setup sidebar lacks failed step and hint\n%s", out)
	}
}

func TestFilterNarrowsRowsAndEscapeClears(t *testing.T) {
	m, _ := sample(t, 140, 32)

	m = update(t, m, press("/"))
	for _, r := range "son" {
		m = update(t, m, press(string(r)))
	}
	m = update(t, m, press("enter"))

	if len(m.rows()) != 1 || m.selectedID() != "sonarr" {
		t.Fatalf("filter rows = %d", len(m.rows()))
	}
	m = update(t, m, press("esc"))
	if len(m.rows()) != 3 {
		t.Fatalf("escape did not clear filter: %d rows", len(m.rows()))
	}
}

func TestRemoveAsksForConfirmationThenRunsTask(t *testing.T) {
	m, backend := sample(t, 140, 32)

	m = update(t, m, press("x"))
	if !strings.Contains(screen(m), "Remove Jellyfin?") {
		t.Fatalf("no confirmation dialog\n%s", screen(m))
	}
	m = update(t, m, press("n"))
	if len(backend.Actions()) != 0 {
		t.Fatal("cancelled remove still ran")
	}
	m = update(t, m, press("x"))
	m = drive(t, m, press("y"))

	if got := backend.Actions(); len(got) != 1 || got[0] != "remove jellyfin" {
		t.Fatalf("actions %v", got)
	}
}

func TestEnterStopsARunningAppAndStartsAStoppedOne(t *testing.T) {
	m, backend := sample(t, 140, 32)

	m = drive(t, m, press("enter"))
	m = update(t, m, press("j"))
	m = update(t, m, press("j"))
	m = drive(t, m, press("enter"))

	if got := backend.Actions(); len(got) != 2 || got[0] != "stop jellyfin" || got[1] != "start whoami" {
		t.Fatalf("actions %v", got)
	}
}

func TestTasksOverlayListsFinishedTasks(t *testing.T) {
	m, _ := sample(t, 140, 32)
	m = drive(t, m, press("S"))

	m = update(t, m, press("t"))

	out := screen(m)
	if !strings.Contains(out, "restart jellyfin") || !strings.Contains(out, "restart done") {
		t.Fatalf("tasks overlay lacks task and its events\n%s", out)
	}
}

func TestHelpOverlayListsKeybinds(t *testing.T) {
	m, _ := sample(t, 140, 40)

	m = update(t, m, press("?"))

	out := screen(m)
	for _, want := range []string{"restart", "rerun setup", "open in browser", "copy password"} {
		if !strings.Contains(out, want) {
			t.Errorf("help lacks %q\n%s", want, out)
		}
	}
}

func TestOpenInBrowserUsesTheLANURL(t *testing.T) {
	m, backend := sample(t, 140, 32)

	drive(t, m, press("o"))

	if len(backend.opened) != 1 || backend.opened[0] != "http://192.168.1.20:8096" {
		t.Fatalf("opened %v", backend.opened)
	}
}

func TestCopyURLUsesTheClipboard(t *testing.T) {
	m, _ := sample(t, 140, 32)

	_, cmd := m.Update(press("c"))

	if cmd == nil {
		t.Fatal("no clipboard command")
	}
}

func TestNarrowTerminalHidesSidebarAndHealthColumn(t *testing.T) {
	m, _ := sample(t, 70, 24)

	out := screen(m)
	if strings.Contains(out, "HEALTH") || strings.Contains(out, "ready on") {
		t.Fatalf("narrow layout should hide sidebar and HEALTH\n%s", out)
	}
	if !strings.Contains(out, "Jellyfin") {
		t.Fatal("rows missing in narrow layout")
	}
}

func TestMouseClickSelectsRow(t *testing.T) {
	m, _ := sample(t, 140, 32)

	y := m.rowY(2)
	m = drive(t, m, clickMsg{id: rowLayerID(2)})

	if m.selectedID() != "whoami" || y <= 0 {
		t.Fatalf("selected %q (row y %d)", m.selectedID(), y)
	}
}

func TestNumberKeysSwitchScreens(t *testing.T) {
	m, _ := sample(t, 140, 32)

	m = update(t, m, press("4"))

	if m.screen != screenDoctor || !strings.Contains(screen(m), "Firewall") {
		t.Fatalf("doctor screen not shown\n%s", screen(m))
	}
}

func TestFocusRefreshesStatus(t *testing.T) {
	m, _ := sample(t, 140, 32)

	_, cmd := m.Update(tea.FocusMsg{})

	if cmd == nil {
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

func lightBackground() tea.BackgroundColorMsg { return tea.BackgroundColorMsg{Color: color.White} }

func TestHealthPillCountsFailuresAndDoctorShowsHints(t *testing.T) {
	m, _ := sample(t, 140, 32)
	m = update(t, m, doctorMsg{checks: []host.Check{
		{ID: "docker", Title: "Docker", Level: host.OK},
		{ID: "binding", App: "jellyfin", Title: "Port", Level: host.Fail, Detail: "port 8096 is bound to 127.0.0.1", Hint: "Recreate it with the current Exposure: self-host start jellyfin"},
		{ID: "firewall", Title: "Firewall", Level: host.Warn, Detail: "ufw is active", Hint: "sudo ufw allow …"},
	}})

	if !strings.Contains(screen(m), "1 failing check") {
		t.Fatalf("health pill should count failures\n%s", screen(m))
	}
	m = update(t, m, press("4"))
	out := screen(m)
	for _, want := range []string{"jellyfin › Port", "bound to 127.0.0.1", "self-host start jellyfin", "sudo ufw allow"} {
		if !strings.Contains(out, want) {
			t.Errorf("doctor screen lacks %q\n%s", want, out)
		}
	}
}

func TestUpdatesBadgeScreenAndUpdateAll(t *testing.T) {
	m, backend := sample(t, 140, 32)

	m = update(t, m, updatesMsg{updates: map[string]string{"jellyfin": "available", "sonarr": "current", "whoami": "unknown"}})

	if !strings.Contains(screen(m), "⚠ 1 update") {
		t.Fatalf("no updates badge\n%s", screen(m))
	}
	m = update(t, m, press("3"))
	out := screen(m)
	if !strings.Contains(out, "available") || !strings.Contains(out, "current") {
		t.Fatalf("updates screen\n%s", out)
	}
	drive(t, m, press("U"))
	if got := backend.Actions(); len(got) != 1 || got[0] != "update jellyfin" {
		t.Fatalf("U should update only Apps with updates: %v", got)
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
