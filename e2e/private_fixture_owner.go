package e2e

import (
	"errors"
	"fmt"
	"slices"
	"strings"
)

func privateFixtureContainerUser(options []string, uid, gid int) (string, error) {
	if len(options) == 0 {
		return "", errors.New("Docker user namespace could not be determined")
	}
	for _, option := range options {
		if strings.HasPrefix(option, "name=userns") {
			return "", errors.New("Docker user-namespace remapping is unsupported for private fixtures")
		}
	}
	if slices.Contains(options, "name=rootless") {
		return "0:0", nil
	}
	knownRootful := slices.ContainsFunc(options, func(option string) bool {
		return strings.HasPrefix(option, "name=seccomp") || option == "name=apparmor" || option == "name=cgroupns"
	})
	if !knownRootful {
		return "", errors.New("ordinary rootful Docker security options were not observed")
	}
	return fmt.Sprintf("%d:%d", uid, gid), nil
}
