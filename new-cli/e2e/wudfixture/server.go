// Package wudfixture exposes one fresh owned container and image, never a Docker socket.
package wudfixture

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"os"
	"regexp"
	"strings"
	"time"
)

const MaxAge = 60 * time.Second
const MaxSnapshotBytes = 64 << 10

var idPattern = regexp.MustCompile(`^[a-f0-9]{64}$`)
var versionPattern = regexp.MustCompile(`^v1\.[0-9]{1,3}$`)

type Snapshot struct {
	Generation                                                 uint64
	ObservedAt                                                 time.Time
	Project, Service, ContainerID, ImageID, Image, Name, State string
	RepoTags, RepoDigests                                      []string
	Architecture, OS, Variant, Created                         string
}

func (s Snapshot) Valid(project string, now time.Time) bool {
	if s.Generation == 0 || s.Project != project || project == "" || s.Service != "ntfy" || !idPattern.MatchString(s.ContainerID) || !strings.HasPrefix(s.ImageID, "sha256:") || !idPattern.MatchString(strings.TrimPrefix(s.ImageID, "sha256:")) {
		return false
	}
	if s.Image != "binwiederhier/ntfy:latest" || s.State != "running" || !strings.HasPrefix(s.Name, "/"+project+"-") || s.OS != "linux" || (s.Architecture != "amd64" && s.Architecture != "arm64") {
		return false
	}
	if now.Sub(s.ObservedAt) > MaxAge || s.ObservedAt.After(now.Add(5*time.Second)) || len(s.RepoTags) == 0 || len(s.RepoTags) > 8 || len(s.RepoDigests) > 8 {
		return false
	}
	found := false
	for _, tag := range s.RepoTags {
		if tag == s.Image {
			found = true
		}
		if len(tag) > 256 || strings.ContainsAny(tag, "\r\n") {
			return false
		}
	}
	for _, digest := range s.RepoDigests {
		parts := strings.Split(digest, "@sha256:")
		if len(parts) != 2 || parts[0] != "binwiederhier/ntfy" || !idPattern.MatchString(parts[1]) {
			return false
		}
	}
	_, err := time.Parse(time.RFC3339Nano, s.Created)
	return found && err == nil && len(s.Variant) < 16
}

func ReadSnapshot(path string) (Snapshot, error) {
	f, err := os.Open(path)
	if err != nil {
		return Snapshot{}, errors.New("owned snapshot unavailable")
	}
	defer f.Close()
	info, err := f.Stat()
	if err != nil || !info.Mode().IsRegular() || info.Size() > MaxSnapshotBytes {
		return Snapshot{}, errors.New("invalid owned snapshot")
	}
	d := json.NewDecoder(io.LimitReader(f, MaxSnapshotBytes+1))
	d.DisallowUnknownFields()
	var s Snapshot
	if d.Decode(&s) != nil || d.Decode(new(any)) != io.EOF {
		return Snapshot{}, errors.New("invalid owned snapshot")
	}
	return s, nil
}

func NewHandler(load func() (Snapshot, error), project string) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		deny := func(code int) { w.WriteHeader(code) }
		if r.Method != "GET" {
			deny(403)
			return
		}
		path := r.URL.Path
		parts := strings.Split(strings.TrimPrefix(path, "/"), "/")
		if len(parts) > 1 && strings.HasPrefix(parts[0], "v") {
			if !versionPattern.MatchString(parts[0]) {
				deny(403)
				return
			}
			path = "/" + strings.Join(parts[1:], "/")
		}
		q := r.URL.Query()
		if r.URL.RawQuery != "" && (path != "/containers/json" || len(q) != 1 || len(q["all"]) != 1 || (q.Get("all") != "1" && q.Get("all") != "true")) {
			deny(403)
			return
		}
		// Reject all APIs outside the fixed grammar before loading observations.
		if path != "/version" && path != "/info" && path != "/containers/json" && !(strings.HasPrefix(path, "/containers/") && strings.HasSuffix(path, "/json")) && !(strings.HasPrefix(path, "/images/") && strings.HasSuffix(path, "/json")) {
			deny(403)
			return
		}
		s, err := load()
		if err != nil || !s.Valid(project, time.Now()) {
			deny(503)
			return
		}
		labels := map[string]string{"com.docker.compose.project": s.Project, "com.docker.compose.service": s.Service, "wud.watch": "true", "wud.watch.digest": "false"}
		container := map[string]any{"Id": s.ContainerID, "Names": []string{s.Name}, "State": s.State, "Image": s.Image, "ImageID": s.ImageID, "Labels": labels}
		var response any
		switch path {
		case "/version":
			response = map[string]string{"ApiVersion": "1.41", "MinAPIVersion": "1.24", "Version": "owned-read-only-facade", "Os": s.OS, "Arch": s.Architecture}
		case "/info":
			response = map[string]any{"Containers": 1, "ContainersRunning": 1, "OSType": s.OS, "Architecture": s.Architecture}
		case "/containers/json":
			response = []any{container}
		case "/containers/" + s.ContainerID + "/json":
			response = map[string]any{"Id": s.ContainerID, "Name": s.Name, "Image": s.ImageID, "State": map[string]any{"Running": true, "Status": "running"}, "Config": map[string]any{"Image": s.Image, "Labels": labels}}
		case "/images/" + s.ImageID + "/json", "/images/" + s.Image + "/json":
			image := map[string]any{"Id": s.ImageID, "RepoTags": s.RepoTags, "RepoDigests": s.RepoDigests, "Architecture": s.Architecture, "Os": s.OS, "Created": s.Created}
			// Docker omits an empty variant; WUD rejects an explicitly empty
			// optional string while normalizing its container image inventory.
			if s.Variant != "" {
				image["Variant"] = s.Variant
			}
			response = image
		default:
			deny(403)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("Cache-Control", "no-store")
		json.NewEncoder(w).Encode(response)
	})
}
