package netdata_test

import (
	"os"
	"os/exec"
	"path/filepath"
	"reflect"
	"strings"
	"testing"

	"github.com/ajnart/self-host/internal/app"
	"github.com/ajnart/self-host/internal/apps/netdata"
	"go.yaml.in/yaml/v3"
)

func TestStartupRemovesOnlyProvenStockShortcutAndPreservesArguments(t *testing.T) {
	var adapter app.App = netdata.App{}
	files, ok := adapter.(app.FileDeclarer)
	if !ok {
		t.Fatal("stock configuration shortcut enters persisted backup storage")
	}
	var startup app.File
	for _, file := range files.Files(app.RenderContext{}, nil) {
		if file.Path == "startup.sh" {
			startup = file
		}
	}
	if startup.Content == "" {
		t.Fatal("startup wrapper missing")
	}
	var doc struct {
		Services map[string]struct{ Entrypoint, Volumes []string }
	}
	if err := yaml.Unmarshal([]byte(adapter.Compose(app.RenderContext{Port: 19999})), &doc); err != nil {
		t.Fatal(err)
	}
	svc := doc.Services["netdata"]
	if !reflect.DeepEqual(svc.Entrypoint, []string{"/bin/sh", "/run/selfhost/netdata-start.sh"}) {
		t.Fatal("rendered service does not run the owned wrapper")
	}
	found := false
	for _, mount := range svc.Volumes {
		if mount == "./startup.sh:/run/selfhost/netdata-start.sh:ro" {
			found = true
		}
	}
	if !found {
		t.Fatal("owned startup wrapper is not mounted read-only")
	}
	for _, state := range []string{"fresh", "known-link", "regular", "unknown-link", "single-slash-link"} {
		t.Run(state, func(t *testing.T) {
			root := t.TempDir()
			stock, config := filepath.Join(root, "stock"), filepath.Join(root, "config")
			for _, dir := range []string{stock, config} {
				if err := os.Mkdir(dir, 0o755); err != nil {
					t.Fatal(err)
				}
			}
			if err := os.Symlink("//usr/lib/netdata/conf.d", filepath.Join(stock, "orig")); err != nil {
				t.Fatal(err)
			}
			if err := os.WriteFile(filepath.Join(stock, "netdata.conf"), []byte("stock configuration"), 0o644); err != nil {
				t.Fatal(err)
			}
			if err := os.WriteFile(filepath.Join(config, "netdata.conf"), []byte("custom configuration"), 0o600); err != nil {
				t.Fatal(err)
			}
			orig := filepath.Join(config, "orig")
			target := ""
			switch state {
			case "known-link":
				target = "//usr/lib/netdata/conf.d"
			case "unknown-link":
				target = "/outside/custom-config"
			case "single-slash-link":
				target = "/usr/lib/netdata/conf.d"
			case "regular":
				if err := os.WriteFile(orig, []byte("custom regular file"), 0o600); err != nil {
					t.Fatal(err)
				}
			}
			if target != "" {
				if err := os.Symlink(target, orig); err != nil {
					t.Fatal(err)
				}
			}
			argsFile := filepath.Join(root, "official-args")
			official := filepath.Join(root, "official-start")
			// Model upstream cp-an and record the exact argv handed to its entrypoint.
			body := "#!/bin/sh\nset -eu\nprintf '%s\\n' \"$@\" > '" + argsFile + "'\ncp -an '" + stock + "/.' '" + config + "/'\n"
			if err := os.WriteFile(official, []byte(body), 0o755); err != nil {
				t.Fatal(err)
			}
			script := strings.ReplaceAll(startup.Content, "/etc/netdata.stock", stock)
			script = strings.ReplaceAll(script, "/etc/netdata", config)
			script = strings.ReplaceAll(script, "/usr/sbin/run.sh", official)
			wrapper := filepath.Join(root, "startup.sh")
			if err := os.WriteFile(wrapper, []byte(script), 0o755); err != nil {
				t.Fatal(err)
			}
			for range 2 {
				if output, err := exec.Command("sh", wrapper, "--fixture-option", "two words").CombinedOutput(); err != nil {
					t.Fatalf("startup fixture: %v (%s)", err, output)
				}
			}
			if data, err := os.ReadFile(argsFile); err != nil || string(data) != "--fixture-option\ntwo words\n" {
				t.Fatal("official startup arguments changed")
			}
			if data, err := os.ReadFile(filepath.Join(config, "netdata.conf")); err != nil || string(data) != "custom configuration" {
				t.Fatal("custom configuration changed")
			}
			if _, err := os.Lstat(filepath.Join(stock, "orig")); !os.IsNotExist(err) {
				t.Fatal("image shortcut can be reseeded into config")
			}
			switch state {
			case "fresh", "known-link":
				if _, err := os.Lstat(orig); !os.IsNotExist(err) {
					t.Fatal("known image shortcut persisted")
				}
			case "regular":
				if data, err := os.ReadFile(orig); err != nil || string(data) != "custom regular file" {
					t.Fatal("custom regular file removed")
				}
			default:
				if link, err := os.Readlink(orig); err != nil || link != target {
					t.Fatal("unknown link changed")
				}
			}
		})
	}
}
