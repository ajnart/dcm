//go:build e2e

package e2e

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"slices"
	"strings"
	"time"

	"github.com/ajnart/self-host/internal/apps/beszel"
	"github.com/ajnart/self-host/internal/events"
	"github.com/ajnart/self-host/internal/helpers"
)

const beszelProofService = "beszel-proof-load"

type beszelFixtureSecrets map[string]string

func (s beszelFixtureSecrets) Get(key string) string { return s[key] }
func (s beszelFixtureSecrets) Set(key, value string) error {
	s[key] = value
	return nil
}

type beszelRuntimeFixture struct {
	password string
	port     int
	override string
}

func (r *runner) prepareBeszelFixture(ports map[string]int) {
	if !slices.Contains(r.spec.Apps, "beszel") || os.Getenv("E2E_BESZEL_ROOTLESS_STATS") != "1" {
		return
	}
	password := "Selfhost-" + randomHex(40)
	r.env = append(r.env, "SELF_HOST_ADMIN_PASSWORD="+password)
	f := &beszelRuntimeFixture{password: password, port: ports["beszel"], override: filepath.Join(r.root, "beszel-proof.yml")}
	doc := `services:
  beszel-proof-load:
    image: alpine:3.22.1
    restart: unless-stopped
    read_only: true
    cpus: "1.0"
    mem_limit: 96m
    pids_limit: 32
    cap_drop:
      - ALL
    security_opt:
      - no-new-privileges:true
    tmpfs:
      - /tmp:size=48m
    command: ["sh", "-c", "dd if=/dev/zero of=/tmp/load bs=1M count=32 2>/dev/null && sha256sum /dev/zero >/dev/null"]
`
	if err := os.WriteFile(f.override, []byte(doc), 0o600); err != nil {
		r.t.Fatal("prepare owned Beszel load fixture")
	}
	var stages []stageEvidence
	for _, stage := range r.evidence.Stages {
		stages = append(stages, stage)
		if stage.Name == "update" {
			stages = append(stages, stageEvidence{Name: "container-statistics", Outcome: "not-run", Apps: map[string]string{"beszel": "not-run"}})
		}
	}
	r.evidence.Stages = stages
	r.evidence.Probe += "; exact owned same-Project load container matched by full Docker identity and Beszel short ID/name/system with positive CPU and memory; proxy container list/stats GETs and POST denial"
	r.attachBeszelFixture(f)
}

func (r *runner) attachBeszelFixture(f *beszelRuntimeFixture) {
	r.addFixture("beszel", f, &fixtureHooks{
		override: f.override,
		checkFn: func(phase string) result {
			if phase == "after-images" {
				r.stage("container-statistics", []string{"verify", "owned-beszel-container-statistics"}, func() result { return f.check(r) })
			}
			return result{}
		},
		reattachFn: func(target *runner) error {
			target.attachBeszelFixture(f)
			return nil
		},
	})
}

func beszelFixtureFailure() result {
	return result{code: 1, events: []event{{Event: "step.fail", App: "beszel", Step: "container-statistics", Error: "exact owned Beszel container statistics were not verified", Hint: "retry the isolated rootless Docker fixture; no per-container statistics claim"}}}
}

