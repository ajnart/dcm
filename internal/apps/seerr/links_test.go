package seerr_test

import (
	"context"
	"fmt"
	"net/http/httptest"
	"testing"

	"github.com/ajnart/self-host/internal/app"
	"github.com/ajnart/self-host/internal/apps/arrtest"
	"github.com/ajnart/self-host/internal/apps/seerr"
	"github.com/ajnart/self-host/internal/events"
	"github.com/ajnart/self-host/internal/helpers"
	"github.com/ajnart/self-host/internal/systemtest"
)

type secretMap map[string]string

func (s secretMap) Get(key string) string       { return s[key] }
func (s secretMap) Set(key, value string) error { s[key] = value; return nil }

func linkTo(t *testing.T, target string) app.Link {
	t.Helper()
	for _, l := range (seerr.App{}).Links() {
		if l.Target == target {
			return l
		}
	}
	t.Fatalf("no Link to %s", target)
	return app.Link{}
}

func TestSeerrReachesItsTargetsAtTheirContainerPorts(t *testing.T) {
	fake := arrtest.NewSeerr()
	fake.APIKey = "seerr-key"
	var jellyfinSeen, servarrSeen string
	fake.Jellyfin = func(host string, port int, _, _ string) bool {
		jellyfinSeen = fmt.Sprintf("%s:%d", host, port)
		return true
	}
	fake.JellyfinLibraries = func() []arrtest.JellyfinLibrary { return []arrtest.JellyfinLibrary{{ItemID: "1", Name: "Shows"}} }
	fake.Servarr = func(_, host string, port int, _ string) ([]string, bool) {
		servarrSeen = fmt.Sprintf("%s:%d", host, port)
		return []string{"/media/tv"}, true
	}
	server := httptest.NewServer(fake.Handler())
	t.Cleanup(server.Close)
	secrets := secretMap{"SEERR_API_KEY": "seerr-key", "SONARR_API_KEY": "sonarr-key", "ADMIN_USER": "admin", "ADMIN_PASSWORD": "pw"}
	deps := systemtest.NewDeps(t)
	from := helpers.New(helpers.Config{
		App: "seerr", Service: "seerr", BaseURL: server.URL, URL: server.URL, HTTP: server.Client(),
		Secrets: secrets, Log: events.Discard(), Now: deps.Now, Sleep: deps.Sleep,
	})
	jellyfin := helpers.New(helpers.Config{App: "jellyfin", Service: "jellyfin", ContainerPort: 18096, Secrets: secrets, Log: events.Discard()})
	sonarr := helpers.New(helpers.Config{App: "sonarr", Service: "sonarr", ContainerPort: 18989, Secrets: secrets, Log: events.Discard()})

	if err := linkTo(t, "jellyfin").Apply(context.Background(), from, jellyfin); err != nil {
		t.Fatalf("jellyfin: %v", err)
	}
	if err := linkTo(t, "sonarr").Apply(context.Background(), from, sonarr); err != nil {
		t.Fatalf("sonarr: %v", err)
	}

	if jellyfinSeen != "jellyfin:18096" || servarrSeen != "sonarr:18989" {
		t.Fatalf("Seerr reached Jellyfin at %q and Sonarr at %q, want jellyfin:18096 and sonarr:18989", jellyfinSeen, servarrSeen)
	}
}
