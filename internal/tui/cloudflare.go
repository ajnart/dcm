package tui

import (
	"fmt"
	"slices"
	"strings"

	"charm.land/bubbles/v2/key"
	"charm.land/bubbles/v2/textinput"
	tea "charm.land/bubbletea/v2"
	"github.com/ajnart/self-host/internal/app"
	"github.com/ajnart/self-host/internal/service"
)

type cloudflarePane struct {
	stage, cursor, offset int
	input                 textinput.Model
	opts                  service.CloudflareOptions
	apps                  []app.Info
	err                   string
	remove                bool
	plan                  service.CloudflarePlan
}

func newCloudflarePane(ctx *viewContext) *cloudflarePane {
	p := &cloudflarePane{}
	for _, installed := range ctx.status.Apps {
		if a, ok := ctx.backend.Catalog().App(installed.ID); ok && installed.Managed && !a.Info().NoWebUI && a.Info().ContainerPort > 0 {
			p.apps = append(p.apps, a.Info())
		}
	}
	return p
}

func (p *cloudflarePane) keys() []key.Binding {
	if p.stage == 4 {
		return []key.Binding{hint("y/n", "choose App"), hint("esc", "cancel")}
	}
	if p.stage == 6 {
		return []key.Binding{hint("enter", "confirm word"), hint("↑/↓", "scroll"), hint("esc", "cancel")}
	}
	return []key.Binding{hint("enter", "continue"), hint("esc", "cancel")}
}

func (p *cloudflarePane) field(stage int) tea.Cmd {
	p.stage, p.err, p.offset = stage, "", 0
	p.input = textinput.New()
	p.input.Prompt = ""
	p.input.CharLimit = 4096
	if stage == 3 {
		p.input.EchoMode, p.input.EchoCharacter = textinput.EchoPassword, '*'
	}
	p.input.Focus()
	return textinput.Blink
}

func (p *cloudflarePane) nextApp(ctx *viewContext) tea.Cmd {
	p.stage, p.err = 4, ""
	if p.cursor >= len(p.apps) {
		opts := p.opts
		opts.APIToken, opts.APITokenFile = "", ""
		plan, err := ctx.backend.CloudflarePlan(opts)
		p.plan = plan
		if err != nil {
			p.stage = 6
			p.err = err.Error()
			return nil
		}
		return p.field(6)
	}
	return nil
}

func (p *cloudflarePane) choose(ctx *viewContext) tea.Cmd {
	a := p.apps[p.cursor]
	p.opts.Apps = append(p.opts.Apps, a.ID)
	p.cursor++
	return p.nextApp(ctx)
}

func (p *cloudflarePane) update(ctx *viewContext, msg tea.KeyPressMsg) (tea.Cmd, bool) {
	if msg.String() == "esc" {
		p.opts.APIToken = ""
		return nil, true
	}
	if p.stage == 0 {
		if msg.String() == "r" && (ctx.status.CloudflareCleanup || slices.Contains(ctx.status.Access, "cloudflare")) {
			p.remove = true
			return p.field(3), false
		}
		if msg.String() == "enter" {
			return p.field(1), false
		}
		return nil, false
	}
	if p.stage == 4 {
		switch msg.String() {
		case "y", "Y":
			if _, private := service.CloudflarePublicationWarning(p.apps[p.cursor]); private {
				return p.field(5), false
			}
			return p.choose(ctx), false
		case "n", "N":
			p.cursor++
			return p.nextApp(ctx), false
		}
		return nil, false
	}
	if p.stage == 6 && (msg.String() == "up" || msg.String() == "down") {
		if msg.String() == "up" {
			p.offset = max(p.offset-1, 0)
		} else {
			p.offset++
		}
		return nil, false
	}
	if msg.String() == "enter" {
		value := strings.TrimSpace(p.input.Value())
		switch p.stage {
		case 1:
			if value == "" {
				p.err = "Give your main domain, like example.com"
				return nil, false
			}
			p.opts.Domain = strings.TrimSuffix(strings.ToLower(value), ".")
			return p.field(2), false
		case 2:
			if value == "" {
				p.err = "Name at least one allowed email"
				return nil, false
			}
			p.opts.Emails = strings.Split(value, ",")
			return p.field(3), false
		case 3:
			if value == "" {
				p.err = "The private API token is required for this change"
				return nil, false
			}
			p.opts.APIToken = value
			p.input.SetValue("")
			if p.remove {
				return p.field(6), false
			}
			return p.nextApp(ctx), false
		case 5:
			if value != p.apps[p.cursor].ID {
				p.err = "Type the App's exact name to accept this risk"
				return nil, false
			}
			p.opts.Allow = append(p.opts.Allow, value)
			return p.choose(ctx), false
		case 6:
			word, action := "publish", ActionCloudflarePublish
			if p.remove {
				word, action = "remove", ActionCloudflareRemove
			}
			if !p.remove && len(p.plan.Publish) == 0 {
				p.err = "No Apps chosen. Escape to cancel and choose again."
				return nil, false
			}
			if value != word {
				p.err = "Type " + word + " to give the separate yes"
				return nil, false
			}
			opts := p.opts
			opts.AcceptPublic = true
			p.opts.APIToken = ""
			return ctx.run(Request{Action: action, Cloudflare: &opts}, string(action)), true
		}
	}
	var cmd tea.Cmd
	p.input, cmd = p.input.Update(msg)
	return cmd, false
}

