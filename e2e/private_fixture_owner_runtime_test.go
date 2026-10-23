//go:build e2e

package e2e

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"syscall"
	"time"
)

func (r *runner) privateFixtureUser(path string) (string, error) {
	info, err := os.Lstat(path)
	if err != nil || !info.IsDir() || info.Mode().Perm() != 0o700 {
		return "", errors.New("private fixture directory must be an owned mode-0700 directory")
	}
	owner, ok := info.Sys().(*syscall.Stat_t)
	if !ok || int(owner.Uid) != os.Geteuid() || int(owner.Gid) != os.Getegid() {
		return "", errors.New("private fixture directory owner differs from the harness")
	}
	output := r.dockerOutput(30*time.Second, "info", "--format", "{{json .SecurityOptions}}")
	var options []string
	if json.Unmarshal([]byte(strings.TrimSpace(output)), &options) != nil {
		return "", errors.New("Docker user namespace could not be determined")
	}
	user, err := privateFixtureContainerUser(options, int(owner.Uid), int(owner.Gid))
	if err != nil || !slices.Contains(options, "name=rootless") {
		return user, err
	}
	dockerRoot := strings.TrimSpace(r.dockerOutput(30*time.Second, "info", "--format", "{{.DockerRootDir}}"))
	if !filepath.IsAbs(dockerRoot) || filepath.Clean(dockerRoot) != dockerRoot {
		return "", errors.New("rootless Docker owner could not be determined")
	}
	rootInfo, err := os.Lstat(dockerRoot)
	if err != nil || !rootInfo.IsDir() {
		return "", errors.New("rootless Docker root could not be inspected")
	}
	daemonOwner, ok := rootInfo.Sys().(*syscall.Stat_t)
	if !ok || daemonOwner.Uid != owner.Uid || daemonOwner.Gid != owner.Gid {
		return "", errors.New("rootless Docker and private fixture owners differ")
	}
	return user, nil
}
