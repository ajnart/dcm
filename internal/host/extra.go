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

type ExtraCheck struct {
	ID     string `json:"id"`
	Title  string `json:"title"`
	Status Level  `json:"status"`
	Reason string `json:"reason"`
}

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

type ExtraOptions struct {
	ProjectPath               string
	AppCount                  int
	RegistryHost, RegistryURL string
	ReleaseHost, ReleaseURL   string
}

func Extra(ctx context.Context, deps *system.Deps, options ExtraOptions) []ExtraCheck {
	if options.RegistryHost == "" {
		options.RegistryHost = "ghcr.io"
	}
	if options.RegistryURL == "" {
		options.RegistryURL = "https://ghcr.io/v2/"
	}
	if options.ReleaseHost == "" {
		options.ReleaseHost = "github.com"
	}
	if options.ReleaseURL == "" {
		options.ReleaseURL = "https://github.com/ajnart/self-host/releases/latest"
	}
	checks := commonPortChecks(deps)
	checks = append(checks, composeVersionCheck(ctx, deps))
	dockerRoot, dockerDiskReason := localDockerRoot(ctx, deps)
	checks = append(checks, diskCheck(deps, "disk-project", "Project disk space", options.ProjectPath, options.AppCount))
	if dockerRoot == "" {
		checks = append(checks, skipped("disk-docker", "Docker disk space", dockerDiskReason))
	} else {
		checks = append(checks, diskCheck(deps, "disk-docker", "Docker disk space", dockerRoot, options.AppCount))
	}
	checks = append(checks, resourceChecks(deps, options.AppCount)...)
	checks = append(checks, fileSystemCheck(deps, options.ProjectPath))
	checks = append(checks, dnsCheck(ctx, deps, "dns-registry", "Registry DNS", options.RegistryHost))
	checks = append(checks, dnsCheck(ctx, deps, "dns-release", "Release host DNS", options.ReleaseHost))
	checks = append(checks, httpsCheck(ctx, deps, "https-registry", "Registry HTTPS", options.RegistryURL))
	checks = append(checks, httpsCheck(ctx, deps, "https-release", "Release host HTTPS", options.ReleaseURL))
	checks = append(checks, clockCheck(ctx, deps, options.ReleaseURL))
	checks = append(checks, dockerResourceChecks(ctx, deps)...)
	return checks
}

func composeVersionCheck(ctx context.Context, deps *system.Deps) ExtraCheck {
	result, err := deps.Runner.Run(ctx, system.Cmd{Name: "docker", Args: []string{"compose", "version", "--short"}})
	if err != nil || result.ExitCode != 0 {
		return ExtraCheck{ID: "compose-version", Title: "Docker Compose version", Status: Warn, Reason: "version is unavailable"}
	}
	version := strings.TrimSpace(string(result.Stdout))
	return ExtraCheck{ID: "compose-version", Title: "Docker Compose version", Status: OK, Reason: version}
}

func commonPortChecks(deps *system.Deps) []ExtraCheck {
	var checks []ExtraCheck
	for _, port := range []int{53} {
		if deps.BindTCP == nil {
			checks = append(checks, skipped("port-"+strconv.Itoa(port), fmt.Sprintf("Port %d", port), "TCP binding probe is unavailable"))
			continue
		}
		probes := ProbePort(deps, port)
		level, detail := OK, "available on IPv4 and IPv6"
		if !PortAvailable(probes) {
			level, detail = Warn, "cannot be published on every supported address"
		}
		checks = append(checks, ExtraCheck{ID: "port-" + strconv.Itoa(port), Title: fmt.Sprintf("Port %d", port), Status: level, Reason: detail})
	}
	return checks
}

func diskCheck(deps *system.Deps, id, title, path string, apps int) ExtraCheck {
	if deps.DiskUsage == nil || path == "" {
		return skipped(id, title, "path or disk probe is unavailable")
	}
	usage, err := deps.DiskUsage(path)
	if err != nil {
		return ExtraCheck{ID: id, Title: title, Status: Warn, Reason: "could not read available space: " + err.Error()}
	}
	required := Requirements.BaseDiskBytes + uint64(max(apps, 0))*Requirements.DiskBytesPerApp
	level := OK
	if usage.AvailableBytes < required {
		level = Warn
	}
	return ExtraCheck{ID: id, Title: title, Status: level, Reason: fmt.Sprintf("%d GiB available; %d GiB recommended", usage.AvailableBytes>>30, required>>30)}
}

