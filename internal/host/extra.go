package host

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/ajnart/self-host/internal/system"
)

const Skipped Level = "skipped"

type ResourceRequirements struct {
	BaseDiskBytes, DiskBytesPerApp     uint64
	BaseMemoryBytes, MemoryBytesPerApp uint64
	MinimumCPUs                        int
	MinimumInotifyWatches              uint64
	MinimumOpenFiles                   uint64
}

var Requirements = ResourceRequirements{
	BaseDiskBytes: 5 << 30, DiskBytesPerApp: 2 << 30,
	BaseMemoryBytes: 1 << 30, MemoryBytesPerApp: 256 << 20,
	MinimumCPUs: 2, MinimumInotifyWatches: 524288, MinimumOpenFiles: 1048576,
}

const (
	registryHost = "ghcr.io"
	registryURL  = "https://ghcr.io/v2/"
	releaseHost  = "github.com"
	releaseURL   = "https://github.com/ajnart/self-host/releases/latest"
)

func Extra(ctx context.Context, deps *system.Deps, projectPath string, apps int) []Check {
	checks := commonPortChecks(deps)
	checks = append(checks, composeVersionCheck(ctx, deps))
	dockerRoot, dockerDiskReason := localDockerRoot(ctx, deps)
	checks = append(checks, diskCheck(deps, "disk-project", "Project disk space", projectPath, apps))
	if dockerRoot == "" {
		checks = append(checks, skipped("disk-docker", "Docker disk space", dockerDiskReason))
	} else {
		checks = append(checks, diskCheck(deps, "disk-docker", "Docker disk space", dockerRoot, apps))
	}
	checks = append(checks, resourceChecks(deps, apps)...)
	checks = append(checks, fileSystemCheck(deps, projectPath))
	checks = append(checks, dnsCheck(ctx, deps, "dns-registry", "Registry DNS", registryHost))
	checks = append(checks, dnsCheck(ctx, deps, "dns-release", "Release host DNS", releaseHost))
	checks = append(checks, httpsCheck(ctx, deps, "https-registry", "Registry HTTPS", registryURL))
	checks = append(checks, httpsCheck(ctx, deps, "https-release", "Release host HTTPS", releaseURL))
	checks = append(checks, clockCheck(ctx, deps, releaseURL))
	checks = append(checks, dockerResourceChecks(ctx, deps)...)
	return checks
}

func composeVersionCheck(ctx context.Context, deps *system.Deps) Check {
	result, err := deps.Runner.Run(ctx, system.Cmd{Name: "docker", Args: []string{"compose", "version", "--short"}})
	if err != nil || result.ExitCode != 0 {
		return Check{ID: "compose-version", Title: "Docker Compose version", Level: Warn, Detail: "version is unavailable"}
	}
	version := strings.TrimSpace(string(result.Stdout))
	return Check{ID: "compose-version", Title: "Docker Compose version", Level: OK, Detail: version}
}

func commonPortChecks(deps *system.Deps) []Check {
	const port = 53
	level, detail := OK, "available on IPv4 and IPv6"
	if !PortAvailable(ProbePort(deps, port)) {
		level, detail = Warn, "cannot be published on every supported address"
	}
	return []Check{{ID: "port-" + strconv.Itoa(port), Title: fmt.Sprintf("Port %d", port), Level: level, Detail: detail}}
}

func diskSpace(deps *system.Deps, path string, apps int) (available, required uint64, err error) {
	usage, err := deps.DiskUsage(path)
	required = Requirements.BaseDiskBytes + uint64(max(apps, 0))*Requirements.DiskBytesPerApp
	return usage.AvailableBytes, required, err
}

func diskCheck(deps *system.Deps, id, title, path string, apps int) Check {
	if path == "" {
		return skipped(id, title, "path is unavailable")
	}
	available, required, err := diskSpace(deps, path, apps)
	if err != nil {
		return Check{ID: id, Title: title, Level: Warn, Detail: "could not read available space: " + err.Error()}
	}
	level := OK
	if available < required {
		level = Warn
	}
	return Check{ID: id, Title: title, Level: level, Detail: fmt.Sprintf("%d GiB available; %d GiB recommended", available>>30, required>>30)}
}

func resourceChecks(deps *system.Deps, apps int) []Check {
	var checks []Check
	resources, resourceErr := deps.MachineResources()
	required := Requirements.BaseMemoryBytes + uint64(max(apps, 0))*Requirements.MemoryBytesPerApp
	if resourceErr != nil || resources.MemoryBytes == 0 {
		reason := "memory inventory is unavailable"
		if resourceErr != nil {
			reason = resourceErr.Error()
		}
		checks = append(checks, skipped("memory", "Memory", reason))
	} else {
		memoryLevel := OK
		if resources.MemoryBytes < required {
			memoryLevel = Warn
		}
		source := resources.MemorySource
		if source == "" {
			source = "effective memory"
		}
		checks = append(checks, Check{ID: "memory", Title: "Memory", Level: memoryLevel,
			Detail: fmt.Sprintf("%d MiB from %s; %d MiB recommended", resources.MemoryBytes>>20, source, required>>20)})
	}
	if resources.CPUs < 1 {
		checks = append(checks, skipped("cpu", "Processors", "processor inventory is unavailable"))
	} else {
		cpuLevel := OK
		if resources.CPUs < Requirements.MinimumCPUs {
			cpuLevel = Warn
		}
		checks = append(checks, Check{ID: "cpu", Title: "Processors", Level: cpuLevel,
			Detail: fmt.Sprintf("%d available; %d recommended", resources.CPUs, Requirements.MinimumCPUs)})
	}
	limits, err := deps.FileLimits()
	if err != nil {
		return append(checks, skipped("file-limits", "File limits", err.Error()))
	}
	level := OK
	if limits.InotifyWatches < Requirements.MinimumInotifyWatches || limits.OpenFiles < Requirements.MinimumOpenFiles {
		level = Warn
	}
	return append(checks, Check{ID: "file-limits", Title: "File limits", Level: level, Detail: fmt.Sprintf("inotify watches %d; open files %d", limits.InotifyWatches, limits.OpenFiles)})
}

