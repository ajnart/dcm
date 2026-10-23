package e2e

import (
	"encoding/hex"
	"encoding/json"
	"fmt"
	"github.com/ajnart/self-host/internal/app"
	stepstatus "github.com/ajnart/self-host/internal/status"
	"go.yaml.in/yaml/v3"
	"io"
	"net/url"
	"path/filepath"
	"slices"
	"sort"
	"strings"
	"time"

	"github.com/ajnart/self-host/internal/catalog"
	"github.com/ajnart/self-host/internal/events"
)

type targetSpec struct {
	Kind string   `json:"kind"`
	ID   string   `json:"id"`
	Apps []string `json:"apps"`
}

func acceptanceInventory(c *catalog.Catalog) []targetSpec {
	var out []targetSpec
	for _, a := range c.AllApps() {
		id := a.Info().ID
		out = append(out, targetSpec{Kind: "app", ID: id, Apps: []string{id}})
	}
	for _, r := range c.Recipes() {
		out = append(out, targetSpec{Kind: "recipe", ID: r.ID, Apps: r.Apps})
	}
	// The compatibility Recipe is intentionally hidden from people, but it is
	// still a supported install target and must retain lifecycle evidence.
	if r, ok := c.Recipe("homarr-control-plane"); ok {
		out = append(out, targetSpec{Kind: "recipe", ID: r.ID, Apps: r.Apps})
	}
	sort.Slice(out, func(i, j int) bool { return evidenceName(out[i]) < evidenceName(out[j]) })
	return out
}

func evidenceName(t targetSpec) string { return t.Kind + "-" + t.ID }
func findTarget(inventory []targetSpec, id string) targetSpec {
	for _, t := range inventory {
		if t.ID == id || evidenceName(t) == id {
			return t
		}
	}
	return targetSpec{}
}

// Credentials/licenses and externally owned endpoints are never synthesized.
var externalApps = map[string]bool{
	"cloudflare-tunnel": true, "gluetun": true, "minio": true,
	"plex": true, "renovate": true, "tailscale": true,
}

var localPrerequisiteApps = map[string]bool{"netbird": true, "passbolt": true, "wud": true}

func classifyTarget(c *catalog.Catalog, t targetSpec) string {
	status := "runnable"
	for _, id := range t.Apps {
		a, ok := c.App(id)
		if !ok {
			return "missing-configuration"
		}
		for _, in := range a.Inputs() {
			if dependency, supplied := appInputTable[id].runtime[in.Key]; supplied && (dependency == "" || slices.Contains(t.Apps, dependency)) {
				continue
			}
			if !in.Required || in.Default != "" || appInputTable[id].local[in.Key] != "" {
				continue
			}
			if externalApps[id] {
				return "awaiting-external-credentials"
			}
			if localPrerequisiteApps[id] {
				return "awaiting-local-prerequisites"
			}
			status = "missing-configuration"
		}
	}
	return status
}

func installArguments(t targetSpec, root string, ports map[string]int, secondary ...map[string]int) []string {
	return installArgumentsWithCatalog(catalog.Default(), t, root, ports, secondary...)
}

func installArgumentsWithCatalog(c *catalog.Catalog, t targetSpec, root string, ports map[string]int, secondary ...map[string]int) []string {
	args := []string{"install", t.ID}
	baseApps := map[string]bool{t.ID: true}
	if recipe, ok := c.Recipe(t.ID); ok && t.Kind == "recipe" {
		for _, id := range recipe.Apps {
			baseApps[id] = true
		}
	}
	for _, id := range t.Apps {
		if !baseApps[id] {
			args = append(args, id)
		}
	}
	args = append(args, "--yes", "--json", "--exposure", "local", "--media-root", filepath.Join(root, "media"), "--downloads-root", filepath.Join(root, "downloads"))
	for _, id := range t.Apps {
		if port := ports[id]; port > 0 {
			args = append(args, "--set", fmt.Sprintf("%s.port=%d", id, port))
		}
		if input, ok := hostPortInput(c, id); ok && len(secondary) > 0 && secondary[0][id] > 0 {
			args = append(args, "--set", fmt.Sprintf("%s.%s=%d", id, input.Key, secondary[0][id]))
		}
		keys := []string{}
		for key := range appInputTable[id].local {
			keys = append(keys, key)
		}
		sort.Strings(keys)
		for _, key := range keys {
			args = append(args, "--set", id+"."+key+"="+appInputTable[id].local[key])
		}
	}
	return args
}

func hostPortInput(c *catalog.Catalog, id string) (app.Input, bool) {
	a, ok := c.App(id)
	if !ok {
		return app.Input{}, false
	}
	for _, input := range a.Inputs() {
		if len(input.HostPortProtocols) > 0 {
			return input, true
		}
	}
	return app.Input{}, false
}

