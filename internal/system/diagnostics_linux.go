//go:build linux

package system

import (
	"fmt"
	"syscall"
)

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
	names := map[int64]string{
		0x01021994: "tmpfs",
		0x58465342: "xfs",
		0x61756673: "aufs",
		0x794c7630: "overlayfs",
		0x9123683e: "btrfs",
		0xEF53:     "ext",
	}
	if name := names[int64(stat.Type)]; name != "" {
		return name
	}
	return fmt.Sprintf("0x%x", stat.Type)
}
