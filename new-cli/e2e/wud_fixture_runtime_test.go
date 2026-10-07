//go:build e2e

package e2e

import (
	"context"
	"encoding/json"
	"fmt"
	"github.com/ajnart/self-host/e2e/wudfixture"
	"io"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"slices"
	"strings"
	"sync"
	"time"
)

type wudRuntimeFixture struct {
	observerCtx          context.Context
	files                *wudFixtureFiles
	realDocker, override string
	port                 int
	mu                   sync.Mutex
	generation           uint64
	current              wudfixture.Snapshot
	cancel               context.CancelFunc
	done                 chan struct{}
}

func wudFixtureFailure() result {
	return result{code: 1, events: []event{{Event: "step.fail", App: "wud", Step: "owned-inventory", Error: "fresh exact owned TLS Docker inventory was not verified", Hint: "retry the isolated ntfy and read-only mTLS facade fixture; no registry-update claim"}}}
}
func (r *runner) prepareWUDFixture(ports map[string]int) {
	if !slices.Contains(r.spec.Apps, "wud") {
		return
	}
	fail := func() { r.t.Fatal("prepare owned WUD mTLS Docker facade") }
	module, err := moduleRoot()
	if err != nil {
		fail()
		return
	}
	dir := filepath.Join(r.root, "wud-prerequisites")
	observed := filepath.Join(r.root, "wud-observed")
	for _, p := range []string{dir, observed} {
		if os.Mkdir(p, 0700) != nil {
			fail()
			return
		}
	}
	binary := filepath.Join(dir, "helper")
	ctx, cancel := context.WithTimeout(r.commandCtx, 2*time.Minute)
	defer cancel()
	cmd := exec.CommandContext(ctx, "go", "build", "-buildvcs=false", "-trimpath", "-o", binary, "./e2e/wudfixture/cmd")
	cmd.Dir = module
	for _, entry := range os.Environ() {
		key, _, _ := strings.Cut(entry, "=")
		if key != "CGO_ENABLED" && key != "GOOS" && key != "GOARCH" {
			cmd.Env = append(cmd.Env, entry)
		}
	}
	cmd.Env = append(cmd.Env, "CGO_ENABLED=0", "GOOS=linux", "GOARCH="+runtime.GOARCH)
	if executeOwnedCommand(ctx, cmd).code != 0 {
		fail()
		return
	}
	material, err := wudfixture.Certificates()
	if err != nil {
		fail()
		return
	}
	for name, data := range map[string][]byte{"server.pem": material.ServerCertificate, "server.key": material.ServerKey, "ca.pem": material.CA} {
		if os.WriteFile(filepath.Join(dir, name), data, 0600) != nil {
			fail()
			return
		}
	}
	real, err := exec.LookPath("docker")
	if err != nil {
		fail()
		return
	}
	f := &wudRuntimeFixture{files: &wudFixtureFiles{dir: dir, observed: observed, binary: binary, material: material}, realDocker: real, port: ports["wud"]}
	if r.attachWUDFixture(f) != nil {
		fail()
		return
	}
	var stages []stageEvidence
	for _, stage := range r.evidence.Stages {
		stages = append(stages, stage)
		name := ""
		if stage.Name == "update" {
			name = "owned-inventory"
		}
		if stage.Name == "restored-check" {
			name = "restored-owned-inventory"
		}
		if name != "" {
			stages = append(stages, stageEvidence{Name: name, Outcome: "not-run", Apps: map[string]string{"wud": "not-run", "ntfy": "not-run"}})
		}
	}
	r.evidence.Stages = stages
	r.evidence.Probe += "; fresh exact owned ntfy container/image inventory through private read-only mTLS Docker facade before backup and after restore; digest/tag registry checks disabled, no registry-update claim"
}
func (r *runner) attachWUDFixture(source *wudRuntimeFixture) error {
	f := &wudRuntimeFixture{files: &wudFixtureFiles{dir: source.files.dir, observed: filepath.Join(r.root, "wud-observed"), material: source.files.material}, realDocker: source.realDocker, port: source.port, override: filepath.Join(r.root, "wud-override.yml")}
	if err := os.MkdirAll(f.files.observed, 0700); err != nil {
		return err
	}
	tlsDir := filepath.Join(r.project, "apps", "wud", "tls")
	if err := os.MkdirAll(tlsDir, 0700); err != nil {
		return err
	}
	for name, data := range map[string][]byte{"ca.pem": f.files.material.CA, "client-cert.pem": f.files.material.ClientCertificate, "client-key.pem": f.files.material.ClientKey} {
		if err := os.WriteFile(filepath.Join(tlsDir, name), data, 0600); err != nil {
			return err
		}
	}
	doc, err := f.files.compose(r.name)
	if err != nil {
		return err
	}
	if err = os.WriteFile(f.override, []byte(doc), 0600); err != nil {
		return err
	}
	wrapper, err := writeWUDDockerWrapper(r.root, r.project, r.name, f.realDocker, f.override)
	if err != nil {
		return err
	}
	var env []string
	path := ""
	for _, entry := range r.env {
		if strings.HasPrefix(entry, "PATH=") {
			path = strings.TrimPrefix(entry, "PATH=")
		} else {
			env = append(env, entry)
		}
	}
	r.env = append(env, "PATH="+filepath.Dir(wrapper)+string(os.PathListSeparator)+path)
	r.wud = f
	return nil
}
func (f *wudRuntimeFixture) observe(r *runner) bool {
	f.mu.Lock()
	defer f.mu.Unlock()
	parent := r.commandCtx
	if f.observerCtx != nil {
		parent = f.observerCtx
	}
	ctx, cancel := context.WithTimeout(parent, 20*time.Second)
	defer cancel()
	run := func(args ...string) result {
		cmd := exec.CommandContext(ctx, f.realDocker, args...)
		cmd.Env = r.env
		return executeOwnedCommand(ctx, cmd)
	}
	res := run("compose", "--project-directory", r.project, "--env-file", filepath.Join(r.project, ".env"), "--env-file", filepath.Join(r.project, "secrets.env"), "-f", filepath.Join(r.project, "compose.yml"), "-f", f.override, "-p", r.name, "ps", "-q", "ntfy")
	id := strings.TrimSpace(res.stdout)
	if res.code != 0 || !wudOwnedID(id) {
		return false
	}
	const projection = `{"ID":{{json .Id}},"ImageID":{{json .Image}},"Image":{{json .Config.Image}},"Name":{{json .Name}},"Running":{{json .State.Running}},"Project":{{json (index .Config.Labels "com.docker.compose.project")}},"Service":{{json (index .Config.Labels "com.docker.compose.service")}},"Watch":{{json (index .Config.Labels "wud.watch")}},"Digest":{{json (index .Config.Labels "wud.watch.digest")}}}`
	res = run("container", "inspect", "--format", projection, id)
	var c struct {
		ID, ImageID, Image, Name, Project, Service, Watch, Digest string
		Running                                                   bool
	}
	if res.code != 0 || json.Unmarshal([]byte(res.stdout), &c) != nil || c.ID != id || c.Project != r.name || c.Service != "ntfy" || c.Watch != "true" || c.Digest != "false" || !c.Running || !strings.HasPrefix(c.ImageID, "sha256:") || !wudOwnedID(strings.TrimPrefix(c.ImageID, "sha256:")) {
		return false
	}
	containerJSON := res.stdout
	const imageProjection = `{"ImageID":{{json .Id}},"RepoTags":{{json .RepoTags}},"RepoDigests":{{json .RepoDigests}},"Architecture":{{json .Architecture}},"OS":{{json .Os}},"Variant":{{json .Variant}},"Created":{{json .Created}}}`
	res = run("image", "inspect", "--format", imageProjection, c.ImageID)
	if res.code != 0 {
		return false
	}
	f.generation++
	s, err := decodeWUDObservation([]byte(containerJSON), []byte(res.stdout), r.name, id, f.generation, time.Now().UTC())
	if err != nil {
		return false
	}
	b, err := json.Marshal(s)
	if err != nil {
		return false
	}
	tmp := filepath.Join(f.files.observed, "snapshot.pending")
	if os.WriteFile(tmp, b, 0600) != nil || os.Rename(tmp, filepath.Join(f.files.observed, "snapshot.json")) != nil {
		return false
	}
	f.current = s
	return true
}
func (f *wudRuntimeFixture) start(r *runner) {
	ctx, cancel := context.WithCancel(r.commandCtx)
	f.cancel = cancel
	f.observerCtx = ctx
	f.done = make(chan struct{})
	go func() {
		defer close(f.done)
		ticker := time.NewTicker(15 * time.Second)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				f.observe(r)
			}
		}
	}()
}
func (f *wudRuntimeFixture) close() {
	if f.cancel != nil {
		f.cancel()
		<-f.done
		f.cancel = nil
	}
}
func (f *wudRuntimeFixture) install(r *runner, args []string, ports map[string]int) result {
	seed := installArguments(targetSpec{Kind: "app", ID: "ntfy", Apps: []string{"ntfy"}}, r.root, ports)
	res := r.runWithTimeout(installCommandLimit(r.spec), seed...)
	if res.code != 0 {
		return res
	}
	if !f.observe(r) {
		return wudFixtureFailure()
	}
	f.start(r)
	return r.runWithTimeout(installCommandLimit(r.spec), args...)
}
func (f *wudRuntimeFixture) check(r *runner) result {
	if !f.observe(r) {
		return wudFixtureFailure()
	}
	handoff := r.runWithTimeout(30*time.Second, "credentials", "--json")
	var credentials struct {
		Admin struct{ Username, Password string }
	}
	if handoff.code != 0 || json.Unmarshal([]byte(handoff.stdout), &credentials) != nil || credentials.Admin.Username == "" || credentials.Admin.Password == "" {
		return wudFixtureFailure()
	}
	ctx, cancel := context.WithTimeout(r.commandCtx, 45*time.Second)
	defer cancel()
	client := &http.Client{Timeout: 20 * time.Second, Transport: &http.Transport{Proxy: nil}, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	type entry struct {
		ID, Watcher string
		Error       any
		Image       struct{ ID string }
	}
	request := func(method, path string, dst any) bool {
		req, err := http.NewRequestWithContext(ctx, method, fmt.Sprintf("http://127.0.0.1:%d", f.port)+path, nil)
		if err != nil {
			return false
		}
		req.SetBasicAuth(credentials.Admin.Username, credentials.Admin.Password)
		res, err := client.Do(req)
		if err != nil {
			return false
		}
		defer res.Body.Close()
		return res.StatusCode == 200 && json.NewDecoder(io.LimitReader(res.Body, 1<<20)).Decode(dst) == nil
	}
	var entries []entry
	if !request("GET", "/api/containers", &entries) || len(entries) != 1 {
		return wudFixtureFailure()
	}
	f.mu.Lock()
	snapshot := f.current
	f.mu.Unlock()
	e := entries[0]
	if e.ID != snapshot.ContainerID || e.Watcher != "approved" || e.Error != nil || e.Image.ID != snapshot.ImageID {
		return wudFixtureFailure()
	}
	var fresh entry
	if !request("POST", "/api/containers/"+url.PathEscape(e.ID)+"/watch", &fresh) || fresh.ID != e.ID || fresh.Image.ID != snapshot.ImageID || fresh.Watcher != "approved" || fresh.Error != nil {
		return wudFixtureFailure()
	}
	owner := r
	if r.evidenceOwner != nil {
		owner = r.evidenceOwner
	}
	owner.evidence.OwnedInventory = append(owner.evidence.OwnedInventory, ownedInventoryEvidence{ComposeProject: r.name, Service: "ntfy", ContainerID: snapshot.ContainerID, ImageID: snapshot.ImageID, Generation: snapshot.Generation, ObservedAt: snapshot.ObservedAt, FreshWatch: true})
	return result{}
}