func resourceChecks(deps *system.Deps, apps int) []ExtraCheck {
	var checks []ExtraCheck
	if deps.MachineResources == nil {
		checks = append(checks,
			skipped("memory", "Memory", "resource inventory is unavailable"),
			skipped("cpu", "Processors", "resource inventory is unavailable"))
	} else {
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
			checks = append(checks, ExtraCheck{ID: "memory", Title: "Memory", Status: memoryLevel,
				Reason: fmt.Sprintf("%d MiB from %s; %d MiB recommended", resources.MemoryBytes>>20, source, required>>20)})
		}
		if resources.CPUs < 1 {
			checks = append(checks, skipped("cpu", "Processors", "processor inventory is unavailable"))
		} else {
			cpuLevel := OK
			if resources.CPUs < Requirements.MinimumCPUs {
				cpuLevel = Warn
			}
			checks = append(checks, ExtraCheck{ID: "cpu", Title: "Processors", Status: cpuLevel,
				Reason: fmt.Sprintf("%d available; %d recommended", resources.CPUs, Requirements.MinimumCPUs)})
		}
	}
	if deps.FileLimits == nil {
		return append(checks, skipped("file-limits", "File limits", "kernel limit probe is unavailable"))
	}
	limits, err := deps.FileLimits()
	if err != nil {
		return append(checks, skipped("file-limits", "File limits", err.Error()))
	}
	level := OK
	if limits.InotifyWatches < Requirements.MinimumInotifyWatches || limits.OpenFiles < Requirements.MinimumOpenFiles {
		level = Warn
	}
	return append(checks, ExtraCheck{ID: "file-limits", Title: "File limits", Status: level, Reason: fmt.Sprintf("inotify watches %d; open files %d", limits.InotifyWatches, limits.OpenFiles)})
}

func fileSystemCheck(deps *system.Deps, path string) ExtraCheck {
	if deps.FileSystem == nil || path == "" {
		return skipped("filesystem", "Project filesystem", "filesystem probe is unavailable")
	}
	fs, err := deps.FileSystem(path)
	if err != nil {
		return ExtraCheck{ID: "filesystem", Title: "Project filesystem", Status: Warn, Reason: err.Error()}
	}
	level, sensitivity := OK, "case-sensitive"
	if !fs.CaseSensitive {
		level, sensitivity = Warn, "case-insensitive"
	}
	return ExtraCheck{ID: "filesystem", Title: "Project filesystem", Status: level, Reason: fs.Type + ", " + sensitivity}
}

func dnsCheck(ctx context.Context, deps *system.Deps, id, title, name string) ExtraCheck {
	if deps.Resolver == nil {
		return skipped(id, title, "DNS probe is unavailable")
	}
	addresses, err := deps.Resolver.LookupHost(ctx, name)
	if err != nil || len(addresses) == 0 {
		return ExtraCheck{ID: id, Title: title, Status: Warn, Reason: "could not resolve " + name}
	}
	return ExtraCheck{ID: id, Title: title, Status: OK, Reason: name + " resolves"}
}

func httpsCheck(ctx context.Context, deps *system.Deps, id, title, address string) ExtraCheck {
	if deps.HTTP == nil {
		return skipped(id, title, "HTTPS probe is unavailable")
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodHead, address, nil)
	if err != nil {
		return ExtraCheck{ID: id, Title: title, Status: Warn, Reason: err.Error()}
	}
	response, err := deps.HTTP.Do(req)
	if err != nil {
		return ExtraCheck{ID: id, Title: title, Status: Warn, Reason: err.Error()}
	}
	response.Body.Close()
	return ExtraCheck{ID: id, Title: title, Status: OK, Reason: "connected with HTTP " + strconv.Itoa(response.StatusCode)}
}

func clockCheck(ctx context.Context, deps *system.Deps, address string) ExtraCheck {
	if deps.HTTP == nil {
		return skipped("clock", "Clock", "HTTPS probe is unavailable")
	}
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
	return ExtraCheck{ID: "clock", Title: "Clock", Status: level, Reason: "differs from release host by " + delta.Round(time.Second).String()}
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
	if root == "" || deps.PathExists == nil || !deps.PathExists(root) {
		return "", "Docker data path is not mapped on this machine"
	}
	return root, ""
}

func dockerResourceChecks(ctx context.Context, deps *system.Deps) []ExtraCheck {
	name := fmt.Sprintf("self-host-doctor-%d-%d", deps.PID, deps.Now().UnixNano())
	return []ExtraCheck{
		dockerResourceCheck(ctx, deps, "network", name),
		dockerResourceCheck(ctx, deps, "volume", name),
	}
}

func dockerResourceCheck(ctx context.Context, deps *system.Deps, kind, name string) ExtraCheck {
	title := "Temporary Docker " + kind
	created, err := deps.Runner.Run(ctx, system.Cmd{Name: "docker", Args: []string{kind, "create", name}})
	if err != nil || created.ExitCode != 0 {
		detail := firstLine(string(created.Stderr))
		if detail == "" && err != nil {
			detail = err.Error()
		}
		return ExtraCheck{ID: "docker-" + kind, Title: title, Status: Warn, Reason: detail}
	}
	removed, removeErr := deps.Runner.Run(context.WithoutCancel(ctx), system.Cmd{Name: "docker", Args: []string{kind, "rm", name}})
	if removeErr != nil || removed.ExitCode != 0 {
		return ExtraCheck{ID: "docker-" + kind, Title: title, Status: Fail, Reason: "created the uniquely named " + kind + " but could not remove it"}
	}
	return ExtraCheck{ID: "docker-" + kind, Title: title, Status: OK, Reason: "created and removed a uniquely named " + kind}
}

func skipped(id, title, detail string) ExtraCheck {
	return ExtraCheck{ID: id, Title: title, Status: Skipped, Reason: detail}
}
