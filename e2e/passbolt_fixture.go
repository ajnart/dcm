package e2e

import (
	"crypto/sha256"
	"crypto/x509"
	"encoding/json"
	"encoding/pem"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strconv"
	"strings"

	"github.com/ajnart/self-host/e2e/passboltfixture"
	"go.yaml.in/yaml/v3"
)

// These assets belong to the harness root, outside the backed-up project.
// A restored project reuses the same certificate, canonical name and port.
type passboltFixtureFiles struct {
	dir       string
	origin    string
	caFile    string
	port      int
	helperSHA string
}

const passboltFixtureImage = "docker.io/library/alpine@sha256:5291449c3df73caf6ed85e649dec1b9e818b39a5d8c871e97afc13e9cd5e8fa8"

func writePassboltFixture(root, binary string, port int) (*passboltFixtureFiles, error) {
	if !filepath.IsAbs(root) || !filepath.IsAbs(binary) || port < 1 || port > 65535 {
		return nil, errors.New("invalid owned Passbolt fixture selectors")
	}
	dir := filepath.Join(root, "passbolt-prerequisites")
	if err := os.Mkdir(dir, 0700); err != nil {
		return nil, err
	}
	certificate, ca, err := passboltfixture.Certificate()
	if err != nil {
		return nil, err
	}
	key, err := x509.MarshalPKCS8PrivateKey(certificate.PrivateKey)
	if err != nil {
		return nil, err
	}
	var chain []byte
	for _, der := range certificate.Certificate {
		chain = append(chain, pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: der})...)
	}
	for name, data := range map[string][]byte{"server.pem": chain, "server.key": pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: key}), "ca.pem": ca} {
		mode := os.FileMode(0600)
		// The CA is public trust material and must be readable by Passbolt's www-data.
		if name == "ca.pem" {
			mode = 0644
		}
		if err := os.WriteFile(filepath.Join(dir, name), data, mode); err != nil {
			return nil, err
		}
	}
	if err := os.WriteFile(filepath.Join(dir, "fpm-metadata.php"), []byte(passboltFPMMetadataPHP), 0644); err != nil {
		return nil, err
	}
	source, err := os.Open(binary)
	if err != nil {
		return nil, err
	}
	defer source.Close()
	target, err := os.OpenFile(filepath.Join(dir, "helper"), os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0700)
	if err != nil {
		return nil, err
	}
	hash := sha256.New()
	written, copyErr := io.Copy(io.MultiWriter(target, hash), io.LimitReader(source, (64<<20)+1))
	closeErr := target.Close()
	if copyErr != nil || closeErr != nil || written > 64<<20 {
		return nil, errors.New("copy owned Passbolt helper")
	}
	return &passboltFixtureFiles{dir: dir, origin: "https://passbolt.e2e.selfhost.test:" + strconv.Itoa(port), caFile: filepath.Join(dir, "ca.pem"), port: port, helperSHA: fmt.Sprintf("%x", hash.Sum(nil))}, nil
}

func (f *passboltFixtureFiles) compose() (string, error) {
	// No SMTP publication, host gateway, socket, remote relay or trust bypass.
	document := map[string]any{"services": map[string]any{
		"passbolt-prerequisites": map[string]any{
			"image":      passboltFixtureImage,
			"entrypoint": []string{"/fixture/helper"},
			"command":    []string{"-https", ":" + strconv.Itoa(f.port), "-smtp", ":1025", "-backend", "http://passbolt:80"},
			"read_only":  true, "user": "0:0", "restart": "unless-stopped",
			"cap_drop": []string{"ALL"}, "security_opt": []string{"no-new-privileges:true"},
			"mem_limit": "64m", "cpus": 0.25, "pids_limit": 32,
			"volumes":  []any{map[string]any{"type": "bind", "source": f.dir, "target": "/fixture", "read_only": true}},
			"ports":    []string{fmt.Sprintf("127.0.0.1:%d:%d", f.port, f.port)},
			"networks": map[string]any{"default": map[string]any{"aliases": []string{"passbolt.e2e.selfhost.test", "smtp.e2e.selfhost.test"}}},
		},
		"passbolt": map[string]any{
			"depends_on": []string{"passbolt-prerequisites"},
			"environment": map[string]string{
				"PASSBOLT_PLUGINS_SMTP_SETTINGS_SECURITY_SSL_CAFILE":            "/fixture-ca.pem",
				"PASSBOLT_PLUGINS_SMTP_SETTINGS_SECURITY_SSL_VERIFY_PEER":       "true",
				"PASSBOLT_PLUGINS_SMTP_SETTINGS_SECURITY_SSL_VERIFY_PEER_NAME":  "true",
				"PASSBOLT_PLUGINS_SMTP_SETTINGS_SECURITY_SSL_ALLOW_SELF_SIGNED": "false",
			},
			"volumes": []any{
				map[string]any{"type": "bind", "source": f.caFile, "target": "/fixture-ca.pem", "read_only": true},
				map[string]any{"type": "bind", "source": filepath.Join(f.dir, "fpm-metadata.php"), "target": "/usr/share/php/passbolt/webroot/selfhost-fpm-metadata.php", "read_only": true},
			},
		},
	}}
	data, err := yaml.Marshal(document)
	return string(data), err
}

