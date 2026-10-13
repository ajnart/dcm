package arr_test

import (
	"context"
	"encoding/json"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/ajnart/self-host/internal/app"
	"github.com/ajnart/self-host/internal/apps/arr"
	"github.com/ajnart/self-host/internal/apps/arrtest"
	"github.com/ajnart/self-host/internal/apps/qbittorrent"
	"github.com/ajnart/self-host/internal/events"
	"github.com/ajnart/self-host/internal/helpers"
	stepstatus "github.com/ajnart/self-host/internal/status"
	"github.com/ajnart/self-host/internal/systemtest"
)

type appStatus struct {
	ID    string
	Setup stepstatus.Setup
	Steps []struct {
		ID     string
		Status stepstatus.Step
	}
}

func appsStatus(t *testing.T, out string) map[string]appStatus {
	t.Helper()
	var status struct{ Apps []appStatus }
	if err := json.Unmarshal([]byte(out), &status); err != nil {
		t.Fatalf("status: %v\n%s", err, out)
	}
	byID := map[string]appStatus{}
	for _, a := range status.Apps {
		byID[a.ID] = a
	}
	return byID
}

func failedSteps(a appStatus) []string {
	var failed []string
	for _, s := range a.Steps {
		if s.Status == stepstatus.StepFail {
			failed = append(failed, s.ID)
		}
	}
	return failed
}

func TestAFailingLinkMakesItsConsumerIncompleteNotItsTarget(t *testing.T) {
	e := newEnv(t, arr.Sonarr(), qbittorrent.App{})
	accept := false
	e.Sonarr.AcceptDownloadClient = func(string, int, string, string) bool { return accept }

	r := e.Run("install", "sonarr", "qbittorrent", "--yes", "--json")

	if r.Code != 2 || r.StepEvent("sonarr", "link-qbittorrent") != "step.fail" {
		t.Fatalf("exit %d, the Link failure belongs to Sonarr\n%s", r.Code, r.Out)
	}
	if !strings.Contains(r.Out, "self-host setup sonarr") || strings.Contains(r.Out, "self-host setup qbittorrent") {
		t.Fatalf("the hint must name the consuming App only:\n%s", r.Out)
	}
	apps := appsStatus(t, e.Run("status", "--json").Out)
	if apps["sonarr"].Setup != stepstatus.SetupIncomplete || strings.Join(failedSteps(apps["sonarr"]), ",") != "link-qbittorrent" {
		t.Fatalf("sonarr should be incomplete because of its Link: %+v", apps["sonarr"])
	}
	if apps["qbittorrent"].Setup != stepstatus.SetupOK {
		t.Fatalf("qbittorrent's own Setup succeeded: %+v", apps["qbittorrent"])
	}

	accept = true
	retry := e.Run("setup", "qbittorrent", "--json")

	if retry.Code != 0 || len(e.Sonarr.DownloadClients()) != 1 {
		t.Fatalf("rerunning the target's Setup must retry the Link (exit %d)\n%s", retry.Code, retry.Out)
	}
	if apps := appsStatus(t, e.Run("status", "--json").Out); apps["sonarr"].Setup != stepstatus.SetupOK {
		t.Fatalf("sonarr should be ok once its Link works: %+v", apps["sonarr"])
	}
}

func TestRerunningTheConsumerRetriesItsFailedLink(t *testing.T) {
	e := newEnv(t, arr.Sonarr(), qbittorrent.App{})
	accept := false
	e.Sonarr.AcceptDownloadClient = func(string, int, string, string) bool { return accept }
	e.Run("install", "qbittorrent", "sonarr", "--yes")

	accept = true
	r := e.Run("setup", "sonarr", "--json")

	if r.Code != 0 || r.StepEvent("sonarr", "link-qbittorrent") != "step.ok" {
		t.Fatalf("exit %d\n%s", r.Code, r.Out)
	}
}

