package tui

import (
	"strings"
	"testing"
)

func openQR(t *testing.T, m Model) Model {
	t.Helper()
	m = drive(t, m, press("a"))
	m = drive(t, m, press("q"))
	return drive(t, m, press("enter"))
}

func TestGoldenQRModal(t *testing.T) {
	for _, size := range []struct {
		suffix        string
		width, height int
	}{{"", 120, 60}, {"-small", 60, 20}, {"-tiny", 24, 14}} {
		m, _ := sample(t, size.width, size.height)
		m = openQR(t, drive(t, m, press("2")))
		golden(t, "apps-qr"+size.suffix, trimLines(screen(m)))
	}
}

func TestQRModalOpensFromTheActionMenuOnApps(t *testing.T) {
	m, _ := sample(t, 120, 60)
	m = openQR(t, drive(t, m, press("2")))
	if m.apps.qr == nil || m.menu != nil {
		t.Fatalf("the menu entry opens the QR code and closes the menu\n%s", screen(m))
	}
	if strings.Contains(screen(m), "Q  QR code") || strings.Contains(screen(m), "scan it with your phone ·") {
		t.Fatalf("no bar advertises a QR key\n%s", screen(m))
	}
	m = drive(t, m, press("esc"))
	if m.apps.qr != nil {
		t.Fatalf("esc closes the QR code")
	}
}

func TestQRModalOpensFromTheActionMenuOnOverview(t *testing.T) {
	m, _ := sample(t, 120, 60)
	m = openQR(t, m)
	if m.apps.qr == nil || !strings.Contains(screen(m), "http://192.168.1.20:8096") {
		t.Fatalf("Overview's menu opens the QR code\n%s", screen(m))
	}
}

func TestQRKeyDoesNothingOutsideTheMenu(t *testing.T) {
	m, _ := sample(t, 120, 60)
	m = drive(t, m, press("2"))
	m = drive(t, m, press("Q"))
	if m.apps.qr != nil {
		t.Fatalf("there is no Q shortcut")
	}
}

func TestGoldenQRMenuDisabledUnderThisComputerOnly(t *testing.T) {
	for _, size := range []struct {
		suffix        string
		width, height int
	}{{"", 120, 30}, {"-narrow", 80, 24}} {
		m, backend := sample(t, size.width, size.height)
		backend.status.Apps[0].URL = "http://127.0.0.1:8096"
		m = drive(t, m, statusMsg{status: backend.status})
		m = drive(t, m, press("a"))
		m = drive(t, m, press("q"))
		golden(t, "menu-app-qr-local"+size.suffix, trimLines(screen(m)))
	}
}

func TestEnterOnTheDisabledQRRowFlashesWhy(t *testing.T) {
	for name, tc := range map[string]struct{ url, want string }{
		"local":  {"http://127.0.0.1:8096", "Settings > Access"},
		"no web": {"", "no web page"},
	} {
		t.Run(name, func(t *testing.T) {
			m, backend := sample(t, 160, 40)
			backend.status.Apps[0].URL = tc.url
			m = drive(t, m, statusMsg{status: backend.status})
			m = openQR(t, m)
			if m.apps.qr != nil || m.menu == nil {
				t.Fatalf("an unavailable entry opens nothing and keeps the menu")
			}
			if out := screen(m); !strings.Contains(out, tc.want) {
				t.Fatalf("the flash says why (%q)\n%s", tc.want, out)
			}
		})
	}
}

func TestQRModalExplainsATooSmallTerminal(t *testing.T) {
	m, _ := sample(t, 60, 20)
	m = openQR(t, drive(t, m, press("2")))
	if out := screen(m); !strings.Contains(out, "too small for the QR code") {
		t.Fatalf("a small terminal says so\n%s", out)
	}
}
