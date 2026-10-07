package backup

import (
	"archive/tar"
	"bytes"
	"encoding/json"
	"io"
	"os"
	"path/filepath"
	"testing"
)

func TestRootlessOwnershipNamespaceRoundTrip(t *testing.T) {
	var manifest Manifest
	if err := json.Unmarshal([]byte(`{"apps":[{"id":"one","ownership_namespace":"docker"}]}`), &manifest); err != nil {
		t.Fatal(err)
	}
	data, err := json.Marshal(manifest)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Contains(data, []byte(`"ownership_namespace":"docker"`)) {
		t.Fatalf("Docker ownership namespace lost: %s", data)
	}
}

func TestRootlessTarImportPreservesContainerMetadata(t *testing.T) {
	var compressed bytes.Buffer
	w, err := Create(&compressed, "", Manifest{Apps: []ManifestApp{{ID: "one"}}})
	if err != nil {
		t.Fatal(err)
	}
	var stream bytes.Buffer
	tw := tar.NewWriter(&stream)
	if err := tw.WriteHeader(&tar.Header{Name: "./database", Typeflag: tar.TypeDir, Mode: 0700, Uid: 999, Gid: 999}); err != nil {
		t.Fatal(err)
	}
	if err := tw.WriteHeader(&tar.Header{Name: "./database/row", Typeflag: tar.TypeReg, Mode: 0600, Uid: 999, Gid: 999, Size: 3}); err != nil {
		t.Fatal(err)
	}
	if _, err := tw.Write([]byte("row")); err != nil {
		t.Fatal(err)
	}
	if err := tw.Close(); err != nil {
		t.Fatal(err)
	}
	if err := w.AddTar(&stream, "apps/one"); err != nil {
		t.Fatal(err)
	}
	if err := w.Close(); err != nil {
		t.Fatal(err)
	}
	r, err := Open(bytes.NewReader(compressed.Bytes()), "")
	if err != nil {
		t.Fatal(err)
	}
	defer r.Close()
	h, err := r.tr.Next()
	if err != nil || h.Name != "apps/one/database" || h.Uid != 999 || h.Gid != 999 || h.Mode != 0700 {
		t.Fatalf("directory metadata lost: %+v, %v", h, err)
	}
	h, err = r.tr.Next()
	if err != nil || h.Name != "apps/one/database/row" || h.Uid != 999 || h.Gid != 999 || h.Mode != 0600 {
		t.Fatalf("row metadata lost: %+v, %v", h, err)
	}
	data, err := io.ReadAll(r.tr)
	if err != nil || string(data) != "row" {
		t.Fatalf("row contents lost: %q, %v", data, err)
	}
}

func TestRootlessTarImportRejectsUnsafeEntries(t *testing.T) {
	cases := []struct {
		name    string
		headers []*tar.Header
	}{
		{"traversal", []*tar.Header{{Name: "../outside", Mode: 0600, Typeflag: tar.TypeReg}}},
		{"absolute", []*tar.Header{{Name: "/outside", Mode: 0600, Typeflag: tar.TypeReg}}},
		{"link-escape", []*tar.Header{{Name: "link", Linkname: "../outside", Mode: 0777, Typeflag: tar.TypeSymlink}}},
		{"link-write", []*tar.Header{{Name: "link", Linkname: "config", Mode: 0777, Typeflag: tar.TypeSymlink}, {Name: "link/file", Mode: 0600, Typeflag: tar.TypeReg}}},
		{"link-overwrite", []*tar.Header{{Name: "link", Linkname: "config", Mode: 0777, Typeflag: tar.TypeSymlink}, {Name: "link", Mode: 0600, Typeflag: tar.TypeReg}}},
		{"hardlink", []*tar.Header{{Name: "link", Linkname: "config", Mode: 0600, Typeflag: tar.TypeLink}}},
		{"setuid", []*tar.Header{{Name: "config", Mode: 04755, Typeflag: tar.TypeReg}}},
		{"negative-owner", []*tar.Header{{Name: "config", Mode: 0600, Uid: -1, Typeflag: tar.TypeReg}}},
		{"large-owner", []*tar.Header{{Name: "config", Mode: 0600, Uid: 2147483648, Typeflag: tar.TypeReg}}},
		{"composed-escape", []*tar.Header{{Name: "link", Linkname: "deep1/deep2/../../outside", Mode: 0777, Typeflag: tar.TypeSymlink}, {Name: "deep1/deep2", Linkname: "../..", Mode: 0777, Typeflag: tar.TypeSymlink}}},
		{"cyclic", []*tar.Header{{Name: "link", Linkname: "other", Mode: 0777, Typeflag: tar.TypeSymlink}, {Name: "other", Linkname: "link", Mode: 0777, Typeflag: tar.TypeSymlink}}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			var stream, compressed bytes.Buffer
			tw := tar.NewWriter(&stream)
			for _, h := range tc.headers {
				if err := tw.WriteHeader(h); err != nil {
					t.Fatal(err)
				}
			}
			if err := tw.Close(); err != nil {
				t.Fatal(err)
			}
			w, err := Create(&compressed, "", Manifest{})
			if err != nil {
				t.Fatal(err)
			}
			defer w.Close()
			if err := w.AddTar(&stream, "apps/one"); err == nil {
				t.Fatal("unsafe helper stream imported")
			}
		})
	}
}