func TestALinkToAnUninstalledTargetIsNotScheduled(t *testing.T) {
	e := newEnv(t, arr.Sonarr(), qbittorrent.App{})

	r := e.Run("install", "sonarr", "--yes", "--json")

	step := r.Step("sonarr", "link-qbittorrent")
	if r.Code != 0 || step != nil {
		t.Fatalf("exit %d, an absent target must not schedule its Link\n%s", r.Code, r.Out)
	}
}

func TestAFailedUnlinkIsReportedAndKeptVisible(t *testing.T) {
	e := newEnv(t, arr.Sonarr(), qbittorrent.App{})
	e.Run("install", "sonarr", "qbittorrent", "--yes")
	e.Sonarr.FailDeletes = true

	r := e.Run("remove", "qbittorrent", "--yes", "--json")

	if r.Code != 2 || r.StepEvent("sonarr", "unlink-qbittorrent") != "step.fail" {
		t.Fatalf("exit %d, a failed unlink must surface\n%s", r.Code, r.Out)
	}
	apps := appsStatus(t, e.Run("status", "--json").Out)
	if _, still := apps["qbittorrent"]; still {
		t.Fatal("qbittorrent should still be removed")
	}
	if strings.Join(failedSteps(apps["sonarr"]), ",") != "unlink-qbittorrent" {
		t.Fatalf("sonarr should keep the failed unlink visible: %+v", apps["sonarr"])
	}
}

func TestAUsersOwnQBittorrentClientIsLeftAlone(t *testing.T) {
	e := newEnv(t, arr.Sonarr(), qbittorrent.App{})
	e.Sonarr.SeedDownloadClient(map[string]any{"name": "NAS qBittorrent", "implementation": "QBittorrent",
		"fields": []any{map[string]any{"name": "host", "value": "nas.local"}}})

	e.Run("install", "sonarr", "qbittorrent", "--yes")
	if got := len(e.Sonarr.DownloadClients()); got != 2 {
		t.Fatalf("download clients = %d, want the user's and ours", got)
	}
	e.Run("remove", "qbittorrent", "--yes")

	clients := e.Sonarr.DownloadClients()
	if len(clients) != 1 || clients[0]["name"] != "NAS qBittorrent" {
		t.Fatalf("the user's client must survive: %v", clients)
	}
}

type secretMap map[string]string

func (s secretMap) Get(key string) string       { return s[key] }
func (s secretMap) Set(key, value string) error { s[key] = value; return nil }

func TestProwlarrReachesItsTargetAtTheTargetsContainerPort(t *testing.T) {
	prowlarr := arrtest.NewArr("prowlarr")
	server := httptest.NewServer(prowlarr.Handler())
	t.Cleanup(server.Close)
	secrets := secretMap{"PROWLARR_API_KEY": prowlarr.Key, "SONARR_API_KEY": "sonarr-key"}
	deps := systemtest.NewDeps(t)
	from := helpers.New(helpers.Config{
		App: "prowlarr", Service: "prowlarr", ContainerPort: 19696, BaseURL: server.URL, URL: server.URL,
		HTTP: server.Client(), Secrets: secrets, Log: events.Discard(), Now: deps.Now, Sleep: deps.Sleep,
	})
	to := helpers.New(helpers.Config{App: "sonarr", Service: "sonarr", ContainerPort: 18989, Port: 8989, Secrets: secrets, Log: events.Discard()})
	var link app.Link
	for _, l := range arr.Prowlarr().Links() {
		if l.Target == "sonarr" {
			link = l
		}
	}

	if err := link.Apply(context.Background(), from, to); err != nil {
		t.Fatalf("apply: %v", err)
	}

	applications := prowlarr.Applications()
	if len(applications) != 1 || arrtest.Field(applications[0], "baseUrl") != "http://sonarr:18989" || arrtest.Field(applications[0], "prowlarrUrl") != "http://prowlarr:19696" {
		t.Fatalf("applications %v, want Prowlarr at http://prowlarr:19696 syncing to http://sonarr:18989", applications)
	}
}
