package service

import (
	"math"
	"testing"
)

func TestParseUsageScalesCPUToTheMachineAndMemoryToItsLimit(t *testing.T) {
	out := []byte(`{"Name":"proj-jellyfin-1","CPUPerc":"200.00%","MemUsage":"512MiB / 2GiB"}
{"Name":"proj-sonarr-1","CPUPerc":"0.50%","MemUsage":"96.5MiB / 15.6GiB"}
{"Name":"proj-qbit-1","CPUPerc":"1.00%","MemUsage":"1GiB / 64GiB"}
{"Name":"other-1","CPUPerc":"9.00%","MemUsage":"1MiB / 2MiB"}
{"Name":"proj-idle-1","CPUPerc":"--","MemUsage":"-- / --"}
`)
	names := map[string]string{
		"proj-jellyfin-1": "jellyfin", "proj-sonarr-1": "sonarr", "proj-qbit-1": "qbittorrent", "proj-idle-1": "idle",
	}

	got := parseUsage(out, names, 4, 8<<30)

	want := []ContainerUsage{
		{Service: "jellyfin", CPU: 0.5, Mem: 0.25, MemBytes: 512 << 20},
		{Service: "sonarr", CPU: 0.00125, Mem: 96.5 / 8192, MemBytes: 101187584},
		{Service: "qbittorrent", CPU: 0.0025, Mem: 0.125, MemBytes: 1 << 30},
	}
	if len(got) != len(want) {
		t.Fatalf("got %d containers, want %d: %+v", len(got), len(want), got)
	}
	for i, w := range want {
		g := got[i]
		if g.Service != w.Service || g.MemBytes != w.MemBytes || math.Abs(g.CPU-w.CPU) > 1e-9 || math.Abs(g.Mem-w.Mem) > 1e-9 {
			t.Errorf("container %d: got %+v, want %+v", i, g, w)
		}
	}
}

func TestParseUsageSkipsLinesItCannotRead(t *testing.T) {
	out := []byte("\x1b[2J\x1b[H{\"Name\":\"p-a-1\",\"CPUPerc\":\"1.00%\",\"MemUsage\":\"10MiB / 1GiB\"}\nnot json\n")

	got := parseUsage(out, map[string]string{"p-a-1": "a"}, 1, 1<<30)

	if len(got) != 1 || got[0].Service != "a" {
		t.Fatalf("got %+v", got)
	}
}
