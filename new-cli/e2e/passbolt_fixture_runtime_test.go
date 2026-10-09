//go:build e2e

package e2e

import (
	"context"
	"crypto/tls"
	"crypto/x509"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"runtime"
	"slices"
	"strings"
	"time"
)

type passboltRuntimeFixture struct {
	files      *passboltFixtureFiles
	connect    *fixtureConnect
	realDocker string
	override   string
}

func reservePassboltFixturePorts(reservation *portReservation) (net.Listener, net.Listener, error) {
	front, proxy, err := reserveAutheliaFixturePorts(reservation)
	if err != nil {
		return nil, nil, err
	}
	// HTTPS is published by the project-network sidecar. Only its socket lease
	// is released before Compose binds; registry ownership survives both projects.
	reservation.listeners = append(reservation.listeners, front)
	return front, proxy, nil
}

func (r *runner) preparePassboltFixture(reservation *portReservation) {
	if !slices.Contains(r.spec.Apps, "passbolt") {
		return
	}
	fail := func() {
		r.evidence.Outcome = "failed"
		r.evidence.BlockerReason = "owned Passbolt local prerequisites could not be prepared"
		r.saveEvidence()
		r.t.Fatal(r.evidence.BlockerReason)
	}
	front, proxy, err := reservePassboltFixturePorts(reservation)
	if err != nil {
		fail()
		return
	}
	success := false
	defer func() {
		if !success {
			front.Close()
			proxy.Close()
		}
	}()
	root, err := moduleRoot()
	if err != nil {
		fail()
		return
	}
	parent := r.commandCtx
	if parent == nil {
		parent = context.Background()
	}
	ctx, cancel := context.WithTimeout(parent, 2*time.Minute)
	defer cancel()
	binary := filepath.Join(r.root, "passbolt-fixture-helper")
	build := exec.CommandContext(ctx, "go", "build", "-buildvcs=false", "-trimpath", "-o", binary, "./e2e/passboltfixture/cmd")
	build.Dir = root
	for _, entry := range os.Environ() {
		key, _, _ := strings.Cut(entry, "=")
		if key != "CGO_ENABLED" && key != "GOOS" && key != "GOARCH" {
			build.Env = append(build.Env, entry)
		}
	}
	build.Env = append(build.Env, "CGO_ENABLED=0", "GOOS=linux", "GOARCH="+runtime.GOARCH)
	if executeOwnedCommand(ctx, build).code != 0 {
		fail()
		return
	}
	files, err := writePassboltFixture(r.root, binary, front.Addr().(*net.TCPAddr).Port)
	if err != nil {
		fail()
		return
	}
	real, err := exec.LookPath("docker")
	if err != nil {
		fail()
		return
	}
	authority := strings.TrimPrefix(files.origin, "https://")
	connect, err := newFixtureConnect(proxy, authority, front.Addr().String())
	if err != nil {
		fail()
		return
	}
	fixture := &passboltRuntimeFixture{files: files, connect: connect, realDocker: real}
	if err := r.attachPassboltFixture(fixture); err != nil {
		connect.close()
		fail()
		return
	}
	r.passboltOwner = true
	success = true
	r.evidence.Probe += "; fixture helper linux/" + runtime.GOARCH + " sha256:" + files.helperSHA + "; owned verified canonical HTTPS and private no-auth STARTTLS delivery are prerequisites only; browser-extension owner OpenPGP enrollment and key recovery remain manual"
}

func (r *runner) attachPassboltFixture(fixture *passboltRuntimeFixture) error {
	override := filepath.Join(r.root, "passbolt-override.yml")
	source, err := fixture.files.compose()
	if err != nil {
		return err
	}
	if err := os.WriteFile(override, []byte(source), 0600); err != nil {
		return err
	}
	wrapper, err := writePassboltDockerWrapper(r.root, r.project, r.name, fixture.realDocker, override)
	if err != nil {
		return err
	}
	currentPath := ""
	var env []string
	for _, entry := range r.env {
		if strings.HasPrefix(entry, "PATH=") {
			currentPath = strings.TrimPrefix(entry, "PATH=")
			continue
		}
		env = append(env, entry)
	}
	r.env = autheliaChildEnvironment(env, fixture.connect.proxyURL, fixture.files.caFile)
	r.env = append(r.env, "PATH="+filepath.Dir(wrapper)+string(os.PathListSeparator)+currentPath)
	// Each project uses its own selector override while sharing stable trust.
	copy := *fixture
	copy.override = override
	r.passbolt = &copy
	return nil
}

func (f *passboltRuntimeFixture) close() { f.connect.close() }

