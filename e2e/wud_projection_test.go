package e2e

import (
	"bytes"
	"encoding/json"
	"strings"
	"testing"
	"text/template"
	"time"
)

func TestWUDImageProjectionAcceptsTypedDockerMetadataWithoutVariant(t *testing.T) {
	// Docker 29.3 executes the format against image.InspectResponse first,
	// then raw JSON with missingkey=error on any typed execution failure.
	// ID's Go name differs from its JSON name; empty Variant is omitted in JSON.
	for _, variant := range []string{"", "v8"} {
		t.Run("variant="+variant, func(t *testing.T) {
			image := struct {
				ID                        string `json:"Id"`
				RepoTags, RepoDigests     []string
				Architecture, Os, Created string
				Variant                   string `json:",omitempty"`
			}{ID: "sha256:" + strings.Repeat("b", 64), RepoTags: []string{"binwiederhier/ntfy:latest"}, RepoDigests: []string{"binwiederhier/ntfy@sha256:" + strings.Repeat("c", 64)}, Architecture: "arm64", Os: "linux", Created: "2026-10-07T00:00:00Z", Variant: variant}
			if variant == "" {
				image.Architecture = "amd64"
			}
			tmpl, err := template.New("docker-image-inspect").Funcs(template.FuncMap{"json": func(v any) string { b, _ := json.Marshal(v); return string(b) }}).Parse(wudImageProjection)
			if err != nil {
				t.Fatal(err)
			}
			var out bytes.Buffer
			if err = tmpl.Execute(&out, image); err != nil {
				out.Reset()
				rawJSON, _ := json.Marshal(image)
				var raw map[string]any
				if err = json.Unmarshal(rawJSON, &raw); err != nil {
					t.Fatal(err)
				}
				if err = tmpl.Option("missingkey=error").Execute(&out, raw); err != nil {
					t.Fatalf("owned image projection failed Docker's typed/raw contract: %v", err)
				}
			}
			id := strings.Repeat("a", 64)
			container, _ := json.Marshal(map[string]any{"ID": id, "ImageID": image.ID, "Image": "binwiederhier/ntfy:latest", "Name": "/owned-test-ntfy-1", "Project": "owned-test", "Service": "ntfy", "Watch": "true", "Digest": "false", "Running": true})
			snapshot, err := decodeWUDObservation(container, out.Bytes(), "owned-test", id, 1, time.Now().UTC())
			if err != nil || snapshot.Variant != variant || snapshot.ImageID != image.ID {
				t.Fatal("typed Docker image projection was rejected or altered")
			}
		})
	}
}
