package service

import (
	"bytes"
	"context"
	"encoding/json"
	"runtime"
	"strconv"
	"strings"
	"time"

	"github.com/ajnart/self-host/internal/system"
)

// ContainerUsage is one running container's load. CPU is the fraction of the
// whole machine (all cores) in use and Mem the fraction of its memory limit,
// which is the machine's memory when the container has none; both are 0 to 1.
type ContainerUsage struct {
	Service  string
	CPU      float64
	Mem      float64
	MemBytes uint64
}

const usagePause = time.Second

// Usage reports the load of the Project's running containers to emit until ctx
// ends. Each round pauses a second after `docker stats` returns, so the
// interval is that pause plus Docker's own time. It polls `docker stats
// --no-stream` instead of following one stream: Docker redraws a followed
// stream with terminal escape codes and keeps measuring the containers it
// started with, while each poll names the Project's current containers.
func (s *Service) Usage(ctx context.Context, emit func([]ContainerUsage)) error {
	ss, err := s.open(ctx)
	if err != nil {
		return err
	}
	cores, memTotal := s.machine(ctx)
	for {
		containers, err := ss.compose.Ps(ctx)
		if err != nil && ctx.Err() != nil {
			return ctx.Err()
		}
		names := map[string]string{}
		args := []string{"stats", "--no-stream", "--format", "{{json .}}"}
		for _, c := range containers {
			if c.State == "running" {
				names[c.Name] = c.Service
				args = append(args, c.Name)
			}
		}
		if err == nil && len(names) > 0 {
			result, err := s.Deps.Runner.Run(ctx, system.Cmd{Name: "docker", Args: args})
			if err == nil && result.ExitCode == 0 {
				emit(parseUsage(result.Stdout, names, cores, memTotal))
			}
		}
		if err := s.Deps.Sleep(ctx, usagePause); err != nil {
			return err
		}
	}
}

// machine is the Docker host's core count and memory in bytes, the scale for
// the bars. Docker Desktop's VM is the machine for its containers.
func (s *Service) machine(ctx context.Context) (cores int, memTotal uint64) {
	cores = runtime.NumCPU()
	result, err := s.Deps.Runner.Run(ctx, system.Cmd{Name: "docker", Args: []string{"info", "--format", "{{.NCPU}} {{.MemTotal}}"}})
	if err != nil || result.ExitCode != 0 {
		return cores, 0
	}
	fields := strings.Fields(string(result.Stdout))
	if len(fields) != 2 {
		return cores, 0
	}
	if n, err := strconv.Atoi(fields[0]); err == nil && n > 0 {
		cores = n
	}
	if n, err := strconv.ParseUint(fields[1], 10, 64); err == nil {
		memTotal = n
	}
	return cores, memTotal
}

type statsLine struct {
	Name     string `json:"Name"`
	CPUPerc  string `json:"CPUPerc"`
	MemUsage string `json:"MemUsage"`
}

// parseUsage reads `docker stats --format '{{json .}}'` lines for the
// containers in services (container name → Compose service). A limit above
// the machine's memory, which Docker reports for an unlimited container on
// some hosts, counts as the machine's memory. Lines it cannot read are skipped.
func parseUsage(out []byte, services map[string]string, cores int, memTotal uint64) []ContainerUsage {
	var usage []ContainerUsage
	for _, line := range bytes.Split(out, []byte("\n")) {
		start := bytes.IndexByte(line, '{')
		if start < 0 {
			continue
		}
		var l statsLine
		if json.Unmarshal(line[start:], &l) != nil {
			continue
		}
		service, ok := services[l.Name]
		if !ok {
			continue
		}
		cpu, err := strconv.ParseFloat(strings.TrimSuffix(l.CPUPerc, "%"), 64)
		if err != nil {
			continue
		}
		used, limit, ok := parseMemUsage(l.MemUsage)
		if !ok {
			continue
		}
		if memTotal > 0 && (limit == 0 || limit > memTotal) {
			limit = memTotal
		}
		u := ContainerUsage{Service: service, CPU: cpu / (100 * float64(max(cores, 1))), MemBytes: uint64(used)}
		if limit > 0 {
			u.Mem = used / float64(limit)
		}
		usage = append(usage, u)
	}
	return usage
}

// parseMemUsage reads "512MiB / 1.9GiB" as bytes used and the limit.
func parseMemUsage(s string) (used float64, limit uint64, ok bool) {
	usedText, limitText, found := strings.Cut(s, "/")
	if !found {
		return 0, 0, false
	}
	used, ok = parseBytes(usedText)
	if !ok {
		return 0, 0, false
	}
	total, ok := parseBytes(limitText)
	return used, uint64(total), ok
}

var byteUnits = []struct {
	suffix string
	size   float64
}{
	{"TiB", 1 << 40}, {"GiB", 1 << 30}, {"MiB", 1 << 20}, {"KiB", 1 << 10},
	{"TB", 1e12}, {"GB", 1e9}, {"MB", 1e6}, {"kB", 1e3}, {"B", 1},
}

func parseBytes(s string) (float64, bool) {
	s = strings.TrimSpace(s)
	for _, unit := range byteUnits {
		if number, found := strings.CutSuffix(s, unit.suffix); found {
			n, err := strconv.ParseFloat(strings.TrimSpace(number), 64)
			return n * unit.size, err == nil
		}
	}
	return 0, false
}
