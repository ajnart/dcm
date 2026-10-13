package system

import (
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
)

func machineResources() (MachineResources, error) {
	if runtime.GOOS != "linux" {
		return MachineResources{CPUs: runtime.NumCPU()}, fmt.Errorf("memory inventory unsupported on %s", runtime.GOOS)
	}
	return machineResourcesFrom(os.ReadFile, runtime.NumCPU())
}

func machineResourcesFrom(readFile func(string) ([]byte, error), cpus int) (MachineResources, error) {
	data, err := readFile("/proc/meminfo")
	if err != nil {
		return MachineResources{CPUs: cpus}, err
	}
	resources := MachineResources{CPUs: cpus, MemorySource: "host memory"}
	for _, line := range strings.Split(string(data), "\n") {
		fields := strings.Fields(line)
		if len(fields) == 3 && fields[0] == "MemTotal:" {
			kb, parseErr := strconv.ParseUint(fields[1], 10, 64)
			if parseErr != nil {
				return resources, parseErr
			}
			resources.MemoryBytes = kb * 1024
			break
		}
	}
	if resources.MemoryBytes == 0 {
		return resources, fmt.Errorf("MemTotal unavailable")
	}
	limits := []struct {
		path   string
		source string
	}{
		{path: "/sys/fs/cgroup/memory.max", source: "cgroup v2 limit"},
		{path: "/sys/fs/cgroup/memory/memory.limit_in_bytes", source: "cgroup v1 limit"},
	}
	for _, candidate := range limits {
		value, readErr := readFile(candidate.path)
		if readErr != nil || strings.TrimSpace(string(value)) == "max" {
			continue
		}
		limit, parseErr := strconv.ParseUint(strings.TrimSpace(string(value)), 10, 64)
		if parseErr == nil && limit < resources.MemoryBytes {
			resources.MemoryBytes = limit
			resources.MemorySource = candidate.source
		}
	}
	return resources, nil
}

func fileLimits() (FileLimits, error) {
	if runtime.GOOS != "linux" {
		return FileLimits{}, fmt.Errorf("kernel limits unsupported on %s", runtime.GOOS)
	}
	read := func(path string) (uint64, error) {
		value, err := os.ReadFile(path)
		if err != nil {
			return 0, err
		}
		return strconv.ParseUint(strings.TrimSpace(string(value)), 10, 64)
	}
	watches, err := read("/proc/sys/fs/inotify/max_user_watches")
	if err != nil {
		return FileLimits{}, err
	}
	files, err := read("/proc/sys/fs/file-max")
	if err != nil {
		return FileLimits{}, err
	}
	return FileLimits{InotifyWatches: watches, OpenFiles: files}, nil
}

func fileSystem(path string) (FileSystem, error) {
	dir, err := os.MkdirTemp(path, ".self-host-doctor-")
	if err != nil {
		return FileSystem{}, err
	}
	defer os.RemoveAll(dir)
	lower := filepath.Join(dir, "case-check")
	if err := os.WriteFile(lower, nil, 0o600); err != nil {
		return FileSystem{}, err
	}
	_, upperErr := os.Stat(filepath.Join(dir, "CASE-CHECK"))
	return FileSystem{Type: fileSystemType(path), CaseSensitive: os.IsNotExist(upperErr)}, nil
}
