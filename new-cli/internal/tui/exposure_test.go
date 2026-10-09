package tui

import (
	"slices"
	"strings"
	"testing"

	"github.com/charmbracelet/x/ansi"

	"github.com/ajnart/self-host/internal/service"
)

func diagramText(exposure, lanIP string, width int, large bool) string {
	return ansi.Strip(strings.Join(exposureDiagram(newTheme(true), exposure, lanIP, width, large), "\n"))
}

func TestDiagramShowsDevicesThenRouterThenThisComputerWithNoInternet(t *testing.T) {
	for _, large := range []bool{false, true} {
		lan := diagramText(service.ExposureLAN, "192.168.1.20", 76, large)
		for _, want := range []string{"phones", "router", "this computer", "192.168.1.20", "internet ✗"} {
			if !strings.Contains(lan, want) {
				t.Errorf("large=%v: the lan diagram lacks %q\n%s", large, want, lan)
			}
		}
		if i, j, k := strings.Index(lan, "phones"), strings.Index(lan, "router"), strings.Index(lan, "this computer"); i > j || j > k {
			t.Errorf("large=%v: devices, router and this computer must read in that order\n%s", large, lan)
		}

		local := diagramText(service.ExposureLocal, "192.168.1.20", 76, large)
		if strings.Contains(local, "192.168.1.20") || !strings.Contains(local, "internet ✗") || strings.Contains(local, "127.0.0.1") != large {
			t.Errorf("large=%v: the local diagram names no LAN address, and 127.0.0.1 only in the larger one\n%s", large, local)
		}
		if !strings.Contains(local, "✗") || local == lan || strings.Count(local, "✗") < 2 {
			t.Errorf("large=%v: the local diagram must show the blocked way to this computer\n%s", large, local)
		}
	}
}

func TestDiagramNeverOverflowsItsWidth(t *testing.T) {
	for _, exposure := range []string{service.ExposureLAN, service.ExposureLocal} {
		for _, large := range []bool{false, true} {
			for _, width := range []int{76, 66, 60, 50, 40} {
				for _, line := range strings.Split(diagramText(exposure, "192.168.100.200", width, large), "\n") {
					if ansi.StringWidth(line) > width {
						t.Errorf("%s large=%v width=%d: %q is wider", exposure, large, width, line)
					}
				}
			}
		}
	}
}

func TestDiagramWithoutALANAddressSaysSo(t *testing.T) {
	out := diagramText(service.ExposureLAN, "", 76, false)

	if !strings.Contains(out, "this computer") || !strings.Contains(out, "LAN address") {
		t.Fatalf("an empty LAN address must be called by its name, not left blank\n%s", out)
	}
}

func TestExposureHelpPageTellsWhatTheTicketPromises(t *testing.T) {
	lines := exposureHelp(newTheme(true), service.ExposureLAN, "192.168.1.20", 70)
	text := strings.Join(strings.Fields(ansi.Strip(strings.Join(lines, "\n"))), " ")

	for _, want := range []string{
		"internet ✗",
		"What is a LAN address?",
		"Nobody on the internet can open your Apps unless your router forwards ports",
		"firewall",
		"Settings",
		"Technical details",
		"published on 0.0.0.0",
		"The LAN address only builds links",
	} {
		if !strings.Contains(text, want) {
			t.Errorf("the Exposure help page lacks %q\n%s", want, text)
		}
	}
	if local := strings.Join(exposureHelp(newTheme(true), service.ExposureLocal, "192.168.1.20", 70), "\n"); !strings.Contains(flat(ansi.Strip(local)), "published on 127.0.0.1") {
		t.Errorf("the page for this computer only names 127.0.0.1\n%s", local)
	}
	if !strings.HasSuffix(strings.TrimSpace(text), "Technical details Apps are published on 0.0.0.0, every address of this computer. The LAN address only builds links.") {
		t.Errorf("Technical details is the page's last section\n%s", text)
	}
	if !slices.ContainsFunc(lines, func(l string) bool { return strings.Contains(ansi.Strip(l), "╭") }) {
		t.Errorf("the help page draws the larger boxed diagram\n%s", text)
	}
}

func TestTheLiveExplanationIsPlainWordsWithNoBindAddress(t *testing.T) {
	for _, exposure := range []string{service.ExposureLAN, service.ExposureLocal} {
		for _, room := range []int{20, 8, 4} {
			block := ansi.Strip(strings.Join(exposureBlock(newTheme(true), exposure, exposure, "192.168.1.20", 76, room), "\n"))
			if strings.Contains(block, "0.0.0.0") || strings.Contains(block, "127.0.0.1") || strings.Contains(block, "published") {
				t.Errorf("%s room=%d: the live block must be plain words\n%s", exposure, room, block)
			}
		}
	}
}
