package e2e

import (
	"encoding/json"
	"errors"
	"fmt"
	"github.com/ajnart/self-host/e2e/wudfixture"
	"go.yaml.in/yaml/v3"
	"os"
	"path/filepath"
	"strings"
	"time"
)

type wudFixtureFiles struct {
	dir, observed, binary string
	material              wudfixture.Material
}

func writeWUDDockerWrapper(root, project, name, real, override string) (string, error) {
	if !filepath.IsAbs(project) || !filepath.IsAbs(real) || !filepath.IsAbs(override) {
		return "", errors.New("invalid owned WUD selectors")
	}
	bin := filepath.Join(root, "wud-bin")
	if err := os.MkdirAll(bin, 0700); err != nil {
		return "", err
	}
	config, _ := json.Marshal(map[string]string{"project": project, "name": name, "real": real, "override": override, "registry": filepath.Join(root, "wud-backup-helper-names")})
	guard := strings.ReplaceAll(netBirdDockerGuard, "NetBird", "WUD")
	guard = strings.Replace(guard, "if val!=c['project']+'/compose.yml': deny()", "if val not in (c['project']+'/compose.yml',c['override']): deny()", 1)
	guard = strings.ReplaceAll(guard, "netbird", "wud")
	guard = strings.Replace(guard, "relative!='apps/wud'", "relative not in ('apps/wud','apps/ntfy')", 1)
	guard = strings.Replace(guard, "(apps/wud|replaced-wud)", "(apps/(wud|ntfy)|replaced-(wud|ntfy))", 1)
	wrapper := filepath.Join(bin, "docker")
	script := "#!/usr/bin/env python3\nimport csv,json,os,re,sys\nc=json.loads(" + fmt.Sprintf("%q", string(config)) + ")\n" + guard
	return wrapper, os.WriteFile(wrapper, []byte(script), 0700)
}
func (f *wudFixtureFiles) compose(project string) (string, error) {
	document := map[string]any{"services": map[string]any{
		"ntfy": map[string]any{"labels": map[string]string{"wud.watch": "true", "wud.watch.digest": "false"}},
		"wud-facade": map[string]any{"image": passboltFixtureImage, "entrypoint": []string{"/fixture/helper"}, "command": []string{"-project", project}, "read_only": true, "user": "0:0", "restart": "unless-stopped", "cap_drop": []string{"ALL"}, "security_opt": []string{"no-new-privileges:true"}, "mem_limit": "64m", "cpus": 0.25, "pids_limit": 32, "volumes": []any{
			map[string]any{"type": "bind", "source": f.dir, "target": "/fixture", "read_only": true}, map[string]any{"type": "bind", "source": f.observed, "target": "/observed", "read_only": true}}, "networks": map[string]any{"default": map[string]any{"aliases": []string{wudfixture.Host}}}},
	}}
	b, err := yaml.Marshal(document)
	return string(b), err
}

func wudOwnedID(id string) bool {
	if len(id) != 64 {
		return false
	}
	for _, c := range id {
		if !(c >= '0' && c <= '9') && !(c >= 'a' && c <= 'f') {
			return false
		}
	}
	return true
}
func decodeWUDObservation(container, image []byte, project, id string, generation uint64, observed time.Time) (wudfixture.Snapshot, error) {
	var c struct {
		ID, ImageID, Image, Name, Project, Service, Watch, Digest string
		Running                                                   bool
	}
	fail := func() (wudfixture.Snapshot, error) {
		return wudfixture.Snapshot{}, errors.New("invalid owned WUD observation")
	}
	if len(container) > wudfixture.MaxSnapshotBytes || len(image) > wudfixture.MaxSnapshotBytes || json.Unmarshal(container, &c) != nil || c.ID != id || !wudOwnedID(id) || c.Project != project || c.Service != "ntfy" || c.Watch != "true" || c.Digest != "false" || !c.Running {
		return fail()
	}
	var s wudfixture.Snapshot
	if json.Unmarshal(image, &s) != nil || s.ImageID != c.ImageID {
		return fail()
	}
	s.Generation = generation
	s.ObservedAt = observed
	s.Project = c.Project
	s.Service = c.Service
	s.ContainerID = c.ID
	s.Image = c.Image
	s.Name = c.Name
	s.State = "running"
	if !s.Valid(project, observed) {
		return fail()
	}
	return s, nil
}
