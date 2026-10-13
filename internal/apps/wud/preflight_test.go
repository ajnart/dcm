package wud_test

import (
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/ajnart/self-host/internal/app"
	"github.com/ajnart/self-host/internal/apps/wud"
	"github.com/ajnart/self-host/internal/backup"
	"github.com/ajnart/self-host/internal/catalog"
	"github.com/ajnart/self-host/internal/clitest"
	"github.com/ajnart/self-host/internal/systemtest"
)

func TestInstallRejectsTLSBeforeComposeOrFragment(t *testing.T) {
	for _, name := range []string{"missing", "external symlink", "external App directory", "external Apps directory"} {
		t.Run(name, func(t *testing.T) {
			deps := systemtest.NewDeps(t)
			root := clitest.Root(t, deps)
			dir := filepath.Join(root, "apps", "wud")
			if name == "external symlink" {
				writeTLSFixture(t, dir, false)
				external := t.TempDir()
				writeTLSFixture(t, external, false)
				os.Remove(filepath.Join(dir, "tls", "ca.pem"))
				if err := os.Symlink(filepath.Join(external, "tls", "ca.pem"), filepath.Join(dir, "tls", "ca.pem")); err != nil {
					t.Fatal(err)
				}
			}
			if name == "external App directory" {
				external := t.TempDir()
				writeTLSFixture(t, external, false)
				if err := os.MkdirAll(filepath.Dir(dir), 0o700); err != nil {
					t.Fatal(err)
				}
				if err := os.Symlink(external, dir); err != nil {
					t.Fatal(err)
				}
			}
			if name == "external Apps directory" {
				external := t.TempDir()
				writeTLSFixture(t, filepath.Join(external, "wud"), false)
				if err := os.MkdirAll(root, 0o700); err != nil {
					t.Fatal(err)
				}
				if err := os.Symlink(external, filepath.Join(root, "apps")); err != nil {
					t.Fatal(err)
				}
			}
			deps.HTTP = &http.Client{Transport: &handlerTransport{handler: installHandler()}}
			cat := catalog.New([]app.App{wud.App{}}, nil)
			r := clitest.Run(t, deps, cat, "install", "wud", "--yes", "--set", "wud.WUD_DOCKER_HOST=docker.internal")
			if r.Code == 0 {
				t.Fatal("unsafe TLS prerequisite passed install")
			}
			for _, cmd := range deps.Runner.(*systemtest.Runner).Cmds() {
				if strings.Contains(systemtest.Line(cmd), "docker compose") {
					t.Fatalf("install ran %s before validating TLS binds", systemtest.Line(cmd))
				}
			}
			if _, err := os.Stat(filepath.Join(dir, "compose.yml")); !os.IsNotExist(err) {
				t.Fatal("install rendered fragment before validating TLS binds")
			}
		})
	}
}

func TestLifecycleRejectsTLSBeforeCompose(t *testing.T) {
	for _, command := range []string{"start", "restart", "update"} {
		t.Run(command, func(t *testing.T) {
			deps := systemtest.NewDeps(t)
			dir := filepath.Join(clitest.Root(t, deps), "apps", "wud")
			writeTLSFixture(t, dir, false)
			deps.HTTP = &http.Client{Transport: &handlerTransport{handler: installHandler()}}
			cat := catalog.New([]app.App{wud.App{}}, nil)
			if r := clitest.Run(t, deps, cat, "install", "wud", "--yes", "--set", "wud.WUD_DOCKER_HOST=docker.internal"); r.Code != 0 {
				t.Fatal("valid fixture install failed: " + r.Out)
			}
			if err := os.Remove(filepath.Join(dir, "tls", "ca.pem")); err != nil {
				t.Fatal(err)
			}
			runner := deps.Runner.(*systemtest.Runner)
			before := len(runner.Cmds())
			if r := clitest.Run(t, deps, cat, command, "wud"); r.Code == 0 {
				t.Fatal("lifecycle accepted missing TLS")
			}
			for _, cmd := range runner.Cmds()[before:] {
				if strings.Contains(systemtest.Line(cmd), "docker compose") {
					t.Fatal("lifecycle ran Compose before TLS preflight")
				}
			}
		})
	}
}

