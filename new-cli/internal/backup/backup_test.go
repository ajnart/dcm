package backup

import (
	"archive/tar"
	"bytes"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/klauspost/compress/zstd"
)

type archiveEntry struct {
	name, link, data string
	kind             byte
}

func openArchive(t *testing.T, entries ...archiveEntry) *Reader {
	t.Helper()
	var data bytes.Buffer
	zw, err := zstd.NewWriter(&data)
	if err != nil {
		t.Fatal(err)
	}
	tw := tar.NewWriter(zw)
	manifest := `{"version":1,"apps":[{"id":"one"}]}`
	if err := tw.WriteHeader(&tar.Header{Name: ManifestName, Mode: 0600, Size: int64(len(manifest))}); err != nil {
		t.Fatal(err)
	}
	if _, err := tw.Write([]byte(manifest)); err != nil {
		t.Fatal(err)
	}
	for _, e := range entries {
		h := &tar.Header{Name: e.name, Typeflag: e.kind, Linkname: e.link, Mode: 0600}
		if e.kind == tar.TypeReg {
			h.Size = int64(len(e.data))
		}
		if err := tw.WriteHeader(h); err != nil {
			t.Fatal(err)
		}
		if e.kind == tar.TypeReg {
			if _, err := tw.Write([]byte(e.data)); err != nil {
				t.Fatal(err)
			}
		}
	}
	if err := tw.Close(); err != nil {
		t.Fatal(err)
	}
	if err := zw.Close(); err != nil {
		t.Fatal(err)
	}
	r, err := Open(bytes.NewReader(data.Bytes()), "")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(r.Close)
	return r
}

func selectedDestination(root string) func(string) string {
	return func(name string) string {
		if name == "apps/one" || strings.HasPrefix(name, "apps/one/") {
			return filepath.Join(root, filepath.FromSlash(name))
		}
		return ""
	}
}

func TestExtractRejectsSymlinkWrites(t *testing.T) {
	for _, destination := range []bool{false, true} {
		name := "ancestor"
		if destination {
			name = "destination"
		}
		t.Run(name, func(t *testing.T) {
			staging, outside := t.TempDir(), t.TempDir()
			sentinel := filepath.Join(outside, "sentinel")
			if err := os.WriteFile(sentinel, []byte("original"), 0600); err != nil {
				t.Fatal(err)
			}
			link, target := outside, "apps/one/config/created"
			if destination {
				link, target = sentinel, "apps/one/config"
			}
			r := openArchive(t, archiveEntry{name: "apps/one/config", link: link, kind: tar.TypeSymlink}, archiveEntry{name: target, data: "corrupt", kind: tar.TypeReg})
			err := r.Extract(staging, selectedDestination(staging), nil)
			if err == nil {
				t.Error("unsafe archive accepted")
			}
			data, readErr := os.ReadFile(sentinel)
			if readErr != nil || string(data) != "original" {
				t.Errorf("outside sentinel changed: %q, %v", data, readErr)
			}
			if _, err := os.Stat(filepath.Join(outside, "created")); !os.IsNotExist(err) {
				t.Errorf("outside file created: %v", err)
			}
		})
	}
}

func TestExtractRetainsContainedLinksAndData(t *testing.T) {
	staging := t.TempDir()
	r := openArchive(t,
		archiveEntry{name: "apps/one/current", link: "config", kind: tar.TypeSymlink},
		archiveEntry{name: "apps/one/config/settings", data: "restored", kind: tar.TypeReg},
	)
	if err := r.Extract(staging, selectedDestination(staging), nil); err != nil {
		t.Fatal(err)
	}
	data, err := os.ReadFile(filepath.Join(staging, "apps/one/current/settings"))
	if err != nil || string(data) != "restored" {
		t.Fatalf("contained link failed: %q, %v", data, err)
	}
	link, err := os.Readlink(filepath.Join(staging, "apps/one/current"))
	if err != nil || link != "config" {
		t.Fatalf("link not retained: %q, %v", link, err)
	}
}

func TestExtractRejectsWritesThroughContainedLinks(t *testing.T) {
	for _, kind := range []byte{tar.TypeReg, tar.TypeDir, tar.TypeSymlink} {
		for _, target := range []string{"apps/one/current", "apps/one/current/settings"} {
			t.Run(target+"/"+string(kind), func(t *testing.T) {
				staging := t.TempDir()
				r := openArchive(t,
					archiveEntry{name: "apps/one/config/settings", data: "original", kind: tar.TypeReg},
					archiveEntry{name: "apps/one/current", link: "config", kind: tar.TypeSymlink},
					archiveEntry{name: target, link: "config", data: "corrupt", kind: kind},
				)
				if err := r.Extract(staging, selectedDestination(staging), nil); err == nil || !strings.Contains(err.Error(), "symlink") {
					t.Fatalf("expected symlink error, got %v", err)
				}
				data, err := os.ReadFile(filepath.Join(staging, "apps/one/config/settings"))
				if err != nil || string(data) != "original" {
					t.Fatalf("contained data changed: %q, %v", data, err)
				}
			})
		}
	}
}

