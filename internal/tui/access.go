package tui

import (
	"slices"
	"strings"

	"charm.land/lipgloss/v2"
)

// The Access options are shared by Onboarding's Access step and Settings'
// Access sub-tab. Each one has a plain-words explanation, a diagram and a
// help page that ends with its technical details. To build one of the options
// not built yet, clear its soon flag and give it the value it stores.

// accessSection is one titled paragraph of an option's help page.
type accessSection struct {
	heading, text string
}

// accessOption is one way to open the Apps.
type accessOption struct {
	id string
	// label is the entry as the lists show it; name is how a sentence calls it.
	label, name string
	// soon marks an option that is not built yet: it is dimmed and choosing it changes nothing.
	soon bool
	// note makes the option explain instead of choose: enter changes nothing and
	// shows this, given the Access in use. It has no stored value.
	note func(current string) string
	// value is the stored EXPOSURE value choosing the option sets.
	value string
	// text says in plain words what the option does; diagram draws it.
	text    func(lanIP string) string
	diagram func(lanIP string) accessDiagram
	// sections follow the explanation on the help page, before the technical details.
	sections []accessSection
	facts    string
}

var accessOptions = []accessOption{
	{
		id: "home", label: "Home network (default)", name: "Home network", value: "lan",
		text: func(lanIP string) string {
			return "Phones, TVs and laptops on the same Wi-Fi or router as this computer can open your Apps at " + lanAddressOr(lanIP, "this computer's address") +
				". Nobody on the internet can."
		},
		diagram: func(lanIP string) accessDiagram {
			return accessDiagram{
				nodes: []diagramNode{devicesNode, routerNode, {lines: []string{"this computer", lanAddressOr(lanIP, "LAN address")}, accent: true}},
				under: 1, note: "internet", tone: toneClosed,
			}
		},
		sections: []accessSection{
			{"What is a LAN address?",
				"The address of this computer on your home or office network, like 192.168.1.20. Your router usually hands it out. " +
					"Other devices type it into a browser, followed by an App's port. self-host finds it on this machine and uses it " +
					"only to build App links; change it if this computer has more than one."},
			{"The internet",
				"Nobody on the internet can open your Apps unless your router forwards ports to this computer. self-host never sets that up."},
			{"The firewall",
				"If another device cannot connect, this computer's firewall may need a rule that allows the App's port from your network."},
		},
		facts: "Apps are published on 0.0.0.0, every address of this computer. The LAN address only builds links.",
	},
	{
		id: "names", label: "Easy names at home", name: "Easy names at home", soon: true,
		text: func(string) string {
			return "Easy names will let you open each App with a short name like movies.local instead of numbers. " +
				"A small web server on this computer, Caddy, will answer to the names. They will work only on your home network."
		},
		diagram: func(string) accessDiagram {
			return accessDiagram{
				nodes: []diagramNode{devicesNode, routerNode, {lines: []string{"this computer", "movies.local"}, accent: true}},
				under: 1, note: "internet", tone: toneClosed,
			}
		},
		sections: []accessSection{
			{"Which names?",
				"Each App will get its own name, like movies.local, so you type words instead of numbers. Phones, TVs and laptops on your network look the names up on their own."},
			{"The internet",
				"Nobody on the internet will be able to use these names to reach your Apps. They will work only on your home network."},
		},
		facts: "A Caddy container on this computer will own port 80 and forward each name to the App's port. " +
			"Names will be <app>.<lan-ip-with-dashes>.sslip.io and, on Linux, <app>.local announced over mDNS. The IP:port Address keeps working.",
	},
	{
		id: "tailscale", label: "From anywhere, privately", name: "From anywhere, privately", soon: true,
		text: func(string) string {
			return "Tailscale will let you open your Apps from your own phone, laptop or TV wherever you are, over a private network only your devices join."
		},
		diagram: func(string) accessDiagram {
			return accessDiagram{
				nodes: []diagramNode{
					{lines: []string{"your phone or", "laptop, anywhere"}, short: "your phone, anywhere", brief: "your devices"},
					{lines: []string{"Tailscale", "private network"}, short: "Tailscale", heading: true},
					{lines: []string{"this computer", "private name"}, accent: true},
				},
				under: 1, note: "internet", tone: toneClosed,
			}
		},
		sections: []accessSection{
			{"What is Tailscale?",
				"A service that joins your own devices into one private network, wherever they are. Only devices you sign in can see your Apps."},
			{"The internet",
				"Your Apps stay closed to everyone else on the internet."},
		},
		facts: "Tailscale will run on this computer and join it to your tailnet. Apps will be reached at this computer's tailnet name. " +
			"Nothing is published to the internet. The IP:port Address keeps working.",
	},
	{
		id: "cloudflare", label: "Your own web address", name: "Your own web address", soon: true,
		text: func(string) string {
			return "Your own web address, like movies.example.com, will open your Apps from anywhere through Cloudflare Tunnel, " +
				"without opening any port on your router. A login page will stand in front, so only people you allow get in."
		},
		diagram: func(string) accessDiagram {
			return accessDiagram{
				nodes: []diagramNode{
					{lines: []string{"anyone with", "the address"}, short: "anyone with the address", brief: "anyone"},
					{lines: []string{"Cloudflare", "login page"}, short: "Cloudflare", heading: true},
					{lines: []string{"this computer", "no open port"}, accent: true},
				},
				under: 1, note: "login first", tone: toneGuarded,
			}
		},
		sections: []accessSection{
			{"Who can get in?",
				"Anyone with the address reaches the login page, and only people you allow get past it. Anything reachable from the internet needs your own explicit yes first."},
			{"Your router",
				"Nothing on your router changes, and no port is opened."},
		},
		facts: "A cloudflared container will open an outbound tunnel to Cloudflare, DNS records will point your web address at it " +
			"and a Cloudflare Access login policy will sit in front of every route. No router port is opened. The IP:port Address keeps working.",
	},
	{
		id: "custom", label: "Bring your own", name: "Bring your own",
		note: func(current string) string {
			return "Nothing changes: your Apps stay " + accessStays(current) + ". Run: self-host access export"
		},
		text: func(string) string {
			return "Already run your own reverse proxy, such as SWAG, Pangolin, Nginx Proxy Manager, Traefik or Caddy? " +
				"Choosing this changes nothing here. Run self-host access export to print where each App lives, then give it to your proxy. " +
				"You stay in charge of names, certificates and who gets in. Home network keeps working. This one is for advanced users."
		},
		diagram: func(string) accessDiagram {
			return accessDiagram{
				nodes: []diagramNode{
					{lines: []string{"your devices"}},
					{lines: []string{"your proxy", "SWAG · Pangolin"}, short: "your proxy", heading: true},
					{lines: []string{"this computer", "IP:port"}, accent: true},
				},
				under: 1, note: "you set the rules", tone: toneNone,
			}
		},
		sections: []accessSection{
			{"Who is this for?",
				"Advanced users who already run a reverse proxy, such as SWAG, Pangolin, Nginx Proxy Manager, Traefik or their own Caddy, or want to run one. You keep control of names, certificates and who gets in."},
			{"Getting the settings",
				"Run self-host access export --format caddy, nginx, traefik or json. It prints each App's name, where it lives and a hostname to replace with your own. It changes nothing: copy what it prints into your proxy."},
			{"Home network keeps working",
				"Choosing this changes nothing in your Project, and the Apps keep opening at their IP:port on your network. Nothing is set up on the internet either: that is up to your proxy."},
		},
		facts: "self-host access export --format caddy|nginx|traefik|json prints each App's Compose service and container port, " +
			"for a proxy on the Project's Docker network, and the host IP:port for a proxy outside Docker. Traefik output is a file provider, " +
			"so no Docker socket is needed. You run the proxy, its certificates and its login.",
	},
}