var stageNames = []string{"install", "setup-check", "idempotency", "restart", "recovery", "update", "backup", "isolated-restore", "restored-check", "sentinel"}

type event = events.Event

type failureEvidence struct {
	Kind  string `json:"kind"`
	App   string `json:"app,omitempty"`
	Step  string `json:"step,omitempty"`
	Error string `json:"error"`
	Hint  string `json:"hint,omitempty"`
}

type stageEvidence struct {
	Resources   *resourceEvidence   `json:"resources,omitempty"`
	Termination *commandTermination `json:"termination,omitempty"`
	Failures    []failureEvidence   `json:"failures,omitempty"`
	Name        string              `json:"name"`
	Outcome     string              `json:"outcome"`
	Reason      string              `json:"reason,omitempty"`
	Command     []string            `json:"command,omitempty"`
	Apps        map[string]string   `json:"apps"`
}

type ownedInventoryEvidence struct {
	ComposeProject string    `json:"compose_project"`
	Service        string    `json:"service"`
	ContainerID    string    `json:"container_id"`
	ImageID        string    `json:"image_id"`
	Generation     uint64    `json:"generation"`
	ObservedAt     time.Time `json:"observed_at"`
	FreshWatch     bool      `json:"fresh_watch"`
}

type beszelContainerIdentity struct {
	ContainerID string `json:"container_id"`
	Name        string `json:"name"`
	Project     string `json:"compose_project"`
	Service     string `json:"service"`
}

type beszelContainerObservation struct {
	ID      string  `json:"id"`
	Name    string  `json:"name"`
	System  string  `json:"system"`
	CPU     float64 `json:"cpu"`
	Memory  float64 `json:"memory"`
	Updated int64   `json:"updated"`
}

type beszelWorkloadLimits struct {
	CPU                 int64
	Memory              int64
	PIDs                int64
	CapabilitiesDropAll bool
	NoNewPrivileges     bool
	TmpfsBound          bool
	ReadOnlyRoot        bool
}

type beszelContainerEvidence struct {
	beszelContainerIdentity
	HubID            string  `json:"hub_id"`
	SystemID         string  `json:"system_id"`
	HubMatches       int     `json:"hub_matches"`
	CPU              float64 `json:"cpu"`
	Memory           float64 `json:"memory"`
	Updated          int64   `json:"updated"`
	ProxyListed      bool    `json:"proxy_listed"`
	ProxyStats       bool    `json:"proxy_stats"`
	ProxyWriteDenied bool    `json:"proxy_write_denied"`
	DockerSocket     string  `json:"docker_socket"`
	DockerEndpoint   string  `json:"docker_endpoint"`
	RootlessSecurity bool    `json:"rootless_security"`
	CPUQuota         int64   `json:"cpu_nano_quota"`
	MemoryLimit      int64   `json:"memory_limit_bytes"`
	PIDLimit         int64   `json:"pid_limit"`
	CapabilitiesDrop bool    `json:"capabilities_drop_all"`
	NoNewPrivileges  bool    `json:"no_new_privileges"`
	TmpfsLimitBytes  int64   `json:"tmpfs_limit_bytes"`
	ReadOnlyRoot     bool    `json:"read_only_root"`
	ImageID          string  `json:"image_id"`
	Platform         string  `json:"platform"`
}

func beszelContainerMatch(want beszelContainerIdentity, systemID string, got beszelContainerObservation) bool {
	return len(want.ContainerID) >= 12 && systemID != "" && got.ID == want.ContainerID[:12] && got.Name == want.Name && got.System == systemID && got.CPU > 0 && got.Memory >= 16 && got.Updated > 0
}

func beszelRootlessSocketMatch(endpoint string, securityOptions []string, mountSource string) bool {
	parsed, err := url.Parse(endpoint)
	if err != nil || parsed.Scheme != "unix" || parsed.Path == "" || parsed.Path != mountSource {
		return false
	}
	return slices.Contains(securityOptions, "name=rootless")
}

func beszelProxyConfiguration(projection []byte) (string, bool) {
	var proxy struct {
		Mounts []struct {
			Source, Destination string
			RW                  bool
		}
		Env []string
	}
	if json.Unmarshal(projection, &proxy) != nil {
		return "", false
	}
	var socketMounts []struct {
		Source, Destination string
		RW                  bool
	}
	for _, mount := range proxy.Mounts {
		if mount.Destination == "/var/run/docker.sock" || filepath.Base(mount.Source) == "docker.sock" {
			socketMounts = append(socketMounts, mount)
		}
	}
	if len(socketMounts) != 1 {
		return "", false
	}
	mount := socketMounts[0]
	configured := filepath.Base(mount.Source) == "docker.sock" && mount.Destination == "/var/run/docker.sock" && !mount.RW
	return mount.Source, configured && slices.Contains(proxy.Env, "CONTAINERS=1") && slices.Contains(proxy.Env, "POST=0")
}