func installHandler() http.Handler {
	var adminPassword string
	var reader struct {
		ID       string `json:"id"`
		Username string `json:"username"`
		Role     string `json:"role"`
		Provider string `json:"provider"`
	}
	var readerPassword string
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		user, password, ok := r.BasicAuth()
		if !ok || password == "" {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		if user == "admin" && adminPassword == "" {
			adminPassword = password
		}
		admin := user == "admin" && password == adminPassword
		if !admin && (reader.Username == "" || user != reader.Username || password != readerPassword) {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		if r.URL.Path == "/auth/user" {
			if admin {
				json.NewEncoder(w).Encode(map[string]string{"id": "fixture-admin-id", "username": user, "role": "admin", "provider": "local"})
			} else {
				json.NewEncoder(w).Encode(reader)
			}
			return
		}
		if r.URL.Path == "/api/users" {
			if !admin {
				w.WriteHeader(http.StatusForbidden)
				return
			}
			if r.Method == http.MethodGet {
				users := []any{map[string]string{"id": "fixture-admin-id", "username": user, "role": "admin", "provider": "local"}}
				if reader.Username != "" {
					users = append(users, reader)
				}
				json.NewEncoder(w).Encode(users)
				return
			}
			if r.Method == http.MethodPost {
				var body struct{ Username, Password, Role string }
				if json.NewDecoder(r.Body).Decode(&body) != nil || body.Username != "self-host-homarr" || body.Password == "" || body.Role != "ro" {
					w.WriteHeader(http.StatusBadRequest)
					return
				}
				if reader.Username != "" {
					w.WriteHeader(http.StatusConflict)
					return
				}
				reader.ID, reader.Username, reader.Role, reader.Provider = "fixture-reader-id", body.Username, body.Role, "local"
				readerPassword = body.Password
				w.WriteHeader(http.StatusCreated)
				json.NewEncoder(w).Encode(reader)
				return
			}
			w.WriteHeader(http.StatusMethodNotAllowed)
			return
		}
		if strings.HasSuffix(r.URL.Path, "/watch") {
			if !admin {
				w.WriteHeader(http.StatusForbidden)
				return
			}
			w.Write([]byte(`{"id":"owned-fixture","watcher":"approved","image":{"id":"sha256:owned-image"}}`))
			return
		}
		w.Write([]byte(`[{"id":"owned-fixture","name":"owned-fixture","watcher":"approved","updateAvailable":false,"image":{"id":"sha256:owned-image"}}]`))
	})
}

func TestRestoreRejectsTLSBeforeComposeAndPreservesOriginal(t *testing.T) {
	for _, name := range []string{"missing CA", "symlink CA"} {
		t.Run(name, func(t *testing.T) {
			deps := systemtest.NewDeps(t)
			root := clitest.Root(t, deps)
			dir := filepath.Join(root, "apps", "wud")
			writeTLSFixture(t, dir, false)
			deps.HTTP = &http.Client{Transport: &handlerTransport{handler: installHandler()}}
			cat := catalog.New([]app.App{wud.App{}}, nil)
			if r := clitest.Run(t, deps, cat, "install", "wud", "--yes", "--set", "wud.WUD_DOCKER_HOST=docker.internal"); r.Code != 0 {
				t.Fatal("valid install failed")
			}
			sentinel := filepath.Join(dir, "original-state")
			if err := os.WriteFile(sentinel, []byte("original fixture"), 0o600); err != nil {
				t.Fatal(err)
			}
			source := t.TempDir()
			writeTLSFixture(t, source, false)
			if name == "missing CA" {
				os.Remove(filepath.Join(source, "tls", "ca.pem"))
			} else {
				ca, err := os.ReadFile(filepath.Join(source, "tls", "ca.pem"))
				if err != nil {
					t.Fatal(err)
				}
				os.WriteFile(filepath.Join(source, "ca-alias.pem"), ca, 0o644)
				os.Remove(filepath.Join(source, "tls", "ca.pem"))
				if err := os.Symlink("../ca-alias.pem", filepath.Join(source, "tls", "ca.pem")); err != nil {
					t.Fatal(err)
				}
			}
			compose := (wud.App{}).Compose(app.RenderContext{Port: 18083, Inputs: map[string]string{"WUD_DOCKER_HOST": "docker.internal"}})
			if err := os.WriteFile(filepath.Join(source, "compose.yml"), []byte(compose), 0o600); err != nil {
				t.Fatal(err)
			}
			archive := filepath.Join(t.TempDir(), "invalid-tls.tar.zst")
			f, err := os.Create(archive)
			if err != nil {
				t.Fatal(err)
			}
			writer, err := backup.Create(f, "", backup.Manifest{Version: 1, Apps: []backup.ManifestApp{{ID: "wud"}}})
			if err != nil {
				t.Fatal(err)
			}
			if err = writer.AddBytes("state.json", []byte(clitest.Read(t, filepath.Join(root, "state.json"))), 0o600); err != nil {
				t.Fatal(err)
			}
			if err = writer.AddTree(source, "apps/wud/"); err != nil {
				t.Fatal(err)
			}
			if err = writer.Close(); err != nil {
				t.Fatal(err)
			}
			if err = f.Close(); err != nil {
				t.Fatal(err)
			}
			runner := deps.Runner.(*systemtest.Runner)
			before := len(runner.Cmds())
			if r := clitest.Run(t, deps, cat, "restore", archive, "--yes"); r.Code == 0 {
				t.Fatal("restore accepted invalid TLS archive")
			}
			for _, cmd := range runner.Cmds()[before:] {
				if strings.Contains(systemtest.Line(cmd), "docker compose") {
					t.Fatal("restore ran Compose before checking archived TLS prerequisites")
				}
			}
			if clitest.Read(t, sentinel) != "original fixture" {
				t.Fatal("invalid restore replaced original data")
			}
		})
	}
}