func TestExtractRejectsUnsafeArchiveEntries(t *testing.T) {
	for _, entry := range []archiveEntry{
		{name: "/apps/one/file", kind: tar.TypeReg},
		{name: "../outside", kind: tar.TypeReg},
		{name: "apps/one/../../outside", kind: tar.TypeReg},
		{name: "apps/one/link", link: "../../../outside", kind: tar.TypeSymlink},
		{name: "apps/one/link", link: "../../two/config", kind: tar.TypeSymlink},
		{name: "apps/one/link", link: "/tmp/outside", kind: tar.TypeLink},
		{name: "apps/one/fifo", kind: tar.TypeFifo},
	} {
		t.Run(entry.name+"/"+entry.link+"/"+string(entry.kind), func(t *testing.T) {
			staging := t.TempDir()
			r := openArchive(t, entry)
			if err := r.Extract(staging, selectedDestination(staging), nil); err == nil {
				t.Fatal("unsafe entry accepted")
			}
		})
	}
}

func TestExtractRefusesAbsoluteSymlinkWithPolicy(t *testing.T) {
	staging := t.TempDir()
	r := openArchive(t, archiveEntry{name: "apps/one/link", link: "/tmp/outside", kind: tar.TypeSymlink})
	err := r.Extract(staging, selectedDestination(staging), nil)
	if err == nil {
		t.Fatal("absolute symlink accepted")
	}
	if !strings.Contains(err.Error(), "apps/one/link") || !strings.Contains(err.Error(), "docs/adr/0003") {
		t.Fatalf("absolute symlink error must name the link and the policy: %v", err)
	}
}

func TestAddTarRefusesAbsoluteSymlinkWithPolicy(t *testing.T) {
	var compressed, stream bytes.Buffer
	tw := tar.NewWriter(&stream)
	if err := tw.WriteHeader(&tar.Header{Name: "link", Linkname: "/tmp/outside", Mode: 0777, Typeflag: tar.TypeSymlink}); err != nil {
		t.Fatal(err)
	}
	if err := tw.Close(); err != nil {
		t.Fatal(err)
	}
	w, err := Create(&compressed, "", Manifest{Apps: []ManifestApp{{ID: "one", OwnershipNamespace: OwnershipDocker}}})
	if err != nil {
		t.Fatal(err)
	}
	defer w.Close()
	err = w.AddTar(&stream, "apps/one")
	if err == nil {
		t.Fatal("absolute symlink imported")
	}
	if !strings.Contains(err.Error(), "apps/one/link") || !strings.Contains(err.Error(), "docs/adr/0003") {
		t.Fatalf("absolute symlink error must name the link and the policy: %v", err)
	}
}

func TestAddTreeRefusesAbsoluteSymlinkWithPolicy(t *testing.T) {
	source := t.TempDir()
	if err := os.Symlink("/tmp/outside", filepath.Join(source, "link")); err != nil {
		t.Fatal(err)
	}
	var compressed bytes.Buffer
	w, err := Create(&compressed, "", Manifest{Apps: []ManifestApp{{ID: "one"}}})
	if err != nil {
		t.Fatal(err)
	}
	defer w.Close()
	err = w.AddTree(source, "apps/one")
	if err == nil {
		t.Fatal("absolute symlink archived")
	}
	if !strings.Contains(err.Error(), "apps/one/link") || !strings.Contains(err.Error(), "docs/adr/0003") {
		t.Fatalf("absolute symlink error must name the link and the policy: %v", err)
	}
}

