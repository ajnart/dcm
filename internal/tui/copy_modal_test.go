package tui

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"testing"

	tea "charm.land/bubbletea/v2"
	"github.com/ajnart/self-host/internal/service"
)

func TestCopyModalKeepsDashboardVisibleAndCapturesKeysWhileLoading(t *testing.T) {
	for _, tab := range []string{"1", "2"} {
		m, backend := sample(t, 80, 24)
		m = drive(t, m, press(tab))
		m, load := send(t, m, press("c"))
		if load == nil {
			t.Fatal("c must load available credentials")
		}
		out := screen(m)
		underlying := "No Action yet"
		if tab == "2" {
			underlying = "Jellyfin logs"
		}
		if !strings.Contains(out, underlying) || !strings.Contains(out, "Reading available credentials…") {
			t.Fatalf("copy must overlay the Dashboard while loading\n%s", out)
		}
		if !strings.Contains(out, "     ╭") || !strings.Contains(lastLine(out), "copy credentials") || !strings.Contains(lastLine(out), "esc  close") {
			t.Fatalf("copy must match the centered Action menu and name its keys\n%s", out)
		}
		for _, key := range []string{"1", "2", "3", "4", "5", "left", "right", "tab", "shift+tab", "[", "]", "a", "A", "?", "q", "/", "o", "r", "enter", "down"} {
			m = drive(t, m, press(key))
		}
		if m.surface != surface(tab[0]-'1') || m.menu != nil || m.showHelp || m.quitting || len(backend.opened) != 0 || len(backend.Actions()) != 0 || m.selectedID() != "jellyfin" {
			t.Fatal("loading modal leaked a background key")
		}
		m = drive(t, m, load())
		for _, key := range []string{"1", "2", "3", "4", "5", "left", "right", "tab", "shift+tab", "[", "]", "a", "A", "?", "q", "/", "o", "r"} {
			m = drive(t, m, press(key))
		}
		m = drive(t, m, clickMsg{id: "nav:settings"})
		if m.surface != surface(tab[0]-'1') || m.menu != nil || m.showHelp || m.quitting || len(backend.opened) != 0 || len(backend.Actions()) != 0 || m.selectedID() != "jellyfin" {
			t.Fatal("ready modal leaked a background key or click")
		}
		m = drive(t, m, press("esc"))
		if m.apps.copy != nil || !strings.Contains(screen(m), underlying) {
			t.Fatal("esc must return to the unchanged Dashboard")
		}
	}
}

type copyBackend struct {
	Backend
	credentials service.Credentials
	err         error
	reads       int
}

func (b *copyBackend) Credentials(context.Context) (service.Credentials, error) {
	b.reads++
	return b.credentials, b.err
}