func (f *passboltFixtureFiles) inputs() []string {
	return []string{"--set", "passbolt.PASSBOLT_CANONICAL_ORIGIN=" + f.origin, "--set", "passbolt.PASSBOLT_SMTP_HOST=smtp.e2e.selfhost.test", "--set", "passbolt.PASSBOLT_SMTP_PORT=1025", "--set", "passbolt.PASSBOLT_FROM_EMAIL=fixture@selfhost.local", "--set", "passbolt.PASSBOLT_SERVER_KEY_EMAIL=fixture@selfhost.local"}
}

const passboltSMTPCommand = ". /etc/environment && bin/cake passbolt send_test_email fixture@selfhost.local"

func writePassboltDockerWrapper(root, project, name, real, override string) (string, error) {
	if !filepath.IsAbs(project) || !filepath.IsAbs(real) || !filepath.IsAbs(override) {
		return "", errors.New("invalid owned Passbolt selectors")
	}
	bin := filepath.Join(root, "passbolt-bin")
	if err := os.MkdirAll(bin, 0700); err != nil {
		return "", err
	}
	config, _ := json.Marshal(map[string]string{"project": project, "name": name, "real": real, "override": override, "registry": filepath.Join(root, "passbolt-backup-helper-names")})
	guard := strings.ReplaceAll(netBirdDockerGuard, "NetBird", "Passbolt")
	guard = strings.ReplaceAll(guard, "netbird", "passbolt")
	guard = strings.Replace(guard, "'images','logs')", "'images','logs','exec')", 1)
	guard = strings.Replace(guard, "    a=['compose']+out+", "    if a[i]=='exec' and a[i:] not in (['exec','-T','passbolt','su','-s','/bin/bash','-c',"+fmt.Sprintf("%q", passboltSMTPCommand)+",'www-data'],['exec','-T','passbolt','sh','-c',"+fmt.Sprintf("%q", passboltMetadataCommand)+"],['exec','-T','--user','www-data','passbolt','php','-d','display_errors=0','-d','log_errors=0','-r',"+fmt.Sprintf("%q", passboltApplicationMetadataPHP)+"],['exec','-T','--user','www-data','passbolt','php','-d','display_errors=0','-d','log_errors=0','-r',"+fmt.Sprintf("%q", passboltEffectiveMetadataPHP)+"]): deny()\n    a=['compose']+out+", 1)
	script := "#!/usr/bin/env python3\nimport csv,json,os,re,sys\nc=json.loads(" + fmt.Sprintf("%q", string(config)) + ")\n" + guard
	wrapper := filepath.Join(bin, "docker")
	if err := os.WriteFile(wrapper, []byte(script), 0700); err != nil {
		return "", err
	}
	return wrapper, nil
}

const ownedPassboltProject = "owned-passbolt"

func composeExec(project, name string, envFiles []string, argv ...string) []string {
	args := []string{"compose", "--project-directory", project, "-p", name}
	for _, file := range envFiles {
		args = append(args, "--env-file", file)
	}
	args = append(args, "exec", "-T")
	return append(args, argv...)
}