// accessLocal is what the stored value local means: the Apps open only on
// this computer. It is a command-line flag, not a choice in the lists.
var accessLocal = accessOption{
	id: "local", label: "This computer only", name: "This computer only", value: "local",
	text: func(string) string {
		return "Your Apps open only in a browser on this computer. Other devices can't reach them."
	},
	diagram: func(string) accessDiagram {
		return accessDiagram{
			nodes:   []diagramNode{devicesNode, routerNode, {lines: []string{"this computer", "127.0.0.1"}, short: "this computer", accent: true}},
			blocked: []bool{false, true},
			under:   1, note: "internet", tone: toneClosed,
		}
	},
	sections: []accessSection{
		{"Other devices", "Phones, TVs and other computers cannot open your Apps. Choose Home network in Settings, under Access, to let devices on your network in."},
	},
	facts: "Apps are published on 127.0.0.1, so only this computer can reach them. The LAN address only builds links, and with this choice they use 127.0.0.1.",
}

var (
	devicesNode = diagramNode{lines: []string{"phones", "TVs · laptops"}, short: "phones · TVs · laptops", brief: "devices"}
	routerNode  = diagramNode{lines: []string{"router"}, heading: true}
)

// accessByID is the option with an id, listed or not.
func accessByID(id string) (accessOption, bool) {
	if id == accessLocal.id {
		return accessLocal, true
	}
	i := slices.IndexFunc(accessOptions, func(o accessOption) bool { return o.id == id })
	if i < 0 {
		return accessOption{}, false
	}
	return accessOptions[i], true
}