func (f *passboltRuntimeFixture) install(r *runner, args []string) result {
	installed := r.runWithTimeout(installCommandLimit(r.spec), args...)
	if installed.code != 0 && !(installed.code == exitManual && allManual(installed)) {
		if installed.termination == nil {
			installed.events = append(installed.events, f.startupDiagnostic(r), f.metadataDiagnostic(r), f.applicationMetadataDiagnostic(r), f.effectiveMetadataDiagnostic(r))
		}
		return installed
	}
	// The enclosing install stage can end manual immediately. Preserve a distinct
	// proven prerequisite stage first, without promoting owner/lifecycle acceptance.
	r.stage("local-prerequisites", []string{"verify", "owned-passbolt-tls-and-starttls"}, func() result {
		r.recordImages()
		if !completeImageEvidence(r.evidence.Images, expectedServices(r.spec)) {
			return passboltPrerequisiteFailure()
		}
		return f.probe(r)
	})
	return installed
}

func passboltPrerequisiteFailure() result {
	return result{code: 1, events: []event{{Event: "step.fail", App: "passbolt", Step: "local-prerequisites", Error: "owned verified Passbolt HTTPS and STARTTLS prerequisites were not proved", Hint: "retry the owned local fixture; administrator OpenPGP enrollment remains manual"}}}
}