func TestAddTreeRefusesEscapingRelativeSymlinkWithPolicy(t *testing.T) {
	source := t.TempDir()
	if err := os.MkdirAll(filepath.Join(source, "sub"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink("../../outside", filepath.Join(source, "sub", "link")); err != nil {
		t.Fatal(err)
	}
	var compressed bytes.Buffer
	w, err := Create(&compressed, "", Manifest{Apps: []ManifestApp{{ID: "one"}}})
	if err != nil {
		t.Fatal(err)
	}
	defer w.Close()
	err = w.AddTree(source, "apps/one")
	if err == nil {
		t.Fatal("escaping relative symlink archived")
	}
	if !strings.Contains(err.Error(), "apps/one/sub/link") || !strings.Contains(err.Error(), "docs/adr/0003") {
		t.Fatalf("escaping symlink error must name the link and the policy: %v", err)
	}
}

func TestAddTreeKeepsContainedRelativeSymlink(t *testing.T) {
	source := t.TempDir()
	if err := os.WriteFile(filepath.Join(source, "config"), []byte("data"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink("config", filepath.Join(source, "current")); err != nil {
		t.Fatal(err)
	}
	var compressed bytes.Buffer
	w, err := Create(&compressed, "", Manifest{Apps: []ManifestApp{{ID: "one"}}})
	if err != nil {
		t.Fatal(err)
	}
	if err := w.AddTree(source, "apps/one"); err != nil {
		t.Fatalf("contained relative symlink refused: %v", err)
	}
	if err := w.Close(); err != nil {
		t.Fatal(err)
	}
	r, err := Open(bytes.NewReader(compressed.Bytes()), "")
	if err != nil {
		t.Fatal(err)
	}
	defer r.Close()
	staging := t.TempDir()
	if err := r.Extract(staging, selectedDestination(staging), nil); err != nil {
		t.Fatal(err)
	}
	if link, err := os.Readlink(filepath.Join(staging, "apps/one/current")); err != nil || link != "config" {
		t.Fatalf("contained link not archived: %q, %v", link, err)
	}
}

func TestExtractRejectsPreexistingSymlinks(t *testing.T) {
	for _, ancestor := range []bool{false, true} {
		name := "destination"
		if ancestor {
			name = "ancestor"
		}
		t.Run(name, func(t *testing.T) {
			staging, outside := t.TempDir(), t.TempDir()
			sentinel := filepath.Join(outside, "sentinel")
			if err := os.WriteFile(sentinel, []byte("original"), 0600); err != nil {
				t.Fatal(err)
			}
			if err := os.MkdirAll(filepath.Join(staging, "apps/one"), 0700); err != nil {
				t.Fatal(err)
			}
			link, target := sentinel, "apps/one/config"
			if ancestor {
				link, target = outside, "apps/one/config/created"
			}
			if err := os.Symlink(link, filepath.Join(staging, "apps/one/config")); err != nil {
				t.Fatal(err)
			}
			r := openArchive(t, archiveEntry{name: target, data: "corrupt", kind: tar.TypeReg})
			if err := r.Extract(staging, selectedDestination(staging), nil); err == nil {
				t.Fatal("preexisting symlink accepted")
			}
			data, err := os.ReadFile(sentinel)
			if err != nil || string(data) != "original" {
				t.Fatalf("outside sentinel changed: %q, %v", data, err)
			}
			if _, err := os.Stat(filepath.Join(outside, "created")); !os.IsNotExist(err) {
				t.Fatalf("outside file created: %v", err)
			}
		})
	}
}

func TestExtractRejectsResolverOutsideRoot(t *testing.T) {
	staging, outside := t.TempDir(), t.TempDir()
	r := openArchive(t, archiveEntry{name: "apps/one/settings", data: "corrupt", kind: tar.TypeReg})
	err := r.Extract(staging, func(string) string { return filepath.Join(outside, "created") }, nil)
	if err == nil {
		t.Fatal("resolver destination outside root accepted")
	}
	if _, err := os.Stat(filepath.Join(outside, "created")); !os.IsNotExist(err) {
		t.Fatalf("outside file created: %v", err)
	}
}

func TestExtractReplacesHardlinkedDestinationWithoutTruncatingOutside(t *testing.T) {
	staging, outside := t.TempDir(), t.TempDir()
	sentinel := filepath.Join(outside, "sentinel")
	if err := os.WriteFile(sentinel, []byte("original"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Join(staging, "apps/one"), 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.Link(sentinel, filepath.Join(staging, "apps/one/settings")); err != nil {
		t.Fatal(err)
	}
	r := openArchive(t, archiveEntry{name: "apps/one/settings", data: "restored", kind: tar.TypeReg})
	if err := r.Extract(staging, selectedDestination(staging), nil); err != nil {
		t.Fatal(err)
	}
	data, err := os.ReadFile(sentinel)
	if err != nil || string(data) != "original" {
		t.Fatalf("outside sentinel changed: %q, %v", data, err)
	}
}

func TestExtractRejectsLinkChainEscapeRegardlessOfOrder(t *testing.T) {
	for _, reverse := range []bool{false, true} {
		name := "link-before-alias"
		if reverse {
			name = "alias-before-link"
		}
		t.Run(name, func(t *testing.T) {
			staging := t.TempDir()
			links := []archiveEntry{
				{name: "apps/one/link", link: "deep1/deep2/../../../one/file", kind: tar.TypeSymlink},
				{name: "apps/one/deep1/deep2", link: "../..", kind: tar.TypeSymlink},
			}
			if reverse {
				links[0], links[1] = links[1], links[0]
			}
			r := openArchive(t, links...)
			if err := r.Extract(staging, selectedDestination(staging), nil); err == nil {
				t.Fatal("link chain escaping staging accepted")
			}
		})
	}
}
