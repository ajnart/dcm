//go:build linux || darwin

package system

import "syscall"

func diskUsage(path string) (DiskUsage, error) {
	var stat syscall.Statfs_t
	if err := syscall.Statfs(existingPath(path), &stat); err != nil {
		return DiskUsage{}, err
	}
	return DiskUsage{AvailableBytes: stat.Bavail * uint64(stat.Bsize)}, nil
}
