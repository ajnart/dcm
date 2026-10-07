package passbolt_test

import (
	"context"
	"github.com/ajnart/self-host/internal/app"
	"github.com/ajnart/self-host/internal/apps/passbolt"
	"go.yaml.in/yaml/v3"
	"os"
	"os/exec"
	"path/filepath"
	"slices"
	"strings"
	"testing"
	"time"
)

func TestFreshGPGMountIsWritableBeforeOfficialEntrypoint(t *testing.T) {
	var compose struct {
		Services map[string]struct {
			Command []string
			Volumes []string
		}
	}
	if yaml.Unmarshal([]byte((passbolt.App{}).Compose(app.RenderContext{Port: 18085})), &compose) != nil {
		t.Fatal("invalid compose")
	}
	service := compose.Services["passbolt"]
	if !slices.Equal(service.Command[:min(2, len(service.Command))], []string{"/bin/sh", "-c"}) || len(service.Command) != 3 {
		t.Fatal("fresh bind ownership is not prepared before startup")
	}
	want := "chown www-data:www-data /etc/passbolt/gpg && chmod 0700 /etc/passbolt/gpg && exec /usr/bin/wait-for.sh -t 0 db:3306 -- /docker-entrypoint.sh"
	if service.Command[2] != want {
		t.Fatal("GPG ownership must be scoped to the mounted directory before unchanged official startup")
	}
	if !slices.Contains(service.Volumes, "./gpg:/etc/passbolt/gpg") || !slices.Contains(service.Volumes, "./jwt:/etc/passbolt/jwt") {
		t.Fatal("backup bind paths changed")
	}
	// Parse the actual startup script without executing it or touching a service.
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	command := exec.CommandContext(ctx, "sh", "-n")
	command.Stdin = strings.NewReader(service.Command[2])
	if command.Run() != nil {
		t.Fatal("invalid startup shell syntax")
	}
	if os.Geteuid() == 0 {
		t.Skip("write-access fixture requires an ordinary user; root bypasses file permissions")
	}
	root := t.TempDir()
	gpg := filepath.Join(root, "gpg")
	if os.Mkdir(gpg, 0000) != nil {
		t.Fatal("prepare unwritable fresh bind fixture")
	}
	t.Cleanup(func() { os.Chmod(gpg, 0700) })
	if os.WriteFile(filepath.Join(gpg, "benign-probe"), []byte("fixture"), 0600) == nil {
		t.Fatal("fixture does not reproduce missing service write access")
	}
	// Keep real chmod and shell sequencing. Replace only privileged ownership
	// and the vendor DB/entrypoint with bounded owned fixture executors.
	chown := `#!/bin/sh
set -eu
[ "$#" -eq 2 ] && [ "$1" = www-data:www-data ] && [ "$2" = "$GPG_DIR" ]
touch "$OWNERSHIP_MARKER"
`
	wait := `#!/bin/sh
set -eu
[ "$*" = '-t 0 db:3306 -- /docker-entrypoint.sh' ]
[ -f "$OWNERSHIP_MARKER" ]
[ -w "$GPG_DIR" ]
printf 'benign generated fixture payload' > "$GPG_DIR/generated-fixture"
`
	waitPath := filepath.Join(root, "wait-fixture")
	if os.WriteFile(filepath.Join(root, "chown"), []byte(chown), 0700) != nil || os.WriteFile(waitPath, []byte(wait), 0700) != nil {
		t.Fatal("prepare bounded bootstrap executors")
	}
	script := strings.ReplaceAll(service.Command[2], "/etc/passbolt/gpg", `"$GPG_DIR"`)
	script = strings.Replace(script, "/usr/bin/wait-for.sh", `"$WAIT_FIXTURE"`, 1)
	bootstrap := exec.CommandContext(ctx, service.Command[0], "-c", script)
	bootstrap.Env = append(os.Environ(), "PATH="+root+string(os.PathListSeparator)+os.Getenv("PATH"), "GPG_DIR="+gpg, "WAIT_FIXTURE="+waitPath, "OWNERSHIP_MARKER="+filepath.Join(root, "ownership-set"))
	if bootstrap.Run() != nil {
		t.Fatal("bootstrap did not establish private write access before vendor startup")
	}
	if info, err := os.Stat(gpg); err != nil || info.Mode().Perm() != 0700 {
		t.Fatal("bootstrap did not retain private directory permissions")
	}
	if data, err := os.ReadFile(filepath.Join(gpg, "generated-fixture")); err != nil || string(data) != "benign generated fixture payload" {
		t.Fatal("vendor startup could not write its owned fresh directory")
	}

}
