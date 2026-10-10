package tui

import (
	"slices"
	"strings"
	"testing"

	"github.com/charmbracelet/x/ansi"
)

func diagramText(o accessOption, lanIP string, width int, large bool) string {
	return ansi.Strip(strings.Join(accessDiagramLines(newTheme(true), o, lanIP, width, large), "\n"))
}

func accessHelpText(o accessOption, lanIP string, width int) string {
	return flat(ansi.Strip(strings.Join(accessHelp(newTheme(true), o, lanIP, width), "\n")))
}

func TestTheAccessOptionsAreTheFiveWaysToOpenYourApps(t *testing.T) {
	var got []string
	for _, o := range accessOptions {
		got = append(got, o.id+"|"+o.label)
	}
	want := []string{
		"home|Home network (default)",
		"names|Easy names at home",
		"tailscale|From anywhere, privately",
		"cloudflare|Your own web address",
		"custom|Bring your own",
	}
	if !slices.Equal(got, want) {
		t.Fatalf("options %q, want %q", got, want)
	}
	for _, o := range accessOptions {
		if o.soon != !slices.Contains([]string{"home", "names", "custom"}, o.id) {
			t.Errorf("%s: Home network, Easy names and Bring your own are available, soon=%v", o.id, o.soon)
		}
	}
}

func TestEveryOptionDrawsItsWayFromYourDevicesToThisComputerInBothSizes(t *testing.T) {
	for _, tc := range []struct {
		id   string
		want []string
	}{
		{"home", []string{"phones", "router", "this computer", "192.168.1.20", "internet ✗"}},
		{"names", []string{"phones", "router", "Caddy", "internet ✗"}},
		{"tailscale", []string{"anywhere", "Tailscale", "this computer", "internet ✗"}},
		{"cloudflare", []string{"anyone", "Cloudflare", "login first", "this computer"}},
		{"custom", []string{"your devices", "your proxy", "this computer"}},
	} {
		o, _ := accessByID(tc.id)
		for _, large := range []bool{false, true} {
			out := diagramText(o, "192.168.1.20", 76, large)
			for _, want := range tc.want {
				if !strings.Contains(out, want) {
					t.Errorf("%s large=%v: the diagram lacks %q\n%s", tc.id, large, want, out)
				}
			}
		}
	}
}

func TestTheHomeNetworkDiagramReadsDevicesThenRouterThenThisComputer(t *testing.T) {
	o, _ := accessByID("home")
	for _, large := range []bool{false, true} {
		out := diagramText(o, "192.168.1.20", 76, large)
		if i, j, k := strings.Index(out, "phones"), strings.Index(out, "router"), strings.Index(out, "this computer"); i > j || j > k {
			t.Errorf("large=%v: devices, router and this computer must read in that order\n%s", large, out)
		}
	}
}

func TestThisComputerOnlyShowsTheBlockedWayAndNamesNoLANAddress(t *testing.T) {
	home, _ := accessByID("home")
	for _, large := range []bool{false, true} {
		local := diagramText(accessLocal, "192.168.1.20", 76, large)
		if strings.Contains(local, "192.168.1.20") || !strings.Contains(local, "internet ✗") || strings.Contains(local, "127.0.0.1") != large {
			t.Errorf("large=%v: no LAN address, and 127.0.0.1 only in the larger diagram\n%s", large, local)
		}
		if strings.Count(local, "✗") < 2 || local == diagramText(home, "192.168.1.20", 76, large) {
			t.Errorf("large=%v: the way to this computer must show as blocked\n%s", large, local)
		}
	}
}

func TestNoDiagramOverflowsItsWidth(t *testing.T) {
	for _, o := range append(slices.Clone(accessOptions), accessLocal) {
		for _, large := range []bool{false, true} {
			for _, width := range []int{76, 66, 60, 50, 40} {
				for _, line := range strings.Split(diagramText(o, "192.168.100.200", width, large), "\n") {
					if ansi.StringWidth(line) > width {
						t.Errorf("%s large=%v width=%d: %q is wider", o.id, large, width, line)
					}
				}
			}
		}
	}
}

func TestADiagramWithoutALANAddressCallsItByName(t *testing.T) {
	o, _ := accessByID("home")

	out := diagramText(o, "", 76, false)

	if !strings.Contains(out, "this computer") || !strings.Contains(out, "LAN address") {
		t.Fatalf("an empty LAN address must be called by its name, not left blank\n%s", out)
	}
}