// accessInUse is the option the stored EXPOSURE value stands for.
func accessInUse(exposure string) accessOption {
	if exposure == accessLocal.value {
		return accessLocal
	}
	return accessOptions[0]
}

func lanAddressOr(lanIP, fallback string) string {
	if address := strings.TrimSpace(lanIP); address != "" {
		return address
	}
	return fallback
}

// accessStays is where the Apps stay while an option is not available.
func accessStays(current string) string {
	if current == accessLocal.value {
		return "on this computer"
	}
	return "on your network"
}

// explainsOnly is an option that enter cannot choose: one not built yet, or
// one that only explains.
func (o accessOption) explainsOnly() bool { return o.soon || o.note != nil }

// accessNote is the gentle note for enter on an option that cannot be chosen.
func accessNote(o accessOption, current string) string {
	if o.note != nil {
		return o.note(current)
	}
	return o.name + " is coming soon; your Apps stay " + accessStays(current)
}

// accessExplanation explains a highlighted option in plain words; one not
// built yet also says it is not available.
func accessExplanation(o accessOption, current, lanIP string) string {
	if !o.soon {
		return o.text(lanIP)
	}
	return o.text(lanIP) + " It isn't available yet: your Apps stay " + accessStays(current) + "."
}

// accessLabel is an option as the lists show it: one not built yet dimmed and marked.
func accessLabel(t theme, o accessOption) string {
	if o.soon {
		return t.dim().Render(o.label + " · coming soon")
	}
	return o.label
}

// The tone of the note under a diagram.
type noteTone int

const (
	toneNone noteTone = iota
	toneClosed
	toneGuarded
)

// diagramNode is one box of a diagram: its lines for the larger drawing, and
// one-line forms for the smaller one.
type diagramNode struct {
	lines []string
	// short is the one-line form, the lines joined when empty; brief is the
	// form when even that does not fit.
	short, brief    string
	heading, accent bool
}

// accessDiagram is who reaches this computer and how: boxes from left to
// right, a note under one of them, and the links that are blocked.
type accessDiagram struct {
	nodes []diagramNode
	// blocked[i] marks the link between nodes i and i+1 as closed.
	blocked []bool
	under   int
	note    string
	tone    noteTone
}

func (d accessDiagram) isBlocked(i int) bool { return i < len(d.blocked) && d.blocked[i] }

// accessDiagramLines draws an option: the large one in boxes, the small one
// as a line. Both fit width.
func accessDiagramLines(t theme, o accessOption, lanIP string, width int, large bool) []string {
	d := o.diagram(lanIP)
	if large {
		if lines := d.boxed(t, width); lines != nil {
			return lines
		}
	}
	return d.line(t, width)
}

func (d accessDiagram) noteText(t theme) (string, int) {
	text, glyph := t.body().Render(d.note), ""
	switch d.tone {
	case toneClosed:
		glyph = t.fg(t.fail).Render("✗")
	case toneGuarded:
		glyph = t.fg(t.warn).Render("✓")
	}
	if glyph != "" {
		text += " " + glyph
	}
	return text, lipgloss.Width(text)
}

// link draws the way between two boxes, n cells wide.
func (d accessDiagram) link(t theme, i, n int) string {
	if !d.isBlocked(i) {
		return t.fg(t.ok).Render(strings.Repeat("─", n))
	}
	half := (n - 1) / 2
	return t.fg(t.ok).Render(strings.Repeat("─", half)) + t.fg(t.fail).Render("✗") + t.fg(t.ok).Render(strings.Repeat("─", n-1-half))
}

// line is three lines: the path on the first and, under one box, the note.
func (d accessDiagram) line(t theme, width int) []string {
	var path string
	var centre int
	note, noteWidth := d.noteText(t)
	for _, brief := range []bool{false, true} {
		path, centre = "", 0
		for i, n := range d.nodes {
			if i > 0 {
				link := 4
				if d.isBlocked(i - 1) {
					link = 5
				}
				path += " " + d.link(t, i-1, link) + " "
			}
			text := n.lineText(t, brief)
			if i == d.under {
				centre = lipgloss.Width(path) + lipgloss.Width(text)/2
			}
			path += text
		}
		if lipgloss.Width(path) <= width {
			break
		}
	}
	lines := []string{path, strings.Repeat(" ", centre) + t.dim().Render("│"),
		strings.Repeat(" ", max(centre-noteWidth/2, 0)) + note}
	for i, line := range lines {
		lines[i] = truncate(line, width)
	}
	return lines
}

