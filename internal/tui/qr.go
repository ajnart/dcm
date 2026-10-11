package tui

import (
	"fmt"
	"image/color"
	"net"
	"net/url"
	"strings"

	"charm.land/bubbles/v2/key"
	tea "charm.land/bubbletea/v2"
	"charm.land/lipgloss/v2"
	"rsc.io/qr"

	"github.com/ajnart/self-host/internal/service"
)

const (
	qrQuietZone = 2
	qrMinInner  = 40

	qrNoWebPage     = "no web page"
	qrThisComputer  = "this computer only"
	qrThisComputerW = "Under This computer only a phone cannot reach this App's Address. Choose another Access in Settings > Access to scan it."
)

var qrKeys = []key.Binding{hint("esc", "close")}

type qrModal struct {
	name, address string
}

func newQRModal(app service.AppStatus) *qrModal {
	return &qrModal{name: app.Name, address: app.URL}
}

// qrUnavailable is why an App's Address has no QR code, and what to tell the
// user about it; empty reason when it has one.
func qrUnavailable(app service.AppStatus) (reason, why string) {
	switch {
	case app.URL == "":
		return qrNoWebPage, app.Name + " has no web page, so there is no Address to scan."
	case onlyThisComputer(app.URL):
		return qrThisComputer, qrThisComputerW
	}
	return "", ""
}

func onlyThisComputer(address string) bool {
	u, err := url.Parse(address)
	if err != nil {
		return false
	}
	host := u.Hostname()
	if ip := net.ParseIP(host); ip != nil {
		return ip.IsLoopback()
	}
	return host == "localhost"
}

func (v *appsView) qrKey(msg tea.KeyPressMsg) {
	if msg.String() == "esc" {
		v.qr = nil
	}
}

func qrBlocks(address string) ([]string, error) {
	code, err := qr.Encode(address, qr.L)
	if err != nil {
		return nil, err
	}
	total := code.Size + 2*qrQuietZone
	dark := func(x, y int) bool {
		x, y = x-qrQuietZone, y-qrQuietZone
		return x >= 0 && y >= 0 && x < code.Size && y < code.Size && code.Black(x, y)
	}
	rows := make([]string, 0, (total+1)/2)
	for y := 0; y < total; y += 2 {
		var row strings.Builder
		for x := 0; x < total; x++ {
			switch top, bottom := dark(x, y), dark(x, y+1); {
			case top && bottom:
				row.WriteString("█")
			case top:
				row.WriteString("▀")
			case bottom:
				row.WriteString("▄")
			default:
				row.WriteString(" ")
			}
		}
		rows = append(rows, row.String())
	}
	return rows, nil
}

func qrPanel(t theme, lines []string, inner int) string {
	for i, line := range lines {
		lines[i] = pad(line, inner)
	}
	return t.panel(true).Render(strings.Join(lines, "\n"))
}

func (q *qrModal) header(t theme, inner int) []string {
	lines := []string{t.active().Render(q.name + " · QR code")}
	for _, line := range strings.Split(wrap(q.address, inner), "\n") {
		lines = append(lines, t.body().Render(line))
	}
	return lines
}

func (q *qrModal) view(ctx *viewContext, width, height int) string {
	t := ctx.theme
	blocks, err := qrBlocks(q.address)
	if err == nil {
		inner := max(lipgloss.Width(blocks[0]), qrMinInner)
		code := lipgloss.NewStyle().Foreground(color.Black).Background(color.White)
		lines := append(q.header(t, inner), "")
		lead := strings.Repeat(" ", (inner-lipgloss.Width(blocks[0]))/2)
		for _, row := range blocks {
			lines = append(lines, lead+code.Render(row))
		}
		lines = append(lines, "", t.dim().Render("Scan it with your phone's camera. Esc closes."))
		box := qrPanel(t, lines, inner)
		w, h := lipgloss.Width(box), lipgloss.Height(box)
		if w <= width && h <= height {
			return box
		}
		return q.tooSmall(t, fmt.Sprintf("The terminal is too small for the QR code: it needs %d×%d cells and this one has %d×%d. Enlarge it, or type the Address above.", w, h, width, height), width)
	}
	return q.tooSmall(t, "The QR code could not be drawn for this Address. Type it above instead.", width)
}

func (q *qrModal) tooSmall(t theme, message string, width int) string {
	inner := max(min(width-4, 56), 1)
	lines := append(q.header(t, inner), "")
	for _, line := range strings.Split(wrap(message, inner), "\n") {
		lines = append(lines, t.fg(t.warn).Render(line))
	}
	return qrPanel(t, append(lines, "", t.dim().Render("Esc closes.")), inner)
}
