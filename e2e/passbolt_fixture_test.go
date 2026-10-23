package e2e

import (
	"crypto/x509"
	"encoding/json"
	"encoding/pem"
	"net"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"

	"go.yaml.in/yaml/v3"
)

func TestPassboltFixturePreservesTrustAndOwnsOnlyLocalPrerequisites(t *testing.T) {
	root := t.TempDir()
	binary := filepath.Join(root, "compiled-helper")
	if err := os.WriteFile(binary, []byte("synthetic binary fixture"), 0700); err != nil {
		t.Fatal(err)
	}
	fixture, err := writePassboltFixture(root, binary, 34567)
	if err != nil {
		t.Fatal(err)
	}
	fixture.user = "1000:1001"
	before, err := os.ReadFile(fixture.caFile)
	if err != nil {
		t.Fatal(err)
	}
	source, err := fixture.compose()
	if err != nil {
		t.Fatal(err)
	}
	again, err := fixture.compose()
	if err != nil || source != again {
		t.Fatal("restored project cannot reattach identical fixture")
	}
	after, _ := os.ReadFile(fixture.caFile)
	if string(after) != string(before) {
		t.Fatal("restore preparation replaced fixture trust")
	}
	var doc struct {
		Services map[string]struct {
			Image       string
			User        string
			Ports       []string
			Environment map[string]string
			Volumes     []struct {
				Source   string
				Target   string
				ReadOnly bool `yaml:"read_only"`
			}
			Networks map[string]struct{ Aliases []string }
		}
	}
	if err := yaml.Unmarshal([]byte(source), &doc); err != nil {
		t.Fatal(err)
	}
	prerequisites := doc.Services["passbolt-prerequisites"]
	if len(doc.Services) != 2 || prerequisites.Image != passboltFixtureImage || prerequisites.User != fixture.user || len(prerequisites.Ports) != 1 || prerequisites.Ports[0] != "127.0.0.1:34567:34567" {
		t.Fatal("fixture scope/image/publication differs")
	}
	app := doc.Services["passbolt"]
	if len(app.Ports) != 0 || app.Environment["PASSBOLT_PLUGINS_SMTP_SETTINGS_SECURITY_SSL_VERIFY_PEER"] != "true" || app.Environment["PASSBOLT_PLUGINS_SMTP_SETTINGS_SECURITY_SSL_VERIFY_PEER_NAME"] != "true" || app.Environment["PASSBOLT_PLUGINS_SMTP_SETTINGS_SECURITY_SSL_ALLOW_SELF_SIGNED"] != "false" {
		t.Fatal("fixture changed App exposure or bypassed TLS trust")
	}
	for _, service := range doc.Services {
		for _, mount := range service.Volumes {
			if !mount.ReadOnly || !strings.HasPrefix(mount.Source, fixture.dir+string(os.PathSeparator)) && mount.Source != fixture.dir {
				t.Fatal("fixture mounted outside its owned assets")
			}
		}
	}
	block, _ := pem.Decode(before)
	ca, err := x509.ParseCertificate(block.Bytes)
	if err != nil || !ca.IsCA {
		t.Fatal("invalid fixture CA")
	}
	leafPEM, _ := os.ReadFile(filepath.Join(fixture.dir, "server.pem"))
	block, _ = pem.Decode(leafPEM)
	leaf, err := x509.ParseCertificate(block.Bytes)
	if err != nil || leaf.VerifyHostname("passbolt.e2e.selfhost.test") != nil || leaf.VerifyHostname("smtp.e2e.selfhost.test") != nil {
		t.Fatal("stable prerequisite hostnames missing from certificate")
	}
	keyInfo, err := os.Stat(filepath.Join(fixture.dir, "server.key"))
	if err != nil || keyInfo.Mode().Perm() != 0600 {
		t.Fatal("fixture key is not private")
	}
	if fixture.origin != "https://passbolt.e2e.selfhost.test:34567" || !strings.Contains(strings.Join(fixture.inputs(), " "), "PASSBOLT_SMTP_HOST=smtp.e2e.selfhost.test") {
		t.Fatal("approved App inputs do not select owned fixture")
	}
}

func TestFixtureConnectRejectsInvalidRouteSelectors(t *testing.T) {
	for _, tc := range []struct{ authority, target string }{
		{"other.e2e.selfhost.test:443", "127.0.0.1:443"},
		{"passbolt.e2e.selfhost.test:0", "127.0.0.1:443"},
		{"passbolt.e2e.selfhost.test:443/path", "127.0.0.1:443"},
		{"owner@passbolt.e2e.selfhost.test:443", "127.0.0.1:443"},
		{"passbolt.e2e.selfhost.test:443", "192.0.2.1:443"},
		{"passbolt.e2e.selfhost.test:443", "localhost:443"},
	} {
		listener, err := net.Listen("tcp4", "127.0.0.1:0")
		if err != nil {
			t.Fatal(err)
		}
		route, err := newFixtureConnect(listener, tc.authority, tc.target)
		if err == nil {
			route.close()
			t.Fatal("invalid fixture route selector accepted")
		}
		if _, err := listener.Accept(); err == nil {
			t.Fatal("rejected selector leaked listener")
		}
	}
}

func TestPassboltWrapperAllowsOnlyOwnedComposeAndLocalSMTPProbe(t *testing.T) {
	root := t.TempDir()
	project := filepath.Join(root, "project")
	real := filepath.Join(root, "fake-docker")
	if err := os.WriteFile(real, []byte("#!/usr/bin/env python3\nimport json,sys\nprint(json.dumps(sys.argv[1:]))\n"), 0700); err != nil {
		t.Fatal(err)
	}
	override := filepath.Join(root, "passbolt-override.yml")
	wrapper, err := writePassboltDockerWrapper(root, project, ownedPassboltProject, real, override)
	if err != nil {
		t.Fatal(err)
	}
	prefix := []string{"compose", "--project-directory", project, "-p", ownedPassboltProject, "--env-file", filepath.Join(project, ".env")}
	probe := []string{"exec", "-T", "passbolt", "su", "-s", "/bin/bash", "-c", passboltSMTPCommand, "www-data"}
	for _, suffix := range [][]string{{"up", "-d"}, probe} {
		args := append(append([]string{}, prefix...), suffix...)
		output, err := exec.Command(wrapper, args...).Output()
		if err != nil {
			t.Fatal("owned fixture operation rejected")
		}
		var got []string
		if json.Unmarshal(output, &got) != nil {
			t.Fatal("invalid fixture output")
		}
		if !strings.Contains(strings.Join(got, "|"), "-f|"+filepath.Join(project, "compose.yml")+"|-f|"+override) {
			t.Fatal("fixture override was not attached")
		}
	}
	for _, args := range [][]string{
		{"compose", "--project-directory", project, "-p", "unowned", "up", "-d"},
		append(append([]string{}, prefix...), "exec", "-T", "passbolt", "sh", "-c", "arbitrary"),
		append(append([]string{}, prefix...), "exec", "-T", "passbolt", "su", "-s", "/bin/bash", "-c", ". /etc/environment && bin/cake passbolt send_test_email external@example.com", "www-data"),
		{"system", "prune", "-af"},
	} {
		if err := exec.Command(wrapper, args...).Run(); err == nil {
			t.Fatal("unowned selector or SMTP mutation accepted")
		}
	}
}