func TestCopyModalOffersAdminLoginAndCopiesFreshValuesWithoutRenderingThem(t *testing.T) {
	for _, tc := range []struct {
		label string
		row   int
		value string
	}{
		{"Admin password", 0, "fresh-password"},
		{"Jellyfin username", 1, "fresh-alias"},
		{"Jellyfin API key", 2, "fresh-api-key"},
		{"Admin username", 3, "fresh-user"},
		{"Admin email", 4, "fresh@example.test"},
	} {
		m, fake := sample(t, 80, 24)
		backend := &copyBackend{Backend: fake}
		backend.credentials.Admin.Username = "old-user"
		backend.credentials.Admin.Password = "old-password"
		backend.credentials.Admin.Email = "old@example.test"
		backend.credentials.Admin.Aliases = map[string]string{"jellyfin": "old-alias"}
		backend.credentials.Apps = map[string]map[string]string{"jellyfin": {"JELLYFIN_API_KEY": "old-api-key"}, "sonarr": {"SONARR_API_KEY": "other-app-key"}}
		m.backend = backend
		m = drive(t, m, press("c"))
		out := screen(m)
		for _, label := range []string{"Admin password", "Jellyfin username", "Jellyfin API key", "Admin username", "Admin email"} {
			if !strings.Contains(out, label) {
				t.Fatalf("copy modal lacks %s\n%s", label, out)
			}
		}
		for _, value := range []string{"old-user", "old-password", "old@example.test", "old-alias", "old-api-key", "other-app-key", "Sonarr API key"} {
			if strings.Contains(out, value) {
				t.Fatal("copy modal displayed a value or another App's credential")
			}
		}
		backend.credentials.Admin.Username = "fresh-user"
		backend.credentials.Admin.Password = "fresh-password"
		backend.credentials.Admin.Email = "fresh@example.test"
		backend.credentials.Admin.Aliases["jellyfin"] = "fresh-alias"
		backend.credentials.Apps["jellyfin"]["JELLYFIN_API_KEY"] = "fresh-api-key"
		for range tc.row {
			m = drive(t, m, press("down"))
		}
		m, cmd := send(t, m, press("enter"))
		if cmd == nil {
			t.Fatal("enter must request a copy")
		}
		copied, ok := cmd().(clipboardMsg)
		if !ok || copied.text != tc.value || copied.what != tc.label || backend.reads != 2 || m.apps.copy != nil {
			t.Fatal("copy must reread only the chosen identifier and dismiss the modal")
		}
		m, native := send(t, m, copied)
		if native == nil || !strings.Contains(statusLine(screen(m)), "copied "+tc.label) || strings.Contains(screen(m), tc.value) {
			t.Fatal("native clipboard dispatch must flash the label, never the value")
		}
	}
	m, fake := sample(t, 80, 24)
	fake.status.Apps[0].ID = "deluge"
	fake.status.Apps[0].Name = "Deluge"
	m = drive(t, m, statusMsg{status: fake.status})
	backend := &copyBackend{Backend: fake}
	backend.credentials.Admin.Password = "old-admin-password"
	backend.credentials.Apps = map[string]map[string]string{
		"deluge":   {"DELUGE_WEB_PASSWORD": "saved-deluge-web-password", "DELUGE_DAEMON_PASSWORD": "hidden-daemon-password"},
		"jellyfin": {"JELLYFIN_API_KEY": "other-app-key"},
	}
	m.backend = backend
	m = drive(t, m, press("c"))
	if m.apps.copy == nil || len(m.apps.copy.rows) != 2 || m.apps.copy.rows[1] != (copyChoice{app: "deluge", key: "DELUGE_WEB_PASSWORD", label: "Deluge Web password"}) {
		t.Fatal("Deluge Web password choice must store only its App and secret identifiers")
	}
	if !strings.Contains(screen(m), "Admin password") || !strings.Contains(screen(m), "Deluge Web password") {
		t.Fatal("Deluge must retain the Admin choice and label its saved Web password separately")
	}
	for _, value := range []string{"old-admin-password", "saved-deluge-web-password", "hidden-daemon-password", "other-app-key"} {
		if strings.Contains(screen(m), value) {
			t.Fatal("Deluge copy modal displayed a credential value")
		}
	}
	backend.credentials.Admin.Password = "changed-admin-password"
	m = drive(t, m, press("down"))
	m, cmd := send(t, m, press("enter"))
	if cmd == nil {
		t.Fatal("Deluge Web password choice must request a private copy")
	}
	copied, ok := cmd().(clipboardMsg)
	if !ok || copied.text != "saved-deluge-web-password" || copied.what != "Deluge Web password" || backend.reads != 2 || m.apps.copy != nil {
		t.Fatal("Deluge must reread its retained Web password, not the changed Admin password")
	}
	m, native := send(t, m, copied)
	if native == nil || !strings.Contains(statusLine(screen(m)), "copied Deluge Web password") || strings.Contains(screen(m), "saved-deluge-web-password") || strings.Contains(screen(m), "changed-admin-password") {
		t.Fatal("Deluge clipboard dispatch must show only the credential label")
	}
}

func TestCopyModalIgnoresBackgroundClicks(t *testing.T) {
	m, _ := sample(t, 80, 24)
	m, _ = send(t, m, press("c"))
	for _, id := range []string{"nav:settings", "nav:apps", "row:1", "tab:2"} {
		m = drive(t, m, clickMsg{id: id})
	}
	if m.surface != surfaceDashboard || m.selectedID() != "jellyfin" {
		t.Fatal("copy modal must ignore background clicks while loading")
	}
	m = drive(t, m, tea.MouseWheelMsg(tea.Mouse{Button: tea.MouseWheelDown}))
}