func fileSystemCheck(deps *system.Deps, path string) Check {
	if path == "" {
		return skipped("filesystem", "Project filesystem", "filesystem probe is unavailable")
	}
	fs, err := deps.FileSystem(path)
	if err != nil {
		return Check{ID: "filesystem", Title: "Project filesystem", Level: Warn, Detail: err.Error()}
	}
	level, sensitivity := OK, "case-sensitive"
	if !fs.CaseSensitive {
		level, sensitivity = Warn, "case-insensitive"
	}
	return Check{ID: "filesystem", Title: "Project filesystem", Level: level, Detail: fs.Type + ", " + sensitivity}
}

func dnsCheck(ctx context.Context, deps *system.Deps, id, title, name string) Check {
	addresses, err := deps.Resolver.LookupHost(ctx, name)
	if err != nil || len(addresses) == 0 {
		return Check{ID: id, Title: title, Level: Warn, Detail: "could not resolve " + name}
	}
	return Check{ID: id, Title: title, Level: OK, Detail: name + " resolves"}
}

func httpsCheck(ctx context.Context, deps *system.Deps, id, title, address string) Check {
	req, err := http.NewRequestWithContext(ctx, http.MethodHead, address, nil)
	if err != nil {
		return Check{ID: id, Title: title, Level: Warn, Detail: err.Error()}
	}
	response, err := deps.HTTP.Do(req)
	if err != nil {
		return Check{ID: id, Title: title, Level: Warn, Detail: err.Error()}
	}
	response.Body.Close()
	return Check{ID: id, Title: title, Level: OK, Detail: "connected with HTTP " + strconv.Itoa(response.StatusCode)}
}

func clockCheck(ctx context.Context, deps *system.Deps, address string) Check {
	req, _ := http.NewRequestWithContext(ctx, http.MethodHead, address, nil)
	response, err := deps.HTTP.Do(req)
	if err != nil {
		return skipped("clock", "Clock", "release host time is unavailable")
	}
	response.Body.Close()
	remote, err := http.ParseTime(response.Header.Get("Date"))
	if err != nil {
		return skipped("clock", "Clock", "release host did not provide its time")
	}
	delta := deps.Now().Sub(remote)
	if delta < 0 {
		delta = -delta
	}
	level := OK
	if delta > 5*time.Minute {
		level = Warn
	}
	return Check{ID: "clock", Title: "Clock", Level: level, Detail: "differs from release host by " + delta.Round(time.Second).String()}
}

func localDockerRoot(ctx context.Context, deps *system.Deps) (string, string) {
	endpoint, err := ActiveDockerEndpoint(ctx, deps)
	if err != nil {
		return "", "Docker endpoint could not be verified as local"
	}
	if deps.GOOS != "linux" || endpoint.Kind != "unix" {
		return "", "Docker data belongs to a remote host or virtual machine"
	}
	result, err := deps.Runner.Run(ctx, system.Cmd{Name: "docker", Args: []string{
		"info", "--format", `{{json .DockerRootDir}} {{json .OperatingSystem}}`,
	}})
	if err != nil || result.ExitCode != 0 {
		return "", "Docker data path is unavailable"
	}
	decoder := json.NewDecoder(strings.NewReader(string(result.Stdout)))
	var root, operatingSystem string
	if decoder.Decode(&root) != nil || decoder.Decode(&operatingSystem) != nil || operatingSystem == "" {
		return "", "Docker daemon identity is unavailable"
	}
	identity := strings.ToLower(operatingSystem)
	for _, virtual := range []string{"docker desktop", "orbstack", "rancher desktop", "colima"} {
		if strings.Contains(identity, virtual) {
			return "", "Docker data belongs to a virtual machine"
		}
	}
	if root == "" || !deps.PathExists(root) {
		return "", "Docker data path is not mapped on this machine"
	}
	return root, ""
}

func dockerResourceChecks(ctx context.Context, deps *system.Deps) []Check {
	name := fmt.Sprintf("self-host-doctor-%d-%d", deps.PID, deps.Now().UnixNano())
	return []Check{
		dockerResourceCheck(ctx, deps, "network", name),
		dockerResourceCheck(ctx, deps, "volume", name),
	}
}

func dockerResourceCheck(ctx context.Context, deps *system.Deps, kind, name string) Check {
	title := "Temporary Docker " + kind
	created, err := deps.Runner.Run(ctx, system.Cmd{Name: "docker", Args: []string{kind, "create", name}})
	if err != nil || created.ExitCode != 0 {
		detail := firstLine(string(created.Stderr))
		if detail == "" && err != nil {
			detail = err.Error()
		}
		return Check{ID: "docker-" + kind, Title: title, Level: Warn, Detail: detail}
	}
	removed, removeErr := deps.Runner.Run(context.WithoutCancel(ctx), system.Cmd{Name: "docker", Args: []string{kind, "rm", name}})
	if removeErr != nil || removed.ExitCode != 0 {
		return Check{ID: "docker-" + kind, Title: title, Level: Fail, Detail: "created the uniquely named " + kind + " but could not remove it"}
	}
	return Check{ID: "docker-" + kind, Title: title, Level: OK, Detail: "created and removed a uniquely named " + kind}
}

func skipped(id, title, detail string) Check {
	return Check{ID: id, Title: title, Level: Skipped, Detail: detail}
}
