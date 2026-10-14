//go:build !linux && !darwin

package system

import "fmt"

func diskUsage(string) (DiskUsage, error) {
	return DiskUsage{}, fmt.Errorf("disk inventory unsupported")
}

func fileSystemType(string) string { return "unknown" }
