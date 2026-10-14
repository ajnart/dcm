package system

import (
	"os"
	"path/filepath"
	"testing"
)

func dirsFor(goos string, uid int, env map[string]string) userDirs {
	return userDirs{
		goos:    goos,
		getenv:  func(k string) string { return env[k] },
		current: func() (User, error) { return User{Name: "root", Home: "/root", UID: uid}, nil },
		lookup: func(name string) (User, error) {
			return User{Name: name, Home: "/home/" + name, UID: 1000, GID: 1000}, nil
		},
	}
}

func TestSudoDirsFollowInvokingUser(t *testing.T) {
	sudo := map[string]string{"SUDO_USER": "alice", "SUDO_UID": "1001", "SUDO_GID": "1002"}
	tests := []struct {
		goos, config, cache string
	}{
		{"linux", "/home/alice/.config", "/home/alice/.cache"},
		{"darwin", "/home/alice/Library/Application Support", "/home/alice/Library/Caches"},
	}
	for _, tt := range tests {
		d := dirsFor(tt.goos, 0, sudo)
		if got, _ := d.config(); got != tt.config {
			t.Errorf("%s config = %q, want %q", tt.goos, got, tt.config)
		}
		if got, _ := d.cache(); got != tt.cache {
			t.Errorf("%s cache = %q, want %q", tt.goos, got, tt.cache)
		}
	}
}

func TestDirsUnchangedWithoutSudo(t *testing.T) {
	wantConfig, _ := os.UserConfigDir()
	wantCache, _ := os.UserCacheDir()
	for name, d := range map[string]userDirs{
		"plain user":    dirsFor("linux", 1000, map[string]string{"SUDO_USER": "alice"}),
		"root, no sudo": dirsFor("linux", 0, nil),
		"sudo to root":  dirsFor("linux", 0, map[string]string{"SUDO_USER": "root"}),
	} {
		if got, _ := d.config(); got != wantConfig {
			t.Errorf("%s config = %q, want %q", name, got, wantConfig)
		}
		if got, _ := d.cache(); got != wantCache {
			t.Errorf("%s cache = %q, want %q", name, got, wantCache)
		}
	}
	dir := filepath.Join(t.TempDir(), "x")
	if err := dirsFor("linux", 1000, nil).chown(dir); err != nil {
		t.Fatalf("chown outside sudo: %v", err)
	}
}
