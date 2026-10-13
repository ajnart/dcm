package system

import (
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
)

func existingPath(path string) string {
	for path != "" {
		if _, err := os.Stat(path); err == nil || !os.IsNotExist(err) {
			return path
		}
		parent := filepath.Dir(path)
		if parent == path {
			return path
		}
		path = parent
	}
	return path
}

func pathExists(path string) bool {
	_, err := os.Stat(path)
	return err == nil
}
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
	limits := memoryLimitPaths(readFile)
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

type memoryLimitPath struct {
	path   string
	source string
}

func memoryLimitPaths(readFile func(string) ([]byte, error)) []memoryLimitPath {
	cgroups, cgroupErr := readFile("/proc/self/cgroup")
	mounts, mountErr := readFile("/proc/self/mountinfo")
	if cgroupErr != nil || mountErr != nil {
		return rootMemoryLimitPaths()
	}
	v2Path, v1Path := processCgroupPaths(string(cgroups))
	var paths []memoryLimitPath
	for _, line := range strings.Split(string(mounts), "\n") {
		left, right, found := strings.Cut(line, " - ")
		if !found {
			continue
		}
		leftFields, rightFields := strings.Fields(left), strings.Fields(right)
		if len(leftFields) < 5 || len(rightFields) < 3 {
			continue
		}
		fsType := rightFields[0]
		if fsType == "cgroup2" && v2Path != "" {
			paths = append(paths, ancestorLimitPaths(leftFields[3], leftFields[4], v2Path, "memory.max", "cgroup v2 limit")...)
		}
		if fsType == "cgroup" && v1Path != "" && strings.Contains(","+rightFields[2]+",", ",memory,") {
			paths = append(paths, ancestorLimitPaths(leftFields[3], leftFields[4], v1Path, "memory.limit_in_bytes", "cgroup v1 limit")...)
		}
	}
	if len(paths) > 0 {
		return paths
	}
	return rootMemoryLimitPaths()
}

func processCgroupPaths(body string) (v2, v1 string) {
	for _, line := range strings.Split(body, "\n") {
		parts := strings.SplitN(line, ":", 3)
		if len(parts) != 3 {
			continue
		}
		if parts[0] == "0" && parts[1] == "" {
			v2 = parts[2]
		}
		for _, controller := range strings.Split(parts[1], ",") {
			if controller == "memory" {
				v1 = parts[2]
			}
		}
	}
	return v2, v1
}

func ancestorLimitPaths(mountRoot, mountPoint, processPath, file, source string) []memoryLimitPath {
	mountRoot = filepath.Clean(mountRoot)
	processPath = filepath.Clean(processPath)
	relative, err := filepath.Rel(mountRoot, processPath)
	if err != nil || relative == ".." || strings.HasPrefix(relative, ".."+string(filepath.Separator)) {
		return nil
	}
	dir := filepath.Join(mountPoint, relative)
	stop := filepath.Clean(mountPoint)
	var paths []memoryLimitPath
	for {
		paths = append(paths, memoryLimitPath{path: filepath.Join(dir, file), source: source})
		if dir == stop {
			break
		}
		parent := filepath.Dir(dir)
		if parent == dir || parent == "." || !strings.HasPrefix(parent+string(filepath.Separator), stop+string(filepath.Separator)) {
			break
		}
		dir = parent
	}
	return paths
}

func rootMemoryLimitPaths() []memoryLimitPath {
	return []memoryLimitPath{
		{path: "/sys/fs/cgroup/memory.max", source: "cgroup v2 limit"},
		{path: "/sys/fs/cgroup/memory/memory.limit_in_bytes", source: "cgroup v1 limit"},
	}
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
