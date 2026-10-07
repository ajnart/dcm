package e2e

import (
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestPassboltApplicationMetadataExecutablePrivacy(t *testing.T) {
	php, err := exec.LookPath("php")
	if err != nil {
		t.Skip("PHP executable unavailable for syntax/privacy fixture")
	}
	root := t.TempDir()
	keyring := filepath.Join(root, "keyring")
	if os.Mkdir(keyring, 0700) != nil {
		t.Fatal("owned keyring fixture")
	}
	// Benign synthetic file: the probe may only stat it, never read its payload.
	private := filepath.Join(root, "synthetic-key")
	if os.WriteFile(private, []byte("synthetic-private-payload"), 0600) != nil {
		t.Fatal("owned fixture")
	}
	code := strings.ReplaceAll(passboltApplicationMetadataPHP, "/etc/passbolt/gpg/serverkey_private.asc", private)
	code = strings.ReplaceAll(code, "/var/lib/passbolt/.gnupg", keyring)
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, php, "-d", "display_errors=0", "-d", "log_errors=0", "-r", code)
	cmd.Env = append(os.Environ(), "DATASOURCES_DEFAULT_HOST=unowned.invalid", "DATASOURCES_DEFAULT_DATABASE=passbolt", "DATASOURCES_DEFAULT_USERNAME=passbolt", "DATASOURCES_DEFAULT_PASSWORD=synthetic-password-payload", "APP_FULL_BASE_URL=https://passbolt.e2e.selfhost.test:34567", "PASSBOLT_SSL_FORCE=true")
	output, err := cmd.Output()
	if err != nil {
		t.Fatal("bounded PHP observation failed")
	}
	got := passboltApplicationMetadataReason(0, output)
	if !strings.Contains(got, "private-key-exists=true") || !strings.Contains(got, "private-key-readable=true") || !strings.Contains(got, "datasource=selectors-mismatch") || strings.Contains(got, "synthetic-") || strings.Contains(string(output), "payload") {
		t.Fatal("private payload escaped or unowned DB selector was accepted")
	}
	for _, output := range [][]byte{[]byte(`{}`), []byte(`{"password":"synthetic-password-payload"}`), append(append([]byte{}, output...), []byte(`{}`)...)} {
		if passboltApplicationMetadataReason(0, output) != "owned Passbolt application metadata unobserved: invalid fixed projection" {
			t.Fatal("unknown or incomplete output accepted")
		}
	}
	if passboltApplicationMetadataReason(124, output) != "owned Passbolt application metadata unobserved: probe exited 124" {
		t.Fatal("timeout became observed metadata")
	}
}

func TestPassboltApplicationMetadataWrapperRejectsExpandedAccess(t *testing.T) {
	root := t.TempDir()
	project := filepath.Join(root, "project")
	real := filepath.Join(root, "fake-docker")
	if os.WriteFile(real, []byte("#!/bin/sh\nexit 0\n"), 0700) != nil {
		t.Fatal("fake executor")
	}
	wrapper, err := writePassboltDockerWrapper(root, project, "owned-passbolt", real, filepath.Join(root, "override.yml"))
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	prefix := []string{"compose", "--project-directory", project, "-p", "owned-passbolt", "exec", "-T", "--user", "www-data", "passbolt", "php", "-d", "display_errors=0", "-d", "log_errors=0", "-r"}
	if exec.CommandContext(ctx, wrapper, append(append([]string{}, prefix...), passboltApplicationMetadataPHP)...).Run() != nil {
		t.Fatal("exact fixed application metadata denied")
	}
	for _, code := range []string{`echo getenv("DATASOURCES_DEFAULT_PASSWORD");`, passboltApplicationMetadataPHP + `echo file_get_contents("/etc/passbolt/gpg/serverkey_private.asc");`, strings.ReplaceAll(passboltApplicationMetadataPHP, "mysql:host=db;", "mysql:host=unowned.invalid;"), strings.ReplaceAll(passboltApplicationMetadataPHP, "SELECT 1", "DELETE FROM users")} {
		if exec.CommandContext(ctx, wrapper, append(append([]string{}, prefix...), code)...).Run() == nil {
			t.Fatal("expanded key/env/network/write access allowed")
		}
	}
	wrongUser := append([]string{}, prefix...)
	wrongUser[8] = "root"
	if exec.CommandContext(ctx, wrapper, append(wrongUser, passboltApplicationMetadataPHP)...).Run() == nil {
		t.Fatal("metadata probe allowed root user")
	}
}
