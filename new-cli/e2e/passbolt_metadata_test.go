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

func TestPassboltMetadataPrivacyAndUnobservedBoundary(t *testing.T) {
	good := `{"public_key_exists":true,"www_data_readable":false,"directory_owner":"www-data","directory_group":"www-data","directory_mode":"0700"}`
	if got := passboltMetadataReason(0, []byte(good)); got != "owned Passbolt public-key metadata: exists=true, www-data-readable=false, directory-owner=www-data, directory-group=www-data, directory-mode=0700" {
		t.Fatal("safe observation missing")
	}
	for _, data := range []string{`{}`, `{"public_key_exists":false}`, strings.Replace(good, "0700", "private payload", 1), strings.TrimSuffix(good, "}") + `,"key":"private payload"}`, good + `{}`, strings.Replace(strings.Replace(good, `"public_key_exists":true`, `"public_key_exists":false`, 1), `"www_data_readable":false`, `"www_data_readable":true`, 1)} {
		if got := passboltMetadataReason(0, []byte(data)); got != "owned Passbolt public-key metadata unobserved: invalid fixed projection" || strings.Contains(got, "private payload") {
			t.Fatal("malformed/private metadata accepted")
		}
	}
	if got := passboltMetadataReason(23, []byte(good)); got != "owned Passbolt public-key metadata unobserved: probe exited 23" {
		t.Fatal("failed exec became a false observation")
	}
}
func TestPassboltWrapperAllowsOnlyExactReadOnlyMetadataProbe(t *testing.T) {
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
	prefix := []string{"compose", "--project-directory", project, "-p", "owned-passbolt"}
	exact := []string{"exec", "-T", "passbolt", "sh", "-c", passboltMetadataCommand}
	syntax := exec.CommandContext(ctx, "sh", "-n")
	syntax.Stdin = strings.NewReader(passboltMetadataCommand)
	if syntax.Run() != nil {
		t.Fatal("invalid read-only metadata shell syntax")
	}
	if exec.CommandContext(ctx, wrapper, append(append([]string{}, prefix...), exact...)...).Run() != nil {
		t.Fatal("fixed read-only metadata probe refused")
	}
	for _, command := range []string{"cat /etc/passbolt/gpg/serverkey.asc", "sha256sum /etc/passbolt/gpg/serverkey.asc", passboltMetadataCommand + "\nchmod 0777 /etc/passbolt/gpg", strings.ReplaceAll(passboltMetadataCommand, "serverkey.asc", "serverkey_private.asc"), strings.ReplaceAll(passboltMetadataCommand, "/etc/passbolt/gpg", "/unowned")} {
		args := append(append([]string{}, prefix...), "exec", "-T", "passbolt", "sh", "-c", command)
		if exec.CommandContext(ctx, wrapper, args...).Run() == nil {
			t.Fatal("non-exact metadata/key/mutation command allowed")
		}
	}
}
