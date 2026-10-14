//go:build darwin

package system

import "syscall"

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
