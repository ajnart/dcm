package arr_test

import (
	"encoding/json"
	"strings"
	"testing"

	"github.com/ajnart/self-host/internal/apps/arr"
	"github.com/ajnart/self-host/internal/apps/qbittorrent"
	stepstatus "github.com/ajnart/self-host/internal/status"
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

func TestALinkWaitingForItsTargetSaysSo(t *testing.T) {
	e := newEnv(t, arr.Sonarr(), qbittorrent.App{})

	r := e.Run("install", "sonarr", "--yes", "--json")

	step := r.Step("sonarr", "link-qbittorrent")
	if r.Code != 0 || step == nil || step["event"] != "step.skip" || !strings.Contains(step["msg"].(string), "waiting for qbittorrent") {
		t.Fatalf("exit %d, want a step.skip waiting for qbittorrent\n%s", r.Code, r.Out)
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
