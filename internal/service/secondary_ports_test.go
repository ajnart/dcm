package service

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/ajnart/self-host/internal/app"
	"github.com/ajnart/self-host/internal/apps/pihole"
	"github.com/ajnart/self-host/internal/apps/qbittorrent"
	"github.com/ajnart/self-host/internal/apps/technitiumdns"
	"go.yaml.in/yaml/v3"
)

func TestInstallAllocatesAvailableSecondaryPorts(t *testing.T) {
	for _, tc := range []struct {
		app app.App
		key string
	}{
		{qbittorrent.App{}, "torrent-port"},
		{pihole.App{}, "dns-port"},
		{technitiumdns.App{}, "dns-port"},
	} {
		t.Run(tc.app.Info().ID, func(t *testing.T) {
			h := newHarness(t, tc.app)
			h.deps.PortFree = func(port int) bool { return port != 53 && port != 6881 }

			if err := h.svc.Install(context.Background(), InstallOptions{Targets: []string{tc.app.Info().ID}}); err != nil && !errors.Is(err, ErrIncomplete) {
				t.Fatal(err)
			}

			state, err := h.svc.Project()
			if err != nil {
				t.Fatal(err)
			}
			stored, err := state.LoadState()
			if err != nil {
				t.Fatal(err)
			}
			selected := stored.Apps[tc.app.Info().ID].Inputs[tc.key]
			if selected == "53" || selected == "6881" || selected == "" {
				t.Fatalf("secondary port was not allocated away from occupied default: %q", selected)
			}
			fragment, err := os.ReadFile(filepath.Join(h.root(), "apps", tc.app.Info().ID, "compose.yml"))
			if err != nil {
				t.Fatal(err)
			}
			if !strings.Contains(string(fragment), "${BIND_IP}:"+selected+":") {
				t.Fatalf("allocated secondary port %s missing from Compose fragment", selected)
			}
		})
	}
}

func TestComposeSecondaryPortsKeepDefaultsAndSelectedProtocolTargets(t *testing.T) {
	for _, tc := range []struct {
		app                      app.App
		key, defaultPort, target string
	}{
		{qbittorrent.App{}, "torrent-port", "6881", ""},
		{pihole.App{}, "dns-port", "53", "53"},
		{technitiumdns.App{}, "dns-port", "53", "53"},
	} {
		for _, selected := range []string{"", "24567"} {
			t.Run(tc.app.Info().ID+"/"+selected, func(t *testing.T) {
				var doc struct {
					Services map[string]struct {
						Ports       []string
						Environment map[string]string
					}
				}
				if err := yaml.Unmarshal([]byte(tc.app.Compose(app.RenderContext{Port: 29000, Inputs: map[string]string{tc.key: selected}})), &doc); err != nil {
					t.Fatal(err)
				}
				host := selected
				if host == "" {
					host = tc.defaultPort
				}
				target := tc.target
				if target == "" {
					target = host
				}
				svc := doc.Services[tc.app.Info().Service]
				for _, protocol := range []string{"tcp", "udp"} {
					want := "${BIND_IP}:" + host + ":" + target
					if protocol == "udp" {
						want += "/udp"
					}
					found := false
					for _, port := range svc.Ports {
						if port == want || protocol == "tcp" && port == want+"/tcp" {
							found = true
						}
					}
					if !found {
						t.Errorf("missing selected %s publication %s", protocol, want)
					}
				}
				if tc.key == "torrent-port" && svc.Environment["TORRENTING_PORT"] != host {
					t.Fatal("peer listener differs from published torrent port")
				}
			})
		}
	}
}

func TestInvalidSecondaryPortsAreRejectedBeforeApply(t *testing.T) {
	for _, a := range []app.App{qbittorrent.App{}, pihole.App{}, technitiumdns.App{}} {
		key := "dns-port"
		if a.Info().ID == "qbittorrent" {
			key = "torrent-port"
		}
		for _, value := range []string{"0", "65536", "-1", "1.5", "53/udp", "53\n    privileged: true", "+53", " 53"} {
			t.Run(a.Info().ID+"/"+value, func(t *testing.T) {
				h := newHarness(t, a)
				err := h.svc.Install(context.Background(), InstallOptions{Targets: []string{a.Info().ID}, Sets: []string{a.Info().ID + "." + key + "=" + value}})
				if err == nil || !strings.Contains(err.Error(), key) {
					t.Fatalf("invalid port was not rejected as %s input", key)
				}
				if len(h.runner.Calls()) != 0 {
					t.Fatal("invalid port reached host/Docker operations")
				}
			})
		}
	}
}