func (n diagramNode) lineText(t theme, brief bool) string {
	style := t.body()
	if n.heading {
		style = t.heading()
	}
	switch {
	case brief && n.brief != "":
		return style.Render(n.brief)
	case n.short != "":
		return style.Render(n.short)
	case n.accent && len(n.lines) > 1:
		last := len(n.lines) - 1
		return style.Render(strings.Join(n.lines[:last], " ")) + " " + t.fg(t.accentText).Render(n.lines[last])
	}
	return style.Render(strings.Join(n.lines, " "))
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

// boxed is the larger diagram, boxes joined by links with the note under
// one of them; nil when the boxes do not fit width.
func (d accessDiagram) boxed(t theme, width int) []string {
	boxes := make([][]string, len(d.nodes))
	inners := make([]int, len(d.nodes))
	total := 0
	for i, n := range d.nodes {
		for _, line := range n.lines {
			inners[i] = max(inners[i], lipgloss.Width(line))
		}
		inners[i] += 2
		total += inners[i] + 2
		styles := make([]lipgloss.Style, len(n.lines))
		for j := range styles {
			switch {
			case n.heading:
				styles[j] = t.heading()
			case n.accent && j == len(n.lines)-1 && j > 0:
				styles[j] = t.fg(t.accentText)
			default:
				styles[j] = t.body()
			}
		}
		boxes[i] = diagramBox(t, n.lines, styles, inners[i])
	}
	link := 6
	for link >= 3 && total+(len(d.nodes)-1)*link > width {
		link--
	}
	if link < 3 {
		return nil
	}
	under := d.under
	toNote := (inners[under] - 1) / 2
	last := len(boxes[under]) - 1
	boxes[under][last] = t.dim().Render("╰" + strings.Repeat("─", toNote) + "┬" + strings.Repeat("─", inners[under]-1-toNote) + "╯")
	note, noteWidth := d.noteText(t)
	boxWidth := inners[under] + 2
	noteCell := pad(strings.Repeat(" ", max((boxWidth-noteWidth)/2, 0))+note, boxWidth)

	height := 0
	for _, b := range boxes {
		height = max(height, len(b))
	}
	height = max(height, len(boxes[under])+1)
	rows := make([]string, height)
	for r := range rows {
		for i, b := range boxes {
			if i > 0 {
				if r == 1 {
					rows[r] += d.link(t, i-1, link)
				} else {
					rows[r] += strings.Repeat(" ", link)
				}
			}
			switch {
			case r < len(b):
				rows[r] += b[r]
			case i == under && r == len(b):
				rows[r] += noteCell
			default:
				rows[r] += strings.Repeat(" ", inners[i]+2)
			}
		}
	}
	return rows
}

// accessHelp is an option's help page: the larger diagram, what it means,
// whatever else a person should know, and the technical details last.
func accessHelp(t theme, o accessOption, lanIP string, width int) []string {
	lines := accessDiagramLines(t, o, lanIP, width, true)
	paragraph := func(style lipgloss.Style, text string) {
		for _, line := range strings.Split(wrap(text, width), "\n") {
			lines = append(lines, style.Render(strings.TrimRight(line, " ")))
		}
	}
	section := func(heading, text string) {
		lines = append(lines, "", t.heading().Render(heading))
		paragraph(t.body(), text)
	}
	lines = append(lines, "")
	paragraph(t.body(), o.text(lanIP))
	if o.soon {
		section("Not available yet", "This option is coming soon. For now your Apps stay where they are, and choosing it changes nothing.")
	}
	for _, s := range o.sections {
		section(s.heading, s.text)
	}
	section("Changing it later", "Everything here can be changed later in Settings, under Access.")
	section("Technical details", o.facts)
	return lines
}

// accessPage is an option's help page for a LAN address.
func accessPage(o accessOption, lanIP string) helpPage {
	return helpPage{title: o.name, lines: func(t theme, width int) []string {
		return accessHelp(t, o, lanIP, width)
	}}
}

// accessBlock is the live explanation of the highlighted option with its
// diagram, as indented lines after a blank one, in at most room lines: what
// it means in plain words and the diagram, shedding the blank line, then the
// diagram, when room is short. It is nil when not even the text fits.
func accessBlock(t theme, o accessOption, current, lanIP string, width, room int) []string {
	paragraph := func(style lipgloss.Style, text string) []string {
		var lines []string
		for _, line := range strings.Split(wrap(text, width), "\n") {
			lines = append(lines, "  "+style.Render(strings.TrimRight(line, " ")))
		}
		return lines
	}
	text := paragraph(t.body(), accessExplanation(o, current, lanIP))
	var diagram []string
	for _, line := range accessDiagramLines(t, o, lanIP, width, false) {
		diagram = append(diagram, "  "+line)
	}
	for _, block := range [][]string{
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