func (f *passboltRuntimeFixture) probe(r *runner) result {
	parent := r.commandCtx
	if parent == nil {
		parent = context.Background()
	}
	ctx, cancel := context.WithTimeout(parent, 45*time.Second)
	defer cancel()
	proxy, err := url.Parse(f.connect.proxyURL)
	if err != nil {
		return passboltPrerequisiteFailure()
	}
	untrusted := &http.Client{Timeout: 10 * time.Second, Transport: &http.Transport{Proxy: http.ProxyURL(proxy)}, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	request, _ := http.NewRequestWithContext(ctx, http.MethodGet, f.files.origin+"/auth/verify.json", nil)
	if response, err := untrusted.Do(request); err == nil {
		response.Body.Close()
		return passboltPrerequisiteFailure()
	} else {
		var authority x509.UnknownAuthorityError
		if !errors.As(err, &authority) {
			return passboltPrerequisiteFailure()
		}
	}
	trust, err := os.ReadFile(f.files.caFile)
	if err != nil || len(trust) > 16384 {
		return passboltPrerequisiteFailure()
	}
	roots := x509.NewCertPool()
	if !roots.AppendCertsFromPEM(trust) {
		return passboltPrerequisiteFailure()
	}
	transport := &http.Transport{Proxy: http.ProxyURL(proxy), TLSClientConfig: &tls.Config{MinVersion: tls.VersionTLS12, RootCAs: roots}}
	defer transport.CloseIdleConnections()
	client := &http.Client{Timeout: 10 * time.Second, Transport: transport, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	response, err := client.Do(request)
	if err != nil {
		return passboltPrerequisiteFailure()
	}
	var key struct {
		Header struct{ Status string }
		Body   struct{ Fingerprint, Keydata string }
	}
	err = json.NewDecoder(io.LimitReader(response.Body, 128<<10)).Decode(&key)
	response.Body.Close()
	if err != nil || response.StatusCode != 200 || key.Header.Status != "success" || !regexp.MustCompile(`^[0-9A-Fa-f]{40}$`).MatchString(key.Body.Fingerprint) || key.Body.Keydata == "" {
		return passboltPrerequisiteFailure()
	}
	count := func() (uint64, error) {
		req, _ := http.NewRequestWithContext(ctx, http.MethodGet, f.files.origin+"/__selfhost_fixture/smtp-count", nil)
		response, err := client.Do(req)
		if err != nil {
			return 0, err
		}
		defer response.Body.Close()
		var data struct{ Deliveries uint64 }
		err = json.NewDecoder(io.LimitReader(response.Body, 1024)).Decode(&data)
		if response.StatusCode != 200 {
			return 0, fmt.Errorf("fixture counter unavailable")
		}
		return data.Deliveries, err
	}
	before, err := count()
	if err != nil {
		return passboltPrerequisiteFailure()
	}
	wrapper := filepath.Join(r.root, "passbolt-bin", "docker")
	args := []string{"compose", "--project-directory", r.project, "-p", r.name, "--env-file", filepath.Join(r.project, ".env"), "--env-file", filepath.Join(r.project, "secrets.env"), "exec", "-T", "passbolt", "su", "-s", "/bin/bash", "-c", passboltSMTPCommand, "www-data"}
	cmd := exec.CommandContext(ctx, wrapper, args...)
	cmd.Dir = r.project
	cmd.Env = r.env
	if executeOwnedCommand(ctx, cmd).code != 0 {
		return passboltPrerequisiteFailure()
	}
	after, err := count()
	if err != nil || after != before+1 {
		return passboltPrerequisiteFailure()
	}
	return result{}
}

// This failure-only HTTP observation never retains a response body or keys.
func (f *passboltRuntimeFixture) startupDiagnostic(r *runner) event {
	reason := "owned Passbolt verification diagnostic could not be observed"
	parent := r.commandCtx
	if parent == nil {
		parent = context.Background()
	}
	ctx, cancel := context.WithTimeout(parent, 15*time.Second)
	defer cancel()
	trust, err := os.ReadFile(f.files.caFile)
	roots := x509.NewCertPool()
	if err == nil && len(trust) <= 16384 && roots.AppendCertsFromPEM(trust) {
		proxy, err := url.Parse(f.connect.proxyURL)
		if err == nil {
			transport := &http.Transport{Proxy: http.ProxyURL(proxy), TLSClientConfig: &tls.Config{MinVersion: tls.VersionTLS12, RootCAs: roots}}
			defer transport.CloseIdleConnections()
			client := &http.Client{Transport: transport, Timeout: 10 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
			request, err := http.NewRequestWithContext(ctx, http.MethodGet, f.files.origin+"/auth/verify.json", nil)
			if err == nil {
				response, err := client.Do(request)
				if err == nil {
					body, readErr := io.ReadAll(io.LimitReader(response.Body, (16<<10)+1))
					response.Body.Close()
					if readErr == nil {
						reason = passboltReadinessReason(response.StatusCode, body)
					}
				}
			}
		}
	}
	return event{Event: "step.fail", App: "passbolt", Step: "startup-diagnostic", Error: reason, Hint: "inspect only allowlisted startup/configuration and key-file accessibility booleans in the owned Project; no raw logs or key payloads"}
}

// No permission changes, payload reads or application config evaluation.
func (f *passboltRuntimeFixture) metadataDiagnostic(r *runner) event {
	parent := r.commandCtx
	if parent == nil {
		parent = context.Background()
	}
	ctx, cancel := context.WithTimeout(parent, 15*time.Second)
	defer cancel()
	wrapper := filepath.Join(r.root, "passbolt-bin", "docker")
	args := []string{"compose", "--project-directory", r.project, "-p", r.name, "--env-file", filepath.Join(r.project, ".env"), "--env-file", filepath.Join(r.project, "secrets.env"), "exec", "-T", "passbolt", "sh", "-c", passboltMetadataCommand}
	command := exec.CommandContext(ctx, wrapper, args...)
	command.Dir = r.project
	command.Env = r.env
	observation := executeOwnedCommand(ctx, command)
	return event{Event: "step.fail", App: "passbolt", Step: "startup-metadata", Error: passboltMetadataReason(observation.code, []byte(observation.stdout)), Hint: "read-only fixed public-key path metadata; an unobserved probe proves no missing file or readability failure"}
}

func (f *passboltRuntimeFixture) applicationMetadataDiagnostic(r *runner) event {
	parent := r.commandCtx
	if parent == nil {
		parent = context.Background()
	}
	ctx, cancel := context.WithTimeout(parent, 15*time.Second)
	defer cancel()
	wrapper := filepath.Join(r.root, "passbolt-bin", "docker")
	args := []string{"compose", "--project-directory", r.project, "-p", r.name, "--env-file", filepath.Join(r.project, ".env"), "--env-file", filepath.Join(r.project, "secrets.env"), "exec", "-T", "--user", "www-data", "passbolt", "php", "-d", "display_errors=0", "-d", "log_errors=0", "-r", passboltApplicationMetadataPHP}
	command := exec.CommandContext(ctx, wrapper, args...)
	command.Dir = r.project
	command.Env = r.env
	observation := executeOwnedCommand(ctx, command)
	return event{Event: "step.fail", App: "passbolt", Step: "startup-application-metadata", Error: passboltApplicationMetadataReason(observation.code, []byte(observation.stdout)), Hint: "read-only key accessibility and owned-env PDO/schema metadata; does not prove key import or effective Cake/FPM configuration"}
}

// CLI application observation; does not establish the FPM worker's configuration.
func (f *passboltRuntimeFixture) effectiveMetadataDiagnostic(r *runner) event {
	parent := r.commandCtx
	if parent == nil {
		parent = context.Background()
	}
	ctx, cancel := context.WithTimeout(parent, 15*time.Second)
	defer cancel()
	wrapper := filepath.Join(r.root, "passbolt-bin", "docker")
	args := []string{"compose", "--project-directory", r.project, "-p", r.name, "--env-file", filepath.Join(r.project, ".env"), "--env-file", filepath.Join(r.project, "secrets.env"), "exec", "-T", "--user", "www-data", "passbolt", "php", "-d", "display_errors=0", "-d", "log_errors=0", "-r", passboltEffectiveMetadataPHP}
	command := exec.CommandContext(ctx, wrapper, args...)
	command.Dir = r.project
	command.Env = r.env
	observation := executeOwnedCommand(ctx, command)
	return event{Event: "step.fail", App: "passbolt", Step: "startup-effective-metadata", Error: passboltEffectiveMetadataReason(observation.code, []byte(observation.stdout)), Hint: "normal CLI application bootstrap/configuration booleans only; does not establish FPM configuration or key import"}
}
