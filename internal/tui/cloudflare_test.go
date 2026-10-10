package tui

import (
	"strconv"
	"strings"
	"testing"

	"github.com/ajnart/self-host/internal/app"
	"github.com/ajnart/self-host/internal/catalog"
	"github.com/charmbracelet/x/ansi"
)

func cloudflareKeys(t *testing.T, m Model, keys ...string) Model {
	t.Helper()
	for _, k := range keys {
		m = drive(t, m, press(k))
	}
	return m
}

func cloudflareSettings(t *testing.T, width, height int) (Model, *fakeBackend) {
	t.Helper()
	m, backend := sample(t, width, height)
	backend.catalog = catalog.New([]app.App{
		stubApp{info: app.Info{ID: "jellyfin", Name: "Jellyfin", Category: "Media", Service: "jellyfin", ContainerPort: 8096}},
		stubApp{info: app.Info{ID: "sonarr", Name: "Sonarr", Category: "Downloads", Service: "sonarr", ContainerPort: 8989}},
	}, nil)
	m = cloudflareKeys(t, m, "5", "]", "down", "down", "down", "enter")
	return m, backend
}

func TestCloudflareSettingsConcealsTokenAndRequiresSeparatePublicationYes(t *testing.T) {
	m, backend := cloudflareSettings(t, 80, 24)
	if !strings.Contains(flat(screen(m)), "Free plan") {
		t.Fatal(screen(m))
	}
	m = drive(t, m, press("enter"))
	m = typeText(t, m, "example.com")
	m = drive(t, m, press("enter"))
	m = typeText(t, m, "alice@example.org")
	m = drive(t, m, press("enter"))
	m = typeText(t, m, "private-ui-token")
	if strings.Contains(screen(m), "private-ui-token") || !strings.Contains(screen(m), "***") {
		t.Fatal("token not masked", screen(m))
	}
	m = drive(t, m, press("enter"))
	if !strings.Contains(flat(screen(m)), "Tailscale") || !strings.Contains(flat(screen(m)), "phone and TV") {
		t.Fatal(screen(m))
	}
	m = cloudflareKeys(t, m, "y", "n", "enter")
	if len(backend.Actions()) != 0 || !strings.Contains(flat(screen(m)), "Anyone in the world") {
		t.Fatal("publication happened before separate yes", screen(m))
	}
	m = typeText(t, m, "publish")
	m = drive(t, m, press("enter"))
	backend.mu.Lock()
	defer backend.mu.Unlock()
	if len(backend.requests) != 1 || backend.requests[0].Cloudflare == nil || !backend.requests[0].Cloudflare.AcceptPublic || backend.requests[0].Cloudflare.APIToken != "private-ui-token" {
		t.Fatal("no typed private publication request", backend.requests)
	}
}

func TestOnboardingCloudflareSelectionWaitsForInstalledApps(t *testing.T) {
	m, backend := freshHost(t)
	m = atAccess(t, m)
	m = cloudflareKeys(t, m, "down", "down", "down", "enter")
	if m.onboarding.step != stepWho || !m.onboarding.answers.cloudflare || len(backend.Actions()) != 0 {
		t.Fatal("choice should defer until Apps exist", screen(m))
	}
}

func TestGoldenCloudflarePrivateInputAndSeparateYes(t *testing.T) {
	for _, size := range []struct {
		width, height int
		suffix        string
	}{{120, 30, ""}, {80, 24, "-narrow"}} {
		t.Run(strconv.Itoa(size.width), func(t *testing.T) {
			m, _ := cloudflareSettings(t, size.width, size.height)
			check := func(stage string) {
				t.Helper()
				out := screen(m)
				for _, line := range strings.Split(out, "\n") {
					if ansi.StringWidth(line) > size.width {
						t.Fatalf("%s exceeds width: %s", stage, line)
					}
				}
				if len(strings.Split(out, "\n")) > size.height || strings.Contains(out, "private-ui-token") {
					t.Fatalf("%s does not fit or leaked", stage)
				}
				golden(t, "cloudflare-"+stage+size.suffix, trimLines(out))
			}
			check("begin")
			m = drive(t, m, press("enter"))
			m = typeText(t, m, "example.com")
			m = drive(t, m, press("enter"))
			m = typeText(t, m, "alice@example.org")
			m = drive(t, m, press("enter"))
			m = typeText(t, m, "private-ui-token")
			check("token")
			m = drive(t, m, press("enter"))
			check("media")
			m = cloudflareKeys(t, m, "y", "y")
			check("private-app")
			m = typeText(t, m, "sonarr")
			m = drive(t, m, press("enter"))
			check("review")
		})
	}
}