func TestCopyModalEmptyAndReadErrorKeepFocusUntilDismissed(t *testing.T) {
	for _, tc := range []struct {
		err  error
		text string
	}{
		{nil, "No saved credentials available."},
		{errors.New("synthetic-private-error"), "Could not read credentials. Close and try c again."},
	} {
		m, fake := sample(t, 80, 24)
		m.backend = &copyBackend{Backend: fake, err: tc.err}
		m = drive(t, m, press("c"))
		if !strings.Contains(screen(m), tc.text) || strings.Contains(screen(m), "synthetic-private-error") {
			t.Fatalf("modal state must be clear without raw credential errors\n%s", screen(m))
		}
		for _, key := range []string{"down", "up", "enter", "5", "A", "?", "q"} {
			m, cmd := send(t, m, press(key))
			if cmd != nil || m.apps.copy == nil || m.surface != surfaceDashboard || m.menu != nil || m.showHelp || m.quitting {
				t.Fatal("empty/error copy modal leaked a background key")
			}
		}
		m = drive(t, m, press("esc"))
		if m.apps.copy != nil {
			t.Fatal("esc must dismiss empty/error modal")
		}
	}
}

func TestCopyModalDiscardsStaleLoadsAndReportsUnavailableCopy(t *testing.T) {
	m, fake := sample(t, 80, 24)
	backend := &copyBackend{Backend: fake}
	backend.credentials.Admin.Password = "synthetic-password"
	m.backend = backend
	m, oldLoad := send(t, m, press("c"))
	m = drive(t, m, press("esc"))
	backend.credentials.Admin.Password = ""
	m, newLoad := send(t, m, press("c"))
	m = drive(t, m, oldLoad())
	if !strings.Contains(screen(m), "Reading available credentials…") {
		t.Fatal("a dismissed modal's result must not fill its replacement")
	}
	m = drive(t, m, newLoad())
	if !strings.Contains(screen(m), "No saved credentials available.") {
		t.Fatal("replacement modal must use its own result")
	}
	m = drive(t, m, press("esc"))
	backend.credentials.Admin.Password = "synthetic-password"
	m = drive(t, m, press("c"))
	backend.credentials.Admin.Password = ""
	m = drive(t, m, press("enter"))
	if !strings.Contains(statusLine(screen(m)), "Admin password is no longer available") || strings.Contains(screen(m), "synthetic-password") {
		t.Fatal("a removed credential must not be copied from UI state")
	}
}

func TestCopyModalScrollsManyAPIKeysWithinTheViewport(t *testing.T) {
	m, fake := sample(t, 80, 24)
	backend := &copyBackend{Backend: fake}
	keys := map[string]string{}
	for i := range 20 {
		keys[fmt.Sprintf("KEY_%02d_API_KEY", i)] = "synthetic-hidden-key"
	}
	backend.credentials.Apps = map[string]map[string]string{"jellyfin": keys}
	m.backend = backend
	m = drive(t, m, press("2"))
	m = drive(t, m, press("c"))
	for range 30 {
		m = drive(t, m, press("down"))
	}
	out := screen(m)
	if !strings.Contains(out, "> Jellyfin API key (KEY_19_API_KEY)") || strings.Contains(out, "KEY_00_API_KEY") || strings.Contains(out, "synthetic-hidden-key") || len(strings.Split(out, "\n")) != 24 {
		t.Fatalf("copy rows must scroll without hiding the focused choice or key bar\n%s", out)
	}
	if !strings.Contains(lastLine(out), "enter  copy") || !strings.Contains(lastLine(out), "esc  close") {
		t.Fatal("copy keys must fit at 80x24")
	}
}

func TestGoldenCopyModal(t *testing.T) {
	for _, size := range []struct {
		suffix        string
		width, height int
	}{{"", 120, 30}, {"-narrow", 80, 24}} {
		for _, state := range []string{"loading", "ready", "empty", "error"} {
			m, fake := sample(t, size.width, size.height)
			backend := &copyBackend{Backend: fake}
			if state == "ready" {
				backend.credentials.Admin.Username = "synthetic-user"
				backend.credentials.Admin.Email = "synthetic@example.test"
				backend.credentials.Admin.Password = "synthetic-password"
				backend.credentials.Admin.Aliases = map[string]string{"jellyfin": "synthetic-alias"}
				backend.credentials.Apps = map[string]map[string]string{"jellyfin": {"JELLYFIN_API_KEY": "synthetic-api-key"}}
			}
			if state == "error" {
				backend.err = errors.New("synthetic-private-error")
			}
			m.backend = backend
			m = drive(t, m, press("2"))
			m, cmd := send(t, m, press("c"))
			if state != "loading" {
				m = drive(t, m, cmd())
			}
			golden(t, "copy-modal-"+state+size.suffix, trimLines(screen(m)))
		}
	}
}
