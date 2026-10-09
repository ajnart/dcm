package tracearr_test

import (
	_ "embed"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"

	"github.com/ajnart/self-host/internal/app"
	"github.com/ajnart/self-host/internal/apps/tracearr"
	"go.yaml.in/yaml/v3"
)

type timescaleService struct {
	Image       string
	User        string
	Entrypoint  []string
	Command     []string
	Volumes     []string
	Environment map[string]string
}

// Exact public functions from the tested image; OS/database operations are mocked.
//
//go:embed testdata/timescale-a461-bootstrap.sh
var timescaleVendorBootstrap string

const timescaleBootstrapFixture = `
set -e
id() { printf '%s\n' "$FIXTURE_UID"; }
chmod() { :; }
mkdir() { test "$2" = /var/run/postgresql || test "$2" = "$PGDATA"; }
find() {
  case "$1" in
    "$PGDATA") printf '1000\n' > "$FIXTURE_OWNER" ;;
    /var/run/postgresql) : ;;
    *) return 1 ;;
  esac
}
ls() { test "$1" = /docker-entrypoint-initdb.d/; }
_pg_want_help() { return 1; }
docker_setup_env() {
  DATABASE_ALREADY_EXISTS=''
  if [ -s "$PGDATA/PG_VERSION" ]; then DATABASE_ALREADY_EXISTS=true; fi
}
setup_nss_wrapper() { :; }
docker_verify_minimum_env() { :; }
permission_wait_loop() { test "$(cat "$FIXTURE_OWNER")" = "$FIXTURE_UID"; }
docker_init_database_dir() {
  permission_wait_loop
  printf 'initialized\n' > "$PGDATA/PG_VERSION"
  printf 'init\n' >> "$FIXTURE_TRACE"
}
pg_setup_hba_conf() { :; }
docker_temp_server_start() { :; }
docker_setup_db() { :; }
docker_process_init_files() { :; }
docker_temp_server_stop() { :; }
`

const timescaleGosuFixture = `#!/bin/bash
set -e
test "$1" = postgres
shift
export FIXTURE_UID=1000
exec bash "$@"
`

const timescalePostgresFixture = `#!/bin/bash
set -e
test "$FIXTURE_UID" = 1000
test "$(cat "$FIXTURE_OWNER")" = "$FIXTURE_UID"
printf '%s\n' "$FIXTURE_UID" postgres "$@" >> "$FIXTURE_TRACE"
`

func TestTimescaleBootstrapSupportsMappedBindsAndPreservesDatabase(t *testing.T) {
	svc := renderedTimescale(t)
	uid := "1000" // The pinned image's default postgres user.
	if svc.User == "0:0" {
		uid = "0"
	}
	for _, host := range []struct{ name, owner string }{{"rootless", "0"}, {"rootful", "1000"}} {
		for _, existing := range []bool{false, true} {
			t.Run(host.name+"/existing="+map[bool]string{false: "false", true: "true"}[existing], func(t *testing.T) {
				dir := t.TempDir()
				script := filepath.Join(dir, "entrypoint.sh")
				owner := filepath.Join(dir, "owner")
				trace := filepath.Join(dir, "trace")
				version := filepath.Join(dir, "PG_VERSION")
				for path, contents := range map[string]string{script: timescaleBootstrapFixture + timescaleVendorBootstrap + "\n_main \"$@\"\n", owner: host.owner} {
					if err := os.WriteFile(path, []byte(contents), 0600); err != nil {
						t.Fatal(err)
					}
				}
				if existing {
					if err := os.WriteFile(version, []byte("preserved-existing-database"), 0600); err != nil {
						t.Fatal(err)
					}
				}
				for name, contents := range map[string]string{"gosu": timescaleGosuFixture, "postgres": timescalePostgresFixture} {
					if err := os.WriteFile(filepath.Join(dir, name), []byte(contents), 0700); err != nil {
						t.Fatal(err)
					}
				}
				cmd := exec.Command("bash", append([]string{script}, svc.Command...)...)
				cmd.Env = append(os.Environ(), "FIXTURE_UID="+uid, "FIXTURE_OWNER="+owner, "FIXTURE_TRACE="+trace, "PGDATA="+dir, "PATH="+dir+":"+os.Getenv("PATH"), "POSTGRES_PASSWORD=synthetic-unused")
				if out, err := cmd.CombinedOutput(); err != nil {
					t.Fatalf("official ownership bootstrap failed: %v: %s", err, out)
				}
				got, err := os.ReadFile(trace)
				if err != nil {
					t.Fatal(err)
				}
				if !strings.Contains(string(got), "1000\n"+strings.Join(svc.Command, "\n")) {
					t.Fatal("postgres privilege drop or command arguments changed")
				}
				if existing {
					contents, err := os.ReadFile(version)
					if err != nil || string(contents) != "preserved-existing-database" || strings.Contains(string(got), "init\n") {
						t.Fatal("existing database was initialized or changed")
					}
				} else if !strings.Contains(string(got), "init\n") {
					t.Fatal("fresh database was not initialized")
				}
			})
		}
	}
}

func renderedTimescale(t *testing.T) timescaleService {
	t.Helper()
	var compose struct {
		Services map[string]timescaleService
	}
	if err := yaml.Unmarshal([]byte((tracearr.App{}).Compose(app.RenderContext{Port: 18321})), &compose); err != nil {
		t.Fatal(err)
	}
	return compose.Services["tracearr-timescale"]
}

func TestTimescaleUsesOfficialRootOwnershipBootstrap(t *testing.T) {
	svc := renderedTimescale(t)
	if svc.User != "0:0" {
		t.Fatal("Timescale must enter the pinned root ownership preparation before dropping to postgres")
	}
	if svc.Image != "timescale/timescaledb-ha:pg18.4-ts2.29.1" || len(svc.Entrypoint) != 0 || len(svc.Command) == 0 || svc.Command[0] != "postgres" {
		t.Fatal("Timescale official image entrypoint and postgres command must be preserved")
	}
	if len(svc.Volumes) != 1 || svc.Volumes[0] != "./database:/home/postgres/pgdata/data" || svc.Environment["POSTGRES_PASSWORD"] != "${TRACEARR_DB_PASSWORD}" {
		t.Fatal("existing data path and secret reference must be preserved")
	}
}
