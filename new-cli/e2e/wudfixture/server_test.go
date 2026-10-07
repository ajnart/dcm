package wudfixture

import (
	"encoding/json"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func sample() Snapshot {
	return Snapshot{Generation: 1, ObservedAt: time.Now().UTC(), Project: "owned-test", Service: "ntfy", ContainerID: strings.Repeat("a", 64), ImageID: "sha256:" + strings.Repeat("b", 64), Image: "binwiederhier/ntfy:latest", Name: "/owned-test-ntfy-1", State: "running", RepoTags: []string{"binwiederhier/ntfy:latest"}, Architecture: "amd64", OS: "linux", Created: "2026-10-07T00:00:00Z"}
}

func TestStrictOwnedProjection(t *testing.T) {
	s := sample()
	h := NewHandler(func() (Snapshot, error) { return s, nil }, "owned-test")
	for _, path := range []string{"/version", "/v1.41/info", "/v1.41/containers/json?all=1", "/containers/" + s.ContainerID + "/json", "/images/" + s.ImageID + "/json", "/images/binwiederhier/ntfy:latest/json"} {
		w := httptest.NewRecorder()
		h.ServeHTTP(w, httptest.NewRequest("GET", path, nil))
		if w.Code != 200 {
			t.Fatalf("allowed path %s: %d", path, w.Code)
		}
		if strings.Contains(w.Body.String(), "Env") || strings.Contains(w.Body.String(), "Mounts") {
			t.Fatal("private fields exposed")
		}
		var v any
		if json.Unmarshal(w.Body.Bytes(), &v) != nil {
			t.Fatal("invalid JSON")
		}
	}
	for _, path := range []string{"/containers/unowned/json", "/images/alpine/json", "/containers/json?filters=anything", "/containers/" + s.ContainerID + "/logs", "/v1.bad/info", "/events", "/containers/" + s.ContainerID + "/archive"} {
		w := httptest.NewRecorder()
		h.ServeHTTP(w, httptest.NewRequest("GET", path, nil))
		if w.Code != 403 {
			t.Fatalf("forbidden path %s: %d", path, w.Code)
		}
	}
	w := httptest.NewRecorder()
	h.ServeHTTP(w, httptest.NewRequest("POST", "/containers/json", nil))
	if w.Code != 403 {
		t.Fatal("mutation allowed")
	}
	s.Project = "unowned"
	w = httptest.NewRecorder()
	h.ServeHTTP(w, httptest.NewRequest("GET", "/containers/json", nil))
	if w.Code != 503 {
		t.Fatal("unowned snapshot accepted")
	}
	s = sample()
	s.ObservedAt = time.Now().Add(-2 * time.Minute)
	w = httptest.NewRecorder()
	h.ServeHTTP(w, httptest.NewRequest("GET", "/containers/json", nil))
	if w.Code != 503 {
		t.Fatal("stale snapshot accepted")
	}
}

func TestSnapshotFileRejectsPrivateFieldsAndOversizedInput(t *testing.T) {
	path := filepath.Join(t.TempDir(), "snapshot.json")
	good, _ := json.Marshal(sample())
	for _, data := range [][]byte{append(append([]byte{}, good...), []byte("{}")...), []byte(`{"Env":["private"]}`), append(good, []byte(strings.Repeat(" ", MaxSnapshotBytes))...)} {
		if os.WriteFile(path, data, 0600) != nil {
			t.Fatal("write fixture")
		}
		if _, err := ReadSnapshot(path); err == nil {
			t.Fatal("unexpected snapshot payload accepted")
		}
	}
	if os.WriteFile(path, good, 0600) != nil {
		t.Fatal("write fixture")
	}
	if _, err := ReadSnapshot(path); err != nil {
		t.Fatal("bounded snapshot rejected")
	}
}

func TestImageInspectMatchesDockerOptionalVariantContract(t *testing.T) {
	// Docker omits an empty architecture variant. WUD 9.1.0 copies this field
	// into its optional Joi string; an explicitly empty value rejects inventory.
	for _, variant := range []string{"", "v8"} {
		t.Run("variant="+variant, func(t *testing.T) {
			snapshot := sample()
			snapshot.Variant = variant
			if variant != "" {
				snapshot.Architecture = "arm64"
			}
			handler := NewHandler(func() (Snapshot, error) { return snapshot, nil }, "owned-test")
			for _, selector := range []string{snapshot.ImageID, snapshot.Image} {
				response := httptest.NewRecorder()
				handler.ServeHTTP(response, httptest.NewRequest("GET", "/images/"+selector+"/json", nil))
				if response.Code != 200 {
					t.Fatal("owned image inspect was rejected")
				}
				var image map[string]json.RawMessage
				if err := json.Unmarshal(response.Body.Bytes(), &image); err != nil {
					t.Fatal(err)
				}
				value, present := image["Variant"]
				if variant == "" {
					if present {
						t.Fatal("empty optional variant must be omitted to match Docker and WUD's accepted inventory contract")
					}
				} else {
					var actual string
					if !present || json.Unmarshal(value, &actual) != nil || actual != variant {
						t.Fatal("real architecture variant was lost")
					}
				}
				var imageID string
				if json.Unmarshal(image["Id"], &imageID) != nil || imageID != snapshot.ImageID {
					t.Fatal("exact owned image identity changed")
				}
			}
		})
	}
}