func TestEveryHelpPageEndsWithTechnicalDetailsAndDrawsTheLargerDiagram(t *testing.T) {
	for _, tc := range []struct {
		id      string
		details string
	}{
		{"home", "Technical details Apps are published on 0.0.0.0, every address of this computer. The LAN address only builds links."},
		{"names", "Technical details One managed Caddy in the Compose Project owns port 80 and routes HTTP requests by Host to each App."},
		{"tailscale", "Technical details Tailscale will run on this computer and join it to your tailnet."},
		{"cloudflare", "Technical details A cloudflared container will open an outbound tunnel to Cloudflare"},
		{"custom", "Technical details self-host access export --format caddy|nginx|traefik|json prints each App's Compose service and container port"},
	} {
		o, _ := accessByID(tc.id)
		lines := accessHelp(newTheme(true), o, "192.168.1.20", 70)
		text := accessHelpText(o, "192.168.1.20", 70)

		section := text[strings.LastIndex(text, "Technical details"):]
		if strings.Count(text, "Technical details") != 1 || !strings.HasPrefix(section, tc.details) {
			t.Errorf("%s: Technical details is the last section and reads %q\n%s", tc.id, tc.details, text)
		}
		if !strings.Contains(text, "under Access") {
			t.Errorf("%s: the page says where to change it later\n%s", tc.id, text)
		}
		if !slices.ContainsFunc(lines, func(l string) bool { return strings.Contains(ansi.Strip(l), "╭") }) {
			t.Errorf("%s: the help page draws the larger boxed diagram\n%s", tc.id, text)
		}
		if o.soon != strings.Contains(text, "coming soon") {
			t.Errorf("%s: only the options not built yet say coming soon\n%s", tc.id, text)
		}
	}
}

func TestTheHomeNetworkHelpPageExplainsTheLANAddressTheInternetAndTheFirewall(t *testing.T) {
	o, _ := accessByID("home")

	text := accessHelpText(o, "192.168.1.20", 70)

	for _, want := range []string{
		"What is a LAN address?",
		"Nobody on the internet can open your Apps unless your router forwards ports",
		"firewall",
	} {
		if !strings.Contains(text, want) {
			t.Errorf("the Home network help page lacks %q\n%s", want, text)
		}
	}
	if local := accessHelpText(accessLocal, "192.168.1.20", 70); !strings.Contains(local, "published on 127.0.0.1") {
		t.Errorf("the page for this computer only names 127.0.0.1\n%s", local)
	}
}

func TestBringYourOwnNamesTheProxiesAndThePrintingCommandAndKeepsHomeNetworkWorking(t *testing.T) {
	o, _ := accessByID("custom")

	for name, text := range map[string]string{
		"live explanation": accessExplanation(o, "lan", "192.168.1.20"),
		"help page":        accessHelpText(o, "192.168.1.20", 70),
	} {
		for _, want := range []string{"SWAG", "Pangolin", "Nginx Proxy Manager", "Traefik", "Caddy", "self-host access export", "advanced users"} {
			if !strings.Contains(flat(text), want) {
				t.Errorf("%s lacks %q\n%s", name, want, text)
			}
		}
		if strings.Contains(text, "coming soon") || strings.Contains(text, "isn't available") {
			t.Errorf("%s: Bring your own is available\n%s", name, text)
		}
	}
	if help := accessHelpText(o, "192.168.1.20", 70); !strings.Contains(help, "Home network keeps working") || !strings.Contains(help, "changes nothing") {
		t.Errorf("the help page says Home network keeps working and nothing changes\n%s", help)
	}
	if got := accessNote(o, "local"); got != "Nothing changes: your Apps stay on this computer. Run: self-host access export" {
		t.Errorf("note %q", got)
	}
}

func TestTheLiveExplanationIsPlainWordsWithNoBindAddress(t *testing.T) {
	for _, o := range append(slices.Clone(accessOptions), accessLocal) {
		for _, room := range []int{20, 8, 4} {
			block := ansi.Strip(strings.Join(accessBlock(newTheme(true), o, "lan", "192.168.1.20", 76, room), "\n"))
			for _, jargon := range []string{"0.0.0.0", "127.0.0.1", "published", "tailnet", "cloudflared", "container"} {
				if strings.Contains(block, jargon) {
					t.Errorf("%s room=%d: the live block must be plain words, found %q\n%s", o.id, room, jargon, block)
				}
			}
		}
	}
}

func TestAnOptionNotBuiltYetSaysWhereYourAppsStay(t *testing.T) {
	names, _ := accessByID("tailscale")

	for _, tc := range []struct{ current, want string }{
		{"lan", "It isn't available yet: your Apps stay on your network."},
		{"local", "It isn't available yet: your Apps stay on this computer."},
	} {
		if got := accessExplanation(names, tc.current, "192.168.1.20"); !strings.HasSuffix(got, tc.want) {
			t.Errorf("current %s: %q should end with %q", tc.current, got, tc.want)
		}
	}
	if got := accessNote(names, "lan"); got != "From anywhere, privately is coming soon; your Apps stay on your network" {
		t.Errorf("note %q", got)
	}
}
