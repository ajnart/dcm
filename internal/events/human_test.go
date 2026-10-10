package events

import (
	"bytes"
	"testing"
)

func TestHumanPrintsPlainPullLines(t *testing.T) {
	var out bytes.Buffer
	sink := Human(&out, false)
	for _, e := range []Event{
		{Event: RunStart, Msg: "install sonarr"},
		{Event: StepStart, App: "sonarr", Step: "pull", Msg: "pull 2 images"},
		{Event: StepStart, Step: "pull", Msg: "pull 2 images"},
		{Event: PullProgress, Image: "lscr.io/linuxserver/sonarr:latest", Layer: "a", Status: "Downloading", Current: 50_000_000, Total: 100_000_000},
		{Event: PullProgress, Image: "redis:7", Layer: "b", Status: "Downloading", Current: 1_000, Total: 0},
		{Event: PullProgress, Image: "redis:7", Status: "Pulled"},
		{Event: PullProgress, Image: "lscr.io/linuxserver/sonarr:latest", Layer: "a", Status: "Extracting", Current: 100_000_000, Total: 100_000_000},
		{Event: PullProgress, Image: "lscr.io/linuxserver/sonarr:latest", Status: "Pulled"},
		{Event: StepOK, App: "sonarr", Step: "pull", Msg: "pulled sonarr"},
		{Event: StepOK, Step: "pull", Msg: "pulled sonarr"},
		{Event: RunEnd, Msg: "done"},
	} {
		sink.Emit(e)
	}
	want := "▶ install sonarr\n" +
		"✓ pulled redis:7\n" +
		"✓ pulled lscr.io/linuxserver/sonarr:latest\n" +
		"  ✓ sonarr › pull pulled sonarr\n" +
		"  ✓ pull pulled sonarr\n" +
		"■ done\n"
	if out.String() != want {
		t.Fatalf("plain output =\n%q\nwant\n%q", out.String(), want)
	}
}
