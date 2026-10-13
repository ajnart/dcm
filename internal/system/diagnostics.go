package system

import (
	"bufio"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
)

func machineResources() (MachineResources, error) {
	resources := MachineResources{CPUs: runtime.NumCPU()}
	if runtime.GOOS != "linux" {
		return resources, fmt.Errorf("memory inventory unsupported on %s", runtime.GOOS)
	}
	file, err := os.Open("/proc/meminfo")
	if err != nil {
		return resources, err
	}
	defer file.Close()
	scanner := bufio.NewScanner(file)
	for scanner.Scan() {
		fields := strings.Fields(scanner.Text())
		if len(fields) == 3 && fields[0] == "MemTotal:" {
			kb, parseErr := strconv.ParseUint(fields[1], 10, 64)
			if parseErr != nil {
				return resources, parseErr
			}
			resources.MemoryBytes = kb * 1024
			return resources, nil
		}
	}
	return resources, fmt.Errorf("MemTotal unavailable")
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
