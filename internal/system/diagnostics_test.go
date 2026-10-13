package system

import (
	"fmt"
	"path/filepath"
	"testing"
)

func TestDiskUsageChecksTheFilesystemForAFutureProjectFolder(t *testing.T) {
	parent := t.TempDir()
	if got := existingPath(filepath.Join(parent, ".self-host", "apps")); got != parent {
		t.Fatalf("existing path = %q, want %q", got, parent)
	}
}

func TestMachineResourcesUsesEffectiveCgroupMemoryLimit(t *testing.T) {
	tests := []struct {
		name   string
		files  map[string]string
		memory uint64
		source string
	}{
		{
			name: "cgroup v2",
			files: map[string]string{
				"/proc/meminfo":             "MemTotal:       67108864 kB\n",
				"/sys/fs/cgroup/memory.max": "536870912\n",
			},
			memory: 512 << 20,
			source: "cgroup v2 limit",
		},
		{
			name: "cgroup v1",
			files: map[string]string{
				"/proc/meminfo": "MemTotal:       16777216 kB\n",
				"/sys/fs/cgroup/memory/memory.limit_in_bytes": "805306368\n",
			},
			memory: 768 << 20,
			source: "cgroup v1 limit",
		},
		{
			name: "unlimited cgroup",
			files: map[string]string{
				"/proc/meminfo":             "MemTotal:       8388608 kB\n",
				"/sys/fs/cgroup/memory.max": "max\n",
			},
			memory: 8 << 30,
			source: "host memory",
		},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			read := func(path string) ([]byte, error) {
				value, found := tc.files[path]
				if !found {
					return nil, fmt.Errorf("missing fixture %s", path)
				}
				return []byte(value), nil
			}
			resources, err := machineResourcesFrom(read, 4)
			if err != nil {
				t.Fatal(err)
			}
			if resources.MemoryBytes != tc.memory || resources.MemorySource != tc.source || resources.CPUs != 4 {
				t.Fatalf("resources = %+v", resources)
			}
		})
	}
}

func TestMachineResourcesUsesNestedProcessCgroupAndAncestorLimits(t *testing.T) {
	files := map[string]string{
		"/proc/meminfo":                                        "MemTotal:       67108864 kB\n",
		"/proc/self/cgroup":                                    "0::/user.slice/user-1000.slice/session-4.scope\n",
		"/proc/self/mountinfo":                                 "29 23 0:26 / /sys/fs/cgroup rw,nosuid,nodev,noexec,relatime - cgroup2 cgroup rw\n",
		"/sys/fs/cgroup/memory.max":                            "max\n",
		"/sys/fs/cgroup/user.slice/memory.max":                 "1073741824\n",
		"/sys/fs/cgroup/user.slice/user-1000.slice/memory.max": "805306368\n",
		"/sys/fs/cgroup/user.slice/user-1000.slice/session-4.scope/memory.max": "536870912\n",
	}
	read := func(path string) ([]byte, error) {
		value, found := files[path]
		if !found {
			return nil, fmt.Errorf("missing fixture %s", path)
		}
		return []byte(value), nil
	}
	resources, err := machineResourcesFrom(read, 8)
	if err != nil {
		t.Fatal(err)
	}
	if resources.MemoryBytes != 512<<20 || resources.MemorySource != "cgroup v2 limit" {
		t.Fatalf("resources = %+v", resources)
	}
}

func TestMachineResourcesUsesV1ProcessCgroupAncestorLimit(t *testing.T) {
	files := map[string]string{
		"/proc/meminfo":                               "MemTotal:       67108864 kB\n",
		"/proc/self/cgroup":                           "7:cpu,cpuacct:/work\n6:memory:/docker/child\n",
		"/proc/self/mountinfo":                        "31 23 0:28 /docker /sys/fs/cgroup/memory rw,relatime - cgroup cgroup rw,memory\n",
		"/sys/fs/cgroup/memory/memory.limit_in_bytes": "536870912\n",
	}
	read := func(path string) ([]byte, error) {
		value, found := files[path]
		if !found {
			return nil, fmt.Errorf("missing fixture %s", path)
		}
		return []byte(value), nil
	}
	resources, err := machineResourcesFrom(read, 8)
	if err != nil {
		t.Fatal(err)
	}
	if resources.MemoryBytes != 512<<20 || resources.MemorySource != "cgroup v1 limit" {
		t.Fatalf("resources = %+v", resources)
	}
}
