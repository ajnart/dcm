package system

import (
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"
)

// ResolveOwner is the user who owns the Project: the invoking user under sudo
// (UID 0 with SUDO_USER set), otherwise the current user.
func ResolveOwner(getenv func(string) string, current func() (User, error), lookup func(string) (User, error)) (User, error) {
	me, err := current()
	if err != nil {
		return User{}, err
	}
	name := getenv("SUDO_USER")
	if me.UID != 0 || name == "" || name == "root" {
		return me, nil
	}
	owner, err := lookup(name)
	if err != nil {
		return User{}, fmt.Errorf("sudo user %s: %w", name, err)
	}
	if uid, err := strconv.Atoi(getenv("SUDO_UID")); err == nil {
		owner.UID = uid
	}
	if gid, err := strconv.Atoi(getenv("SUDO_GID")); err == nil {
		owner.GID = gid
	}
	return owner, nil
}

// Owner is ResolveOwner over these dependencies.
func (d *Deps) Owner() (User, error) {
	return ResolveOwner(d.Getenv, d.CurrentUser, d.LookupUser)
}

// userDirs gives per-user config and cache directories and the hook that hands
// what was created there to its owner. Under sudo they belong to the invoking
// user; otherwise they are the process user's own.
type userDirs struct {
	goos    string
	getenv  func(string) string
	current func() (User, error)
	lookup  func(string) (User, error)
}

func (u userDirs) sudoOwner() (User, bool) {
	me, err := u.current()
	if err != nil || me.UID != 0 {
		return User{}, false
	}
	owner, err := u.Owner()
	if err != nil || owner.UID == 0 || owner.Home == "" {
		return User{}, false
	}
	return owner, true
}

func (u userDirs) Owner() (User, error) { return ResolveOwner(u.getenv, u.current, u.lookup) }

func (u userDirs) config() (string, error) {
	if owner, ok := u.sudoOwner(); ok {
		if u.goos == "darwin" {
			return filepath.Join(owner.Home, "Library", "Application Support"), nil
		}
		return filepath.Join(owner.Home, ".config"), nil
	}
	return os.UserConfigDir()
}

func (u userDirs) cache() (string, error) {
	if owner, ok := u.sudoOwner(); ok {
		if u.goos == "darwin" {
			return filepath.Join(owner.Home, "Library", "Caches"), nil
		}
		return filepath.Join(owner.Home, ".cache"), nil
	}
	return os.UserCacheDir()
}

// chown hands path, and the directories between the owner's home and it, to
// the invoking user. It does nothing outside sudo.
func (u userDirs) chown(path string) error {
	owner, ok := u.sudoOwner()
	if !ok {
		return nil
	}
	home := filepath.Clean(owner.Home)
	for p := filepath.Clean(path); strings.HasPrefix(p, home+string(filepath.Separator)); p = filepath.Dir(p) {
		if err := os.Lchown(p, owner.UID, owner.GID); err != nil && !os.IsNotExist(err) {
			return err
		}
	}
	return nil
}
