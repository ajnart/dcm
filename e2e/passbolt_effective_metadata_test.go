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

func TestPassboltEffectiveMetadataExecutablePrivacy(t *testing.T) {
	php, err := exec.LookPath("php")
	if err != nil {
		t.Skip("PHP executable unavailable")
	}
	root := t.TempDir()
	loader := filepath.Join(root, "loader.php")
	fixture := `<?php
namespace Cake\Core { class Configure { static function read($k,$d=null) { return ['passbolt.gpg.serverKey.public'=>'/etc/passbolt/gpg/serverkey.asc','passbolt.gpg.serverKey.fingerprint'=>str_repeat('A',40),'passbolt.originalFullBaseUrl'=>'https://passbolt.e2e.selfhost.test:34567','passbolt.security.fullBaseUrlEnforce'=>true][$k]??$d; } } }
namespace Authentication { interface AuthenticationServiceInterface {} }
namespace App\Authenticator { class SessionAuthenticationService implements \Authentication\AuthenticationServiceInterface {} }
namespace App { class Application { function __construct($p) {} function bootstrap() { echo 'synthetic-bootstrap-secret'; } function pluginBootstrap() {} function getContainer() { return new class { function get($c) { return new \App\Authenticator\SessionAuthenticationService(); } }; } } }
`
	if os.WriteFile(loader, []byte(fixture), 0600) != nil {
		t.Fatal("owned loader")
	}
	code := strings.ReplaceAll(passboltEffectiveMetadataPHP, "/usr/share/php/passbolt/vendor/autoload.php", loader)
	code = strings.ReplaceAll(code, "/usr/share/php/passbolt", root)
	code = strings.ReplaceAll(code, "/etc/passbolt/requirements.php", filepath.Join(root, "requirements.php"))
	if os.WriteFile(filepath.Join(root, "requirements.php"), []byte("<?php"), 0600) != nil {
		t.Fatal("owned requirements fixture")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	run := func(script string) []byte {
		cmd := exec.CommandContext(ctx, php, "-d", "display_errors=0", "-d", "log_errors=0", "-r", script)
		cmd.Env = append(os.Environ(), "APP_FULL_BASE_URL=https://passbolt.e2e.selfhost.test:34567")
		out, err := cmd.Output()
		if err != nil {
			t.Fatal("owned PHP fixture failed")
		}
		return out
	}
	out := run(code)
	got := passboltEffectiveMetadataReason(0, out)
	if !strings.Contains(got, "bootstrap=initialized") || !strings.Contains(got, "configured-public-path-matches=true") || !strings.Contains(got, "canonical-match=true") || !strings.Contains(got, "authentication=session") || strings.Contains(string(out), "synthetic") {
		t.Fatal("effective metadata privacy/initialization failed")
	}
	invalidConfig := strings.Replace(fixture, "'passbolt.originalFullBaseUrl'=>'https://passbolt.e2e.selfhost.test:34567'", "'passbolt.originalFullBaseUrl'=>''", 1)
	invalidConfig = strings.Replace(invalidConfig, "str_repeat('A',40)", "'synthetic-secret-fingerprint'", 1)
	invalidConfig = strings.Replace(invalidConfig, "'/etc/passbolt/gpg/serverkey.asc'", "'/unowned/synthetic-secret-key'", 1)
	if os.WriteFile(loader, []byte(invalidConfig), 0600) != nil {
		t.Fatal("owned invalid config fixture")
	}
	negative := passboltEffectiveMetadataReason(0, run(code))
	if !strings.Contains(negative, "configured-public-path-matches=false") || !strings.Contains(negative, "original-url-present=false") || !strings.Contains(negative, "fingerprint-valid=false") || strings.Contains(negative, "synthetic") {
		t.Fatal("invalid effective conditions were hidden or values escaped")
	}
	// A direct bootstrap write bypassing PHP buffers is rejected by the decoder.
	if os.WriteFile(loader, []byte(strings.Replace(fixture, "echo 'synthetic-bootstrap-secret';", "fwrite(STDOUT, 'synthetic-bootstrap-secret');", 1)), 0600) != nil {
		t.Fatal("owned direct output fixture")
	}
	if passboltEffectiveMetadataReason(0, run(code)) != "owned Passbolt effective metadata unobserved: invalid fixed projection" {
		t.Fatal("direct bootstrap output accepted")
	}
	// Exceptions and premature exits must discard loader text and preserve no observation.
	for _, action := range []string{`throw new \RuntimeException('synthetic-bootstrap-secret');`, `exit(0);`} {
		if os.WriteFile(loader, []byte(strings.Replace(fixture, "echo 'synthetic-bootstrap-secret';", action, 1)), 0600) != nil {
			t.Fatal("owned failing loader")
		}
		output := run(code)
		if passboltEffectiveMetadataReason(0, output) != "owned Passbolt effective metadata unobserved: bootstrap failed" || strings.Contains(string(output), "synthetic") {
			t.Fatal("bootstrap failure exposed payload or inferred initialization")
		}
	}
	if passboltEffectiveMetadataReason(0, []byte(`{"password":"synthetic"}`)) != "owned Passbolt effective metadata unobserved: invalid fixed projection" {
		t.Fatal("unknown projection accepted")
	}
}

func TestPassboltEffectiveMetadataOwnedWrapper(t *testing.T) {
	root := t.TempDir()
	project := filepath.Join(root, "project")
	real := filepath.Join(root, "fake-docker")
	if os.WriteFile(real, []byte("#!/bin/sh\nexit 0\n"), 0700) != nil {
		t.Fatal("owned fake executor")
	}
	wrapper, err := writePassboltDockerWrapper(root, project, ownedPassboltProject, real, filepath.Join(root, "override.yml"))
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	prefix := composeExec(project, ownedPassboltProject, nil, "--user", "www-data", "passbolt", "php", "-d", "display_errors=0", "-d", "log_errors=0", "-r")
	if exec.CommandContext(ctx, wrapper, append(append([]string{}, prefix...), passboltEffectiveMetadataPHP)...).Run() != nil {
		t.Fatal("fixed effective metadata denied")
	}
	for _, code := range []string{passboltEffectiveMetadataPHP + `echo file_get_contents('/etc/passbolt/passbolt.php');`, strings.ReplaceAll(passboltEffectiveMetadataPHP, "/etc/passbolt", "/unowned/config"), passboltEffectiveMetadataPHP + `echo getenv('DATASOURCES_DEFAULT_PASSWORD');`} {
		if exec.CommandContext(ctx, wrapper, append(append([]string{}, prefix...), code)...).Run() == nil {
			t.Fatal("expanded effective config access allowed")
		}
	}
}
