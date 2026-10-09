package tui

import (
	"slices"
	"strings"

	"charm.land/lipgloss/v2"

	"github.com/ajnart/self-host/internal/service"
)

// The Exposure explanations are shared by Onboarding's Where step and
// Settings' Host sub-tab. They say what Exposure does: lan publishes the
// Apps' ports on 0.0.0.0 and local on 127.0.0.1, and the LAN address only
// builds App links.

// exposureAddress is the address a person types to open an App.
func exposureAddress(exposure, lanIP string) string {
	switch {
	case exposure == service.ExposureLocal:
		return service.BindIP(service.ExposureLocal)
	case strings.TrimSpace(lanIP) == "":
		return "LAN address"
	}
	return strings.TrimSpace(lanIP)
}

// exposureText is who can open the Apps, in plain words.
func exposureText(exposure, lanIP string) string {
	if exposure == service.ExposureLocal {
		return "Your Apps open only in a browser on this computer. Other devices can't reach them."
	}
	address := strings.TrimSpace(lanIP)
	if address == "" {
		address = "this computer's address"
	}
	return "Phones, TVs and laptops on the same Wi-Fi or router as this computer can open your Apps at " + address +
		". Nobody on the internet can."
}

// exposureFacts is what Exposure does underneath: where the Apps' ports are
// published, and that the LAN address only builds links.
func exposureFacts(exposure string) string {
	bind := service.BindIP(exposure)
	if exposure == service.ExposureLocal {
		return "Apps are published on " + bind + ", this computer only. Links use " + bind + "."
	}
	return "Apps are published on " + bind + ", every address of this computer. The LAN address only builds links."
}

// exposureDiagram draws who can reach this computer: devices, then the
// router, then this computer, and the internet beyond the router, always
// closed. The large one is boxed. Both fit width.
func exposureDiagram(t theme, exposure, lanIP string, width int, large bool) []string {
	local := exposure == service.ExposureLocal
	address := exposureAddress(exposure, lanIP)
	if large {
		if lines := boxedDiagram(t, local, address, width); lines != nil {
			return lines
		}
	}
	return lineDiagram(t, local, address, width)
}

// lineDiagram is three lines: the path on the first and, under the router,
// its way to the internet.
func lineDiagram(t theme, local bool, address string, width int) []string {
	const left = "────"
	right := "────"
	rightStyled := t.fg(t.ok).Render(right)
	if local {
		right = "──✗──"
		rightStyled = t.fg(t.ok).Render("──") + t.fg(t.fail).Render("✗") + t.fg(t.ok).Render("──")
	}
	devices := "phones · TVs · laptops"
	if lipgloss.Width(devices+" "+left+" router "+right+" this computer "+address) > width {
		devices = "devices"
	}
	path := t.body().Render(devices) + " " + t.fg(t.ok).Render(left) + " " + t.heading().Render("router") + " " + rightStyled +
		" " + t.body().Render("this computer ") + t.fg(t.accentText).Render(address)
	centre := lipgloss.Width(devices) + 1 + lipgloss.Width(left) + 1 + 3
	lines := []string{path, strings.Repeat(" ", centre) + t.dim().Render("│"),
		strings.Repeat(" ", max(centre-5, 0)) + t.body().Render("internet ") + t.fg(t.fail).Render("✗")}
	for i, line := range lines {
		lines[i] = truncate(line, width)
	}
	return lines
}

// diagramBox draws lines in a rounded border, each padded and in its style.
func diagramBox(t theme, lines []string, styles []lipgloss.Style, inner int) []string {
	border := t.dim()
	rows := []string{border.Render("╭" + strings.Repeat("─", inner) + "╮")}
	for i, line := range lines {
		rows = append(rows, border.Render("│")+" "+styles[i].Render(pad(line, inner-2))+" "+border.Render("│"))
	}
	return append(rows, border.Render("╰"+strings.Repeat("─", inner)+"╯"))
}

