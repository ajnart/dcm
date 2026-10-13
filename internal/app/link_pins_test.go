package app_test

import (
	"context"
	"errors"
	"net/http"
	"testing"
	"time"

	"github.com/ajnart/self-host/internal/app"
	"github.com/ajnart/self-host/internal/apps/arr"
	"github.com/ajnart/self-host/internal/apps/homarr"
	"github.com/ajnart/self-host/internal/apps/seerr"
	"github.com/ajnart/self-host/internal/events"
	"github.com/ajnart/self-host/internal/helpers"
)

type unreachable struct{}

func (unreachable) RoundTrip(*http.Request) (*http.Response, error) {
	return nil, errors.New("unreachable")
}

var containerPorts = map[string]int{"prowlarr": 9696, "sonarr": 8989, "jellyfin": 8096, "seerr": 5055, "qbittorrent": 8080, "homarr": 7575}

func pinnedPair(from, to string, port int) (*helpers.H, *helpers.H, *[]helpers.StepResult) {
	var results []helpers.StepResult
	build := func(name string, port int) *helpers.H {
		return helpers.New(helpers.Config{
			App: name, Service: name, BaseURL: "http://" + name + ".test", URL: "http://" + name + ".example", Port: port,
			ContainerPort: containerPorts[name],
			HTTP:          &http.Client{Transport: unreachable{}},
			Secrets:       secrets{"ADMIN_USER": "admin", "ADMIN_PASSWORD": "pw"},
			Log:           events.Discard(),
			Now:           time.Now,
			Sleep:         func(context.Context, time.Duration) error { return nil },
			Record:        func(r helpers.StepResult) { results = append(results, r) },
		})
	}
	return build(from, 0), build(to, port), &results
}

func linkTo(t *testing.T, links []app.Link, target string) app.Link {
	t.Helper()
	for _, l := range links {
		if l.Target == target {
			return l
		}
	}
	t.Fatalf("no Link to %s", target)
	return app.Link{}
}

func TestLinksKeepTheirStepIDsTitlesMessagesAndHints(t *testing.T) {
	cases := []struct {
		name, from, to               string
		port                         int
		links                        []app.Link
		title                        string
		applyID, applyMsg, applyHint string
		removeID, removeMsg, rmHint  string
	}{
		{
			name: "arr download client", from: "sonarr", to: "qbittorrent", port: 8080,
			links: arr.Sonarr().Links(), title: "download client: qBittorrent",
			applyID: "link-qbittorrent", applyMsg: "use qBittorrent as the download client",
			applyHint: "Open http://sonarr.example > Settings > Download Clients > add qBittorrent with host qbittorrent, port 8080 and the Admin login.",
			removeID:  "unlink-qbittorrent", removeMsg: "remove the qBittorrent download client",
			rmHint: "Open http://sonarr.example > Settings > Download Clients and delete qBittorrent.",
		},
		{
			name: "arr application", from: "prowlarr", to: "sonarr", port: 8989,
			links: arr.Prowlarr().Links(), title: "sync indexers to Sonarr",
			applyID: "link-sonarr", applyMsg: "sync indexers to Sonarr",
			applyHint: "Open http://prowlarr.example > Settings > Apps > add Sonarr with Prowlarr server http://prowlarr:9696, server http://sonarr:8989 and its API key.",
			removeID:  "unlink-sonarr", removeMsg: "stop syncing indexers to Sonarr",
			rmHint: "Open http://prowlarr.example > Settings > Apps and delete Sonarr.",
		},
		{
			name: "seerr server", from: "seerr", to: "sonarr", port: 8989,
			links: seerr.App{}.Links(), title: "requests go to Sonarr",
			applyID: "link-sonarr", applyMsg: "send requests to Sonarr",
			applyHint: "Open http://seerr.example/settings/services, add Sonarr with host sonarr, port 8989, its API key from `self-host credentials`, the first quality profile and root folder /media/tv, marked default.",
			removeID:  "unlink-sonarr", removeMsg: "stop sending requests to Sonarr",
			rmHint: "Open http://seerr.example/settings/services and delete Sonarr.",
		},
		{
			name: "seerr jellyfin", from: "seerr", to: "jellyfin", port: 8096,
			links: seerr.App{}.Links(), title: "media server: Jellyfin",
			applyID: "link-jellyfin", applyMsg: "sign in to Jellyfin and enable its libraries",
			applyHint: "Open http://seerr.example/setup: choose Jellyfin, server jellyfin port 8096, sign in with the Admin login (any email), enable every library and finish.",
		},
		{
			name: "homarr integration", from: "homarr", to: "sonarr", port: 8989,
			links: homarr.App{}.Links(), title: "link Sonarr",
			applyID: "link-sonarr", applyMsg: "add Sonarr to Homarr",
			applyHint: "Open http://homarr.example/manage/integrations to add the Sonarr integration and http://homarr.example/manage/apps to add and place its app tile and its widgets.",
			removeID:  "unlink-sonarr", removeMsg: "remove Sonarr from Homarr",
			rmHint: "Open http://homarr.example/manage/integrations to add the Sonarr integration and http://homarr.example/manage/apps to add and place its app tile and its widgets.",
		},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			link := linkTo(t, c.links, c.to)
			if link.ID != c.applyID || link.Title != c.title {
				t.Fatalf("identity = %q %q, want %q %q", link.ID, link.Title, c.applyID, c.title)
			}
			from, to, results := pinnedPair(c.from, c.to, c.port)
			_ = link.Apply(context.Background(), from, to)
			assertStep(t, *results, c.applyID, c.applyMsg, c.applyHint)
			if c.removeID == "" {
				if link.Remove != nil {
					t.Fatal("unexpected Remove")
				}
				return
			}
			*results = nil
			_ = link.Remove(context.Background(), from, to)
			assertStep(t, *results, c.removeID, c.removeMsg, c.rmHint)
		})
	}
}

func assertStep(t *testing.T, results []helpers.StepResult, id, msg, hint string) {
	t.Helper()
	if len(results) != 1 {
		t.Fatalf("results = %+v, want one", results)
	}
	if r := results[0]; r.ID != id || r.Msg != msg || r.Hint != hint {
		t.Fatalf("step = %q %q %q\nwant   %q %q %q", r.ID, r.Msg, r.Hint, id, msg, hint)
	}
}
