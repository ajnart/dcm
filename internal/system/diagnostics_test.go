package system

import (
	"fmt"
	"testing"
)

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