func beszelWorkloadLimitsMatch(limits beszelWorkloadLimits) bool {
	return limits.CPU == 1_000_000_000 && limits.Memory == 96*1024*1024 && limits.PIDs == 32 && limits.CapabilitiesDropAll && limits.NoNewPrivileges && limits.TmpfsBound && limits.ReadOnlyRoot
}

type targetEvidence struct {
	OwnedInventory         []ownedInventoryEvidence `json:"owned_inventory,omitempty"`
	Resources              *resourceEvidence        `json:"resources,omitempty"`
	ComposeProject         string                   `json:"compose_project,omitempty"`
	RetainedComposeProject string                   `json:"retained_compose_project,omitempty"`
	Cleanup                string                   `json:"cleanup,omitempty"`
	RetainedProject        string                   `json:"retained_project,omitempty"`
	RetainedOwnedRoots     []ownedRootEvidence      `json:"retained_owned_roots,omitempty"`
	RetainedProjects       []ownedProjectEvidence   `json:"retained_projects,omitempty"`
	BinarySHA256           string                   `json:"binary_sha256,omitempty"`
	Version                int                      `json:"version"`
	Target                 targetSpec               `json:"target"`
	Head                   string                   `json:"head"`
	Platform               string                   `json:"platform"`
	Images                 []imageEvidence          `json:"images,omitempty"`
	UnavailableImages      []string                 `json:"unavailable_images,omitempty"`
	BlockerReason          string                   `json:"blocker_reason,omitempty"`
	Outcome                string                   `json:"outcome"`
	Classification         string                   `json:"classification"`
	Stages                 []stageEvidence          `json:"stages"`
	Started                time.Time                `json:"started"`
	Finished               *time.Time               `json:"finished,omitempty"`
	Probe                  string                   `json:"probe"`
	BeszelContainer        *beszelContainerEvidence `json:"beszel_container,omitempty"`
}

type ownedRootEvidence struct {
	Purpose string `json:"purpose"`
	Path    string `json:"path"`
}

type ownedProjectEvidence struct {
	Project        string `json:"project"`
	ComposeProject string `json:"compose_project,omitempty"`
}

type imageEvidence struct {
	Service  string `json:"service"`
	ID       string `json:"id"`
	Platform string `json:"platform"`
}

func newEvidence(t targetSpec, head string) *targetEvidence {
	e := &targetEvidence{Version: 1, Target: t, Head: head, Outcome: "not-run", Started: time.Now().UTC(), Probe: "App Setup/Check and filesystem backup sentinel; no workload or database-content assertion"}
	for _, name := range stageNames {
		apps := map[string]string{}
		for _, id := range t.Apps {
			apps[id] = "not-run"
		}
		e.Stages = append(e.Stages, stageEvidence{Name: name, Outcome: "not-run", Apps: apps})
	}
	return e
}

func (e *targetEvidence) complete() bool {
	for _, stage := range e.Stages {
		if stage.Outcome != "pass" {
			return false
		}
	}
	return true
}

type statusEntry struct {
	ID     string           `json:"id"`
	State  string           `json:"state"`
	Health string           `json:"health"`
	Setup  stepstatus.Setup `json:"setup"`
}

func readyStatus(apps []statusEntry, expected []string) bool {
	if len(apps) != len(expected) {
		return false
	}
	seen := map[string]bool{}
	for _, a := range apps {
		if seen[a.ID] || a.Setup != stepstatus.SetupOK || a.Health == "unhealthy" || a.Health == "starting" || a.Health == "broken" {
			return false
		}
		if a.State != "running" && !((a.ID == "restic" || a.ID == "borgmatic" || a.ID == "renovate") && a.State == "exited") {
			return false
		}
		seen[a.ID] = true
	}
	for _, id := range expected {
		if !seen[id] {
			return false
		}
	}
	return len(expected) > 0
}

func safeCommand(args []string) []string {
	out := append([]string{}, args...)
	for i := range out {
		if i > 0 && out[i-1] == "--set-file" {
			if key, _, ok := strings.Cut(out[i], "="); ok {
				out[i] = key + "=<owned-credential>"
			}
		}
		if i > 0 && (out[i-1] == "--media-root" || out[i-1] == "--downloads-root" || out[i-1] == "-o") {
			out[i] = "<owned-path>"
		}
		if strings.HasSuffix(out[i], ".tar.zst") {
			out[i] = "<owned-backup>"
		}
	}
	return out
}