func (f *beszelRuntimeFixture) check(r *runner) result {
	ctx, cancel := context.WithTimeout(r.commandCtx, 3*time.Minute)
	defer cancel()
	run := func(args ...string) result {
		cmd := exec.CommandContext(ctx, "docker", r.dockerArgs(args...)...)
		cmd.Dir = r.composeDir()
		cmd.Env = r.env
		return executeOwnedCommand(ctx, cmd)
	}
	endpoint, securityOptions, rootless := f.dockerFacts(ctx, r.env)
	if !rootless {
		return beszelFixtureFailure()
	}
	if res := run("compose", "-p", r.name, "up", "-d", beszelProofService); res.code != 0 {
		return beszelFixtureFailure()
	}
	selected := run("compose", "-p", r.name, "ps", "-q", beszelProofService)
	id := strings.TrimSpace(selected.stdout)
	if selected.code != 0 || len(strings.Fields(selected.stdout)) != 1 || len(id) != 64 {
		return beszelFixtureFailure()
	}
	const projection = `{"ID":{{json .Id}},"Name":{{json .Name}},"Project":{{json (index .Config.Labels "com.docker.compose.project")}},"Service":{{json (index .Config.Labels "com.docker.compose.service")}},"ImageID":{{json .Image}},"Running":{{json .State.Running}},"NanoCPUs":{{json .HostConfig.NanoCpus}},"Memory":{{json .HostConfig.Memory}},"PidsLimit":{{json .HostConfig.PidsLimit}},"CapDrop":{{json .HostConfig.CapDrop}},"SecurityOpt":{{json .HostConfig.SecurityOpt}},"Tmpfs":{{json .HostConfig.Tmpfs}},"ReadOnlyRoot":{{json .HostConfig.ReadonlyRootfs}}}`
	inspected := run("container", "inspect", "--format", projection, id)
	var container struct {
		ID, Name, Project, Service, ImageID string
		Running                             bool
		NanoCPUs, Memory, PidsLimit         int64
		CapDrop, SecurityOpt                []string
		Tmpfs                               map[string]string
		ReadOnlyRoot                        bool
	}
	if inspected.code != 0 || json.Unmarshal([]byte(inspected.stdout), &container) != nil {
		return beszelFixtureFailure()
	}
	container.Name = strings.TrimPrefix(container.Name, "/")
	want := beszelContainerIdentity{ContainerID: container.ID, Name: container.Name, Project: container.Project, Service: container.Service}
	limits := beszelWorkloadLimits{
		CPU: container.NanoCPUs, Memory: container.Memory, PIDs: container.PidsLimit,
		CapabilitiesDropAll: slices.Contains(container.CapDrop, "ALL"),
		NoNewPrivileges:     slices.Contains(container.SecurityOpt, "no-new-privileges:true"),
		TmpfsBound:          container.Tmpfs["/tmp"] == "size=48m",
		ReadOnlyRoot:        container.ReadOnlyRoot,
	}
	if !container.Running || want.ContainerID != id || want.Project != r.name || want.Service != beszelProofService || !beszelWorkloadLimitsMatch(limits) {
		return beszelFixtureFailure()
	}
	image := run("image", "inspect", "--format", `{{.Id}} {{.Os}}/{{.Architecture}}`, container.ImageID)
	parts := strings.Fields(image.stdout)
	if image.code != 0 || len(parts) != 2 || !strings.HasPrefix(parts[0], "sha256:") || !strings.Contains(parts[1], "/") {
		return beszelFixtureFailure()
	}
	client := &http.Client{Timeout: 15 * time.Second, Transport: &http.Transport{Proxy: nil}, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	proxyListed, proxyStats, proxyDenied := f.proxyProof(ctx, client, want)
	dockerSocket, proxyConfig := f.proxyConfiguration(run, r)
	if !proxyListed || !proxyStats || !proxyDenied || !proxyConfig || !beszelRootlessSocketMatch(endpoint, securityOptions, dockerSocket) {
		return beszelFixtureFailure()
	}
	h := helpers.New(helpers.Config{
		App: "beszel", BaseURL: fmt.Sprintf("http://127.0.0.1:%d", f.port), HTTP: client,
		Secrets: beszelFixtureSecrets{"ADMIN_USER": "admin", "ADMIN_PASSWORD": f.password}, Log: events.Discard(),
	})
	deadline := time.Now().Add(2 * time.Minute)
	for time.Now().Before(deadline) {
		observation, systemID, matches, err := f.hubObservation(ctx, h, want)
		if err == nil && matches == 1 && beszelContainerMatch(want, systemID, observation) {
			r.evidence.BeszelContainer = &beszelContainerEvidence{
				beszelContainerIdentity: want, HubID: observation.ID, SystemID: systemID, HubMatches: matches,
				CPU: observation.CPU, Memory: observation.Memory, Updated: observation.Updated,
				ProxyListed: proxyListed, ProxyStats: proxyStats, ProxyWriteDenied: proxyDenied,
				DockerSocket: dockerSocket, DockerEndpoint: endpoint, RootlessSecurity: true,
				CPUQuota: limits.CPU, MemoryLimit: limits.Memory, PIDLimit: limits.PIDs,
				CapabilitiesDrop: limits.CapabilitiesDropAll, NoNewPrivileges: limits.NoNewPrivileges,
				TmpfsLimitBytes: 48 * 1024 * 1024,
				ReadOnlyRoot:    limits.ReadOnlyRoot,
				ImageID:         parts[0], Platform: parts[1],
			}
			return result{}
		}
		select {
		case <-ctx.Done():
			return beszelFixtureFailure()
		case <-time.After(5 * time.Second):
		}
	}
	return beszelFixtureFailure()
}

func (f *beszelRuntimeFixture) dockerFacts(ctx context.Context, environment []string) (string, []string, bool) {
	getenv := func(key string) string {
		for _, entry := range environment {
			name, value, found := strings.Cut(entry, "=")
			if found && name == key {
				return value
			}
		}
		return ""
	}
	run := func(args ...string) result {
		cmd := exec.CommandContext(ctx, "docker", args...)
		cmd.Env = environment
		return executeOwnedCommand(ctx, cmd)
	}
	endpoint := ""
	if contextName := getenv("DOCKER_CONTEXT"); contextName != "" {
		inspected := run("context", "inspect", contextName, "--format", `{{.Endpoints.docker.Host}}`)
		if inspected.code != 0 {
			return "", nil, false
		}
		endpoint = strings.TrimSpace(inspected.stdout)
	} else if dockerHost := getenv("DOCKER_HOST"); dockerHost != "" {
		endpoint = dockerHost
	} else {
		inspected := run("context", "inspect", "--format", `{{.Endpoints.docker.Host}}`)
		if inspected.code != 0 {
			return "", nil, false
		}
		endpoint = strings.TrimSpace(inspected.stdout)
	}
	info := run("info", "--format", `{{json .SecurityOptions}}`)
	var securityOptions []string
	if info.code != 0 || json.Unmarshal([]byte(info.stdout), &securityOptions) != nil {
		return endpoint, nil, false
	}
	parsed, err := url.Parse(endpoint)
	return endpoint, securityOptions, err == nil && parsed.Scheme == "unix" && parsed.Path != "" && slices.Contains(securityOptions, "name=rootless")
}

func (f *beszelRuntimeFixture) proxyConfiguration(run func(...string) result, r *runner) (string, bool) {
	selected := run("compose", "-p", r.name, "ps", "-q", beszel.SocketProxyService)
	proxyID := strings.TrimSpace(selected.stdout)
	if selected.code != 0 || len(strings.Fields(selected.stdout)) != 1 || len(proxyID) != 64 {
		return "", false
	}
	const projection = `{"Mounts":{{json .Mounts}},"Env":{{json .Config.Env}}}`
	inspected := run("container", "inspect", "--format", projection, proxyID)
	if inspected.code != 0 {
		return "", false
	}
	return beszelProxyConfiguration([]byte(inspected.stdout))
}

func (f *beszelRuntimeFixture) proxyProof(ctx context.Context, client *http.Client, want beszelContainerIdentity) (bool, bool, bool) {
	base := "http://127.0.0.1:45877"
	request := func(method, path string) (int, []byte, error) {
		req, err := http.NewRequestWithContext(ctx, method, base+path, nil)
		if err != nil {
			return 0, nil, err
		}
		resp, err := client.Do(req)
		if err != nil {
			return 0, nil, err
		}
		defer resp.Body.Close()
		var body json.RawMessage
		if resp.StatusCode == http.StatusOK && json.NewDecoder(resp.Body).Decode(&body) != nil {
			return resp.StatusCode, nil, errors.New("invalid proxy JSON")
		}
		return resp.StatusCode, body, nil
	}
	status, body, err := request(http.MethodGet, "/containers/json?all=1")
	var rows []struct {
		ID     string
		Names  []string
		Labels map[string]string
	}
	listed := status == http.StatusOK && err == nil && json.Unmarshal(body, &rows) == nil
	if listed {
		listed = false
		for _, row := range rows {
			if row.ID == want.ContainerID && slices.Contains(row.Names, "/"+want.Name) && row.Labels["com.docker.compose.project"] == want.Project && row.Labels["com.docker.compose.service"] == want.Service {
				listed = true
			}
		}
	}
	status, body, err = request(http.MethodGet, "/containers/"+url.PathEscape(want.ContainerID)+"/stats?stream=false&one-shot=true")
	var stats struct {
		CPU struct {
			Usage struct {
				Total uint64 `json:"total_usage"`
			} `json:"cpu_usage"`
		} `json:"cpu_stats"`
		Memory struct {
			Usage uint64 `json:"usage"`
		} `json:"memory_stats"`
	}
	statsOK := status == http.StatusOK && err == nil && json.Unmarshal(body, &stats) == nil && stats.CPU.Usage.Total > 0 && stats.Memory.Usage > 0
	status, _, err = request(http.MethodPost, "/_ping")
	return listed, statsOK, err == nil && status == http.StatusForbidden
}

func (f *beszelRuntimeFixture) hubObservation(ctx context.Context, h *helpers.H, want beszelContainerIdentity) (beszelContainerObservation, string, int, error) {
	login, err := h.HTTP(ctx, helpers.Request{Method: http.MethodPost, Path: "/api/collections/users/auth-with-password", JSON: map[string]string{"identity": beszel.AdminEmail(h), "password": h.AdminPassword()}})
	if err != nil || login.Status != http.StatusOK {
		return beszelContainerObservation{}, "", 0, errors.New("Beszel login failed")
	}
	var session struct {
		Token string `json:"token"`
	}
	if login.Decode(&session) != nil || session.Token == "" {
		return beszelContainerObservation{}, "", 0, errors.New("Beszel login response invalid")
	}
	systemsResponse, err := h.HTTP(ctx, helpers.Request{Path: "/api/collections/systems/records?perPage=500&fields=id,name,status", Header: map[string]string{"Authorization": session.Token}})
	if err != nil || systemsResponse.Status != http.StatusOK {
		return beszelContainerObservation{}, "", 0, errors.New("Beszel systems unavailable")
	}
	var systems struct {
		Items []struct{ ID, Name, Status string } `json:"items"`
	}
	if systemsResponse.Decode(&systems) != nil {
		return beszelContainerObservation{}, "", 0, errors.New("Beszel systems invalid")
	}
	systemID := ""
	for _, system := range systems.Items {
		if system.Name == beszel.SystemName && system.Status == "up" {
			if systemID != "" {
				return beszelContainerObservation{}, "", 0, errors.New("Beszel system identity duplicated")
			}
			systemID = system.ID
		}
	}
	if systemID == "" {
		return beszelContainerObservation{}, "", 0, errors.New("Beszel system identity unavailable")
	}
	response, err := h.HTTP(ctx, helpers.Request{Path: "/api/collections/containers/records?perPage=500&fields=id,name,system,cpu,memory,updated", Header: map[string]string{"Authorization": session.Token}})
	if err != nil || response.Status != http.StatusOK {
		return beszelContainerObservation{}, "", 0, errors.New("Beszel container records unavailable")
	}
	var records struct {
		Items []beszelContainerObservation `json:"items"`
	}
	if response.Decode(&records) != nil {
		return beszelContainerObservation{}, "", 0, errors.New("Beszel container records invalid")
	}
	var found beszelContainerObservation
	matches := 0
	for _, item := range records.Items {
		if len(want.ContainerID) >= 12 && item.ID == want.ContainerID[:12] && item.Name == want.Name && item.System == systemID {
			found = item
			matches++
		}
	}
	return found, systemID, matches, nil
}
