package e2e

import (
	"context"
	"encoding/json"
	"errors"
	"github.com/ajnart/self-host/internal/app"
	"github.com/ajnart/self-host/internal/catalog"
	"reflect"
	"strings"
	"testing"
)

func TestOwnedImageInspectionNormalizesFullComposeImageID(t *testing.T) {
	// Docker Compose 29 images -q emits the complete digest without its prefix.
	raw := "c83674e1999044d33d751661371b873539f47e5b5c5ca3320c7e0377acca6238"
	id := "sha256:" + raw
	inspected := false
	images, missing := observeOwnedImages(nil, []string{"homarr"}, func(string) string {
		return raw + "\n"
	}, func(args []string) string {
		inspected = true
		want := []string{"image", "inspect", "--format", "{{.Id}} {{.Os}}/{{.Architecture}}", id}
		if !reflect.DeepEqual(args, want) {
			t.Fatal("full Compose image ID was not inspected with its exact canonical selector")
		}
		return id + " linux/amd64"
	})
	if !inspected || len(images) != 1 || len(missing) != 0 || images[0].ID != id {
		t.Fatal("full unprefixed Compose image ID lost owned image proof")
	}
}

func TestFailedTargetRetainsAvailableImageEvidence(t *testing.T) {
	id := "sha256:" + strings.Repeat("a", 64)
	e := newEvidence(targetSpec{Apps: []string{"ntfy"}}, "fixture")
	e.Outcome = "failed"
	e.Images, e.UnavailableImages = observeOwnedImages(nil, []string{"missing", "ntfy"}, func(service string) string {
		if service == "ntfy" {
			return id
		}
		return "raw error with confidential text"
	}, func(args []string) string { return id + " linux/amd64" })
	data, _ := json.Marshal(e)
	var saved targetEvidence
	if json.Unmarshal(data, &saved) != nil || saved.Outcome != "failed" || len(saved.Images) != 1 || len(saved.UnavailableImages) != 1 || saved.UnavailableImages[0] != "missing" {
		t.Fatal("failed target lost exact available image or unavailable service evidence")
	}
	if strings.Contains(string(data), "confidential") {
		t.Fatal("raw observation output entered evidence")
	}
}

func TestOwnedImageInspectionRejectsUnsafeOutput(t *testing.T) {
	id := "sha256:" + strings.Repeat("b", 64)
	for _, output := range []string{"", "--format", id + " extra", "ntfy:latest", "sha256:" + strings.Repeat("z", 64), strings.Repeat("b", 12), strings.Repeat("b", 63), strings.Repeat("b", 65), strings.Repeat("z", 64), strings.Repeat("b", 64) + "\n" + strings.Repeat("c", 64)} {
		called := false
		images, missing := observeOwnedImages(nil, []string{"ntfy"}, func(string) string { return output }, func([]string) string { called = true; return id + " linux/amd64" })
		if called || len(images) != 0 || len(missing) != 1 {
			t.Fatal("unsafe image selector reached inspection")
		}
	}
	images, missing := observeOwnedImages(nil, []string{"ntfy"}, func(string) string { return id }, func(args []string) string {
		if strings.Join(args, " ") != "image inspect --format {{.Id}} {{.Os}}/{{.Architecture}} "+id {
			t.Fatal("inspection is not exact and narrowly formatted")
		}
		return id + " linux/amd64 confidential"
	})
	if len(images) != 0 || len(missing) != 1 {
		t.Fatal("untrusted formatter output accepted")
	}
}

func TestSafeBlockerReason(t *testing.T) {
	for _, tc := range []struct {
		err  error
		want string
	}{
		{context.DeadlineExceeded, "target capacity deadline exceeded"},
		{blockerError("haproxy: Compose isolation refused: external network namespace"), "haproxy: Compose isolation refused: external network namespace"},
		{errors.New("private endpoint credential"), "target blocked; unrecognized diagnostic omitted"},
	} {
		if got := safeBlockerReason(tc.err); got != tc.want {
			t.Fatalf("safe blocker reason = %q", got)
		}
	}
}

type isolationRefusalApp struct{ app.App }

func (isolationRefusalApp) Info() app.Info { return app.Info{ID: "fixture"} }
func (isolationRefusalApp) Compose(app.RenderContext) string {
	return "services:\n  fixture:\n    network_mode: host\n"
}

func TestIsolationRefusalRetainsSafeConcreteReason(t *testing.T) {
	c := catalog.New([]app.App{isolationRefusalApp{}}, nil)
	if _, err := reserveTargetPorts(c, targetSpec{Apps: []string{"fixture"}}); safeBlockerReason(err) != "fixture: Compose isolation refused: external network namespace" {
		t.Fatal("resource refusal discarded its exact safe reason")
	}
}

func TestEvidenceWriteFailureCannotPreventOwnedTeardown(t *testing.T) {
	for _, failDown := range []bool{false, true} {
		guard := &sweepGuard{}
		var order []string
		cleanupErr, publicationErr := cleanupObservedOwned(func() { order = append(order, "observe") }, func() error {
			order = append(order, "down")
			if failDown {
				return errors.New("owned down failed")
			}
			return nil
		}, func() { order = append(order, "remove") }, guard, "/tmp/owned-fixture", func(error) error {
			order = append(order, "publish")
			return errors.New("evidence filesystem full")
		})
		want := "observe,down,remove,publish"
		if failDown {
			want = "observe,down,publish"
		}
		if strings.Join(order, ",") != want || publicationErr == nil || (cleanupErr != nil) != failDown || guard.CanRunNext() == failDown {
			t.Fatal("evidence write interrupted cleanup or failed teardown lost its blocker")
		}
	}
}