// boxedDiagram is the larger diagram, four lines of boxes; nil when the
// boxes do not fit width.
func boxedDiagram(t theme, local bool, address string, width int) []string {
	devices := []string{"phones", "TVs · laptops"}
	computer := []string{"this computer", address}
	innerOf := func(lines ...string) int {
		inner := 0
		for _, line := range lines {
			inner = max(inner, lipgloss.Width(line))
		}
		return inner + 2
	}
	a, b, c := innerOf(devices...), innerOf("router"), innerOf(computer...)
	link := 6
	for link >= 3 && a+b+c+6+2*link > width {
		link--
	}
	if link < 3 {
		return nil
	}
	body := t.body()
	boxA := diagramBox(t, devices, []lipgloss.Style{body, body}, a)
	boxB := diagramBox(t, []string{"router"}, []lipgloss.Style{t.heading()}, b)
	boxC := diagramBox(t, computer, []lipgloss.Style{body, t.fg(t.accentText)}, c)
	toInternet := (b - 1) / 2
	boxB[2] = t.dim().Render("╰" + strings.Repeat("─", toInternet) + "┬" + strings.Repeat("─", b-1-toInternet) + "╯")
	open := t.fg(t.ok).Render(strings.Repeat("─", link))
	toComputer := open
	if local {
		half := (link - 1) / 2
		toComputer = t.fg(t.ok).Render(strings.Repeat("─", half)) + t.fg(t.fail).Render("✗") + t.fg(t.ok).Render(strings.Repeat("─", link-1-half))
	}
	gap := strings.Repeat(" ", link)
	closed := pad(strings.Repeat(" ", max((b+2-lipgloss.Width("internet ✗"))/2, 0))+t.body().Render("internet ")+t.fg(t.fail).Render("✗"), b+2)
	return []string{
		boxA[0] + gap + boxB[0] + gap + boxC[0],
		boxA[1] + open + boxB[1] + toComputer + boxC[1],
		boxA[2] + gap + boxB[2] + gap + boxC[2],
		boxA[3] + gap + closed + gap + boxC[3],
	}
}

// exposureHelp is the Exposure help page: the larger diagram for the
// choice, what it means, and what else decides who can reach the Apps.
func exposureHelp(t theme, exposure, lanIP string, width int) []string {
	lines := exposureDiagram(t, exposure, lanIP, width, true)
	paragraph := func(style lipgloss.Style, text string) {
		for _, line := range strings.Split(wrap(text, width), "\n") {
			lines = append(lines, style.Render(line))
		}
	}
	section := func(heading, text string) {
		lines = append(lines, "", t.heading().Render(heading))
		paragraph(t.body(), text)
	}
	lines = append(lines, "")
	paragraph(t.body(), exposureText(exposure, lanIP))
	paragraph(t.dim(), exposureFacts(exposure))
	section("What is a LAN address?",
		"The address of this computer on your home or office network, like 192.168.1.20. Your router usually hands it out. "+
			"Other devices type it into a browser, followed by an App's port. self-host finds it on this machine and uses it "+
			"only to build App links; change it if this computer has more than one.")
	section("The internet",
		"Nobody on the internet can open your Apps unless your router forwards ports to this computer. self-host never sets that up.")
	section("The firewall",
		"If another device cannot connect, this computer's firewall may need a rule that allows the App's port from your network.")
	section("Changing it later",
		"Everything here can be changed later in Settings, under Host.")
	return lines
}

// exposurePage is the Exposure help page for a choice and LAN address.
func exposurePage(exposure, lanIP string) helpPage {
	return helpPage{title: "Who can open your Apps?", lines: func(t theme, width int) []string {
		return exposureHelp(t, exposure, lanIP, width)
	}}
}

// exposureBlock is the live explanation of an Exposure choice as indented
// lines after a blank one, in at most room lines: what it means, where the
// Apps are published and the diagram, shedding them in that order when room
// is short. It is nil when not even the text fits.
func exposureBlock(t theme, exposure, lanIP string, width, room int) []string {
	paragraph := func(style lipgloss.Style, text string) []string {
		var lines []string
		for _, line := range strings.Split(wrap(text, width), "\n") {
			lines = append(lines, "  "+style.Render(strings.TrimRight(line, " ")))
		}
		return lines
	}
	text := paragraph(t.body(), exposureText(exposure, lanIP))
	facts := paragraph(t.dim(), exposureFacts(exposure))
	var diagram []string
	for _, line := range exposureDiagram(t, exposure, lanIP, width, false) {
		diagram = append(diagram, "  "+line)
	}
	for _, block := range [][]string{
		slices.Concat(text, facts, []string{""}, diagram),
		slices.Concat(text, []string{""}, diagram),
		slices.Concat(text, diagram),
		text,
	} {
		if 1+len(block) <= room {
			return append([]string{""}, block...)
		}
	}
	return nil
}