func (p *cloudflarePane) box(ctx *viewContext, width, height int) string {
	t := ctx.theme
	inner := max(width-6, 12)
	var lines []string
	add := func(text string) { lines = append(lines, strings.Split(wrap(text, inner), "\n")...) }
	switch p.stage {
	case 0:
		add("Before you begin: your main domain must be active on Cloudflare. Open one.dash.cloudflare.com, choose a team name, the Zero Trust Free plan (50 users), and a payment method that is not charged.")
		add("Create a private API token with the five exact permissions in ? more. Nothing is published by default. Enter to choose Apps and allowed emails.")
		if ctx.status.CloudflareCleanup || slices.Contains(ctx.status.Access, "cloudflare") {
			add("To take the published Addresses down instead, press r. You will need the API token again.")
		}
	case 1:
		add("Your main domain already active on Cloudflare, like example.com (not home.example.com)")
	case 2:
		add("Who may sign in? Allowed emails, separated by commas. Check spelling: mistyped emails fail silently. Each signed-in email uses one of the 50 Free seats.")
	case 3:
		add("Private scoped API token (hidden, never saved). Changes and removal need it again.")
	case 4, 5:
		a := p.apps[p.cursor]
		add(fmt.Sprintf("App %d of %d: %s", p.cursor+1, len(p.apps), a.Name))
		add("Address: https://" + a.ID + "." + p.opts.Domain)
		if warning, _ := service.CloudflarePublicationWarning(a); warning != "" {
			add(warning)
		}
		if p.stage == 5 {
			add("This App normally stays private. To deliberately publish it, type " + a.ID)
		} else {
			add("Choose this App? y/n (nothing selected by default)")
		}
	case 6:
		if p.remove {
			add("Take every Cloudflare Address off the internet. The shared PIN provider and organization stay. The IP:port Addresses keep working. Type remove to confirm.")
		} else {
			for _, a := range p.plan.Current {
				add("Current " + a.Address)
			}
			for _, a := range p.plan.Additions {
				add("Add " + a.Address)
			}
			for _, name := range p.plan.Dropped {
				add("Remove https://" + name)
			}
			for _, a := range p.plan.Publish {
				if a.Warning != "" {
					add(a.Warning)
				}
			}
			for _, a := range p.plan.Refused {
				add(a.Reason)
			}
			add(p.plan.Risk)
			add("Type publish to give the separate yes.")
		}
	}
	room := max(height-7, 3)
	p.offset = min(p.offset, max(len(lines)-room, 0))
	lines = lines[p.offset:min(p.offset+room, len(lines))]
	if p.stage != 0 && p.stage != 4 {
		p.input.SetWidth(inner)
		lines = append(lines, "", p.input.View())
	}
	if p.err != "" {
		lines = append(lines, truncate(t.fg(t.fail).Render(p.err), inner))
	}
	for i := range lines {
		lines[i] = "  " + truncate(lines[i], inner)
	}
	return t.box("Your own web address", "", strings.Join(lines, "\n"), width, len(lines)+2, true)
}