func TestRootlessExtractionJournalIsValidatedAndAppScoped(t *testing.T) {
	var stream, compressed bytes.Buffer
	tw := tar.NewWriter(&stream)
	headers := []*tar.Header{
		{Name: ".", Typeflag: tar.TypeDir, Mode: 0500, Uid: 999, Gid: 998},
		{Name: "database", Typeflag: tar.TypeDir, Mode: 0500, Uid: 999, Gid: 998},
		{Name: "database/private", Typeflag: tar.TypeDir, Mode: 0700, Uid: 999, Gid: 998},
		{Name: "database/private/row", Typeflag: tar.TypeReg, Mode: 0600, Uid: 999, Gid: 998, Size: 3},
		{Name: "current", Linkname: "database/private/row", Typeflag: tar.TypeSymlink, Mode: 0777, Uid: 999, Gid: 998},
	}
	for _, h := range headers {
		if err := tw.WriteHeader(h); err != nil {
			t.Fatal(err)
		}
		if h.Typeflag == tar.TypeReg {
			if _, err := tw.Write([]byte("row")); err != nil {
				t.Fatal(err)
			}
		}
	}
	if err := tw.Close(); err != nil {
		t.Fatal(err)
	}
	w, err := Create(&compressed, "", Manifest{Apps: []ManifestApp{{ID: "one", OwnershipNamespace: OwnershipDocker}, {ID: "two"}}})
	if err != nil {
		t.Fatal(err)
	}
	if err := w.AddTar(&stream, "apps/one"); err != nil {
		t.Fatal(err)
	}
	if err := w.AddBytes("apps/two/unselected", []byte("other"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := w.Close(); err != nil {
		t.Fatal(err)
	}
	r, err := Open(bytes.NewReader(compressed.Bytes()), "")
	if err != nil {
		t.Fatal(err)
	}
	defer r.Close()
	if _, err := r.AppMetadata("one"); err == nil {
		t.Fatal("journal exposed before extraction validation")
	}
	staging := t.TempDir()
	if err := r.Extract(staging, selectedDestination(staging), nil); err != nil {
		t.Fatal(err)
	}
	entries, err := r.AppMetadata("one")
	if err != nil {
		t.Fatal(err)
	}
	expected := []string{"current", "database/private/row", "database/private", "database", "."}
	if len(entries) != len(expected) {
		t.Fatalf("unexpected journal: %+v", entries)
	}
	for i, e := range entries {
		if e.Path != expected[i] || e.UID != 999 || e.GID != 998 {
			t.Fatalf("unexpected journal entry %d: %+v", i, e)
		}
	}
	if entries[1].Mode != 0600 || entries[3].Mode != 0500 || entries[0].Type != tar.TypeSymlink {
		t.Fatalf("metadata lost: %+v", entries)
	}
	if entries, err := r.AppMetadata("two"); err != nil || len(entries) != 0 {
		t.Fatalf("unselected App journal exposed: %+v, %v", entries, err)
	}
	for _, invalid := range []string{"../one", "one/../two", "", "missing"} {
		if _, err := r.AppMetadata(invalid); err == nil {
			t.Fatalf("invalid App journal accepted: %q", invalid)
		}
	}
}

func TestRootlessFailedExtractionNeverExposesJournal(t *testing.T) {
	r := openArchive(t, archiveEntry{name: "apps/one/valid", data: "row", kind: tar.TypeReg}, archiveEntry{name: "apps/one/unsafe", link: "../../../outside", kind: tar.TypeSymlink})
	staging := t.TempDir()
	if err := r.Extract(staging, selectedDestination(staging), nil); err == nil {
		t.Fatal("unsafe extraction succeeded")
	}
	if _, err := r.AppMetadata("one"); err == nil {
		t.Fatal("partial unvalidated journal exposed")
	}
}

func TestRootlessImportPrefixCannotEscape(t *testing.T) {
	for _, prefix := range []string{".", "../outside", "/outside", "apps/one/../../outside"} {
		var compressed bytes.Buffer
		w, err := Create(&compressed, "", Manifest{})
		if err != nil {
			t.Fatal(err)
		}
		if err := w.AddTar(bytes.NewReader(nil), prefix); err == nil {
			t.Fatalf("unsafe prefix accepted: %q", prefix)
		}
		if err := w.Close(); err != nil {
			t.Fatal(err)
		}
	}
}

func TestRootlessImportRetainsContainedLinks(t *testing.T) {
	var compressed, stream bytes.Buffer
	tw := tar.NewWriter(&stream)
	if err := tw.WriteHeader(&tar.Header{Name: "current", Linkname: "config", Mode: 0777, Typeflag: tar.TypeSymlink}); err != nil {
		t.Fatal(err)
	}
	if err := tw.WriteHeader(&tar.Header{Name: "config", Mode: 0600, Size: 3, Typeflag: tar.TypeReg}); err != nil {
		t.Fatal(err)
	}
	if _, err := tw.Write([]byte("row")); err != nil {
		t.Fatal(err)
	}
	if err := tw.Close(); err != nil {
		t.Fatal(err)
	}
	w, err := Create(&compressed, "", Manifest{Apps: []ManifestApp{{ID: "one", OwnershipNamespace: OwnershipDocker}}})
	if err != nil {
		t.Fatal(err)
	}
	if err := w.AddTar(&stream, "apps/one"); err != nil {
		t.Fatal(err)
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
	data, err := os.ReadFile(filepath.Join(staging, "apps/one/current"))
	if err != nil || string(data) != "row" {
		t.Fatalf("contained imported link lost: %q, %v", data, err)
	}
}
