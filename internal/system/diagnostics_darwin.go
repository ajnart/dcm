//go:build darwin

package system

import "syscall"

func diskUsage(path string) (DiskUsage, error) {
	var stat syscall.Statfs_t
	if err := syscall.Statfs(existingPath(path), &stat); err != nil {
		return DiskUsage{}, err
	}
	return DiskUsage{AvailableBytes: stat.Bavail * uint64(stat.Bsize)}, nil
}

func fileSystemType(path string) string {
	var stat syscall.Statfs_t
	if syscall.Statfs(path, &stat) != nil {
		return "unknown"
	}
	name := make([]byte, 0, len(stat.Fstypename))
	for _, char := range stat.Fstypename {
		if char == 0 {
			break
		}
		name = append(name, byte(char))
	}
	return string(name)
}