func expectedServices(t targetSpec) []string {
	c := catalog.Default()
	var out []string
	for _, id := range t.Apps {
		a, ok := c.App(id)
		if !ok {
			return nil
		}
		var doc struct {
			Services map[string]any `yaml:"services"`
		}
		if yaml.Unmarshal([]byte(a.Compose(app.RenderContext{Port: 30001, Inputs: appInputTable[id].local})), &doc) != nil {
			return nil
		}
		for name := range doc.Services {
			out = append(out, name)
		}
	}
	if slices.Contains(t.Apps, "passbolt") {
		out = append(out, "passbolt-prerequisites")
	}
	if slices.Contains(t.Apps, "wud") {
		out = append(out, "wud-facade")
	}
	return out
}

type containerEntry struct {
	Service  string
	State    string
	Health   string
	ExitCode *int
}

func containersReadyJSON(text string, expected []string) bool {
	var rows []containerEntry
	if strings.HasPrefix(strings.TrimSpace(text), "[") {
		if json.Unmarshal([]byte(text), &rows) != nil {
			return false
		}
	} else {
		decoder := json.NewDecoder(strings.NewReader(text))
		for {
			var row containerEntry
			err := decoder.Decode(&row)
			if err == io.EOF {
				break
			}
			if err != nil {
				return false
			}
			rows = append(rows, row)
		}
	}
	seen := map[string]bool{}
	for _, row := range rows {
		if row.Service == "archive-team-warrior-init" && row.State != "exited" {
			return false
		}
		if seen[row.Service] || row.Health == "unhealthy" || row.Health == "starting" {
			return false
		}
		if row.State != "running" && !(row.State == "exited" && row.ExitCode != nil && *row.ExitCode == 0 && (row.Service == "restic" || row.Service == "borgmatic" || row.Service == "renovate" || row.Service == "archive-team-warrior-init")) {
			return false
		}
		seen[row.Service] = true
	}
	for _, service := range expected {
		if !seen[service] {
			return false
		}
	}
	return len(expected) > 0 && len(seen) == len(expected)
}

func isolatedEnvironment(env []string) []string {
	// The Docker connection is retained; ambient Compose settings and catalog
	// credentials cannot redirect the owned Project or override loopback binds.
	blocked := map[string]bool{"TZ": true, "PUID": true, "PGID": true, "UMASK": true, "LAN_IP": true, "EXPOSURE": true, "BIND_IP": true, "MEDIA_ROOT": true, "DOWNLOADS_ROOT": true, "ADMIN_USER": true, "ADMIN_PASSWORD": true}
	prefixes := []string{"SELF_HOST_", "COMPOSE_"}
	for _, a := range catalog.Default().AllApps() {
		prefixes = append(prefixes, strings.ToUpper(strings.ReplaceAll(a.Info().ID, "-", "_"))+"_")
	}
	var out []string
	for _, entry := range env {
		key, _, _ := strings.Cut(entry, "=")
		skip := blocked[key]
		for _, prefix := range prefixes {
			if strings.HasPrefix(key, prefix) {
				skip = true
				break
			}
		}
		if !skip {
			out = append(out, entry)
		}
	}
	return out
}

func completeImageEvidence(images []imageEvidence, expected []string) bool {
	seen := map[string]bool{}
	for _, image := range images {
		if seen[image.Service] || !strings.HasPrefix(image.ID, "sha256:") || len(image.ID) != 71 || !strings.Contains(image.Platform, "/") {
			return false
		}
		if _, err := hex.DecodeString(strings.TrimPrefix(image.ID, "sha256:")); err != nil {
			return false
		}
		seen[image.Service] = true
	}
	for _, service := range expected {
		if !seen[service] {
			return false
		}
	}
	return len(expected) > 0 && len(seen) == len(expected)
}

// These are structured CLI Logger events whose Error/Hint have already passed
// registered-secret redaction. Raw command output is never copied here.
func redactedFailures(emitted []event, expected []string) []failureEvidence {
	owned := map[string]bool{}
	for _, id := range expected {
		owned[id] = true
	}
	var out []failureEvidence
	for _, e := range emitted {
		if e.Event == events.StepFail && owned[e.App] && e.Step != "" && e.Error != "" {
			out = append(out, failureEvidence{Kind: "step.fail", App: e.App, Step: e.Step, Error: e.Error, Hint: e.Hint})
		}
	}
	if len(out) > 0 {
		return out
	}
	for _, e := range emitted {
		if (e.Event == events.RunEnd || e.Event == "run.error") && e.Error != "" && (e.App == "" || owned[e.App]) {
			out = append(out, failureEvidence{Kind: "run.error", Error: e.Error, Hint: e.Hint})
		}
	}
	return out
}

func compactDiagnostic(text string) string {
	text = strings.Join(strings.Fields(text), " ")
	const limit = 600
	if len(text) > limit {
		return text[:limit] + "…"
	}
	return text
}
