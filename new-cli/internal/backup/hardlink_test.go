package backup

import (
	"archive/tar"
	"bytes"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestHardlinkImportAndExtractPreserveSameAppInodeAndMetadata(t *testing.T) {
	var stream, compressed bytes.Buffer
	tw := tar.NewWriter(&stream)
	if err := tw.WriteHeader(&tar.Header{Name: "./database/row", Typeflag: tar.TypeReg, Mode: 0600, Uid: 999, Gid: 998, Size: 3}); err != nil {
		t.Fatal(err)
	}
	if _, err := tw.Write([]byte("row")); err != nil {
		t.Fatal(err)
	}
	if err := tw.WriteHeader(&tar.Header{Name: "./database/alias", Linkname: "./database/row", Typeflag: tar.TypeLink, Mode: 0600, Uid: 999, Gid: 998}); err != nil {
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
		t.Fatalf("legitimate App hardlink import refused: %v", err)
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
		t.Fatalf("legitimate selected App hardlink restore refused: %v", err)
	}
	row, err := os.Stat(filepath.Join(staging, "apps/one/database/row"))
	if err != nil {
		t.Fatal(err)
	}
	alias, err := os.Stat(filepath.Join(staging, "apps/one/database/alias"))
	if err != nil {
		t.Fatal(err)
	}
	if !os.SameFile(row, alias) {
		t.Fatal("restored hardlink does not share its target's inode")
	}
	data, err := os.ReadFile(filepath.Join(staging, "apps/one/database/alias"))
	if err != nil || string(data) != "row" {
		t.Fatalf("hardlink contents lost: %q, %v", data, err)
	}
	entries, err := r.AppMetadata("one")
	if err != nil {
		t.Fatal(err)
	}
	for _, e := range entries {
		if e.UID != 999 || e.GID != 998 || e.Mode != 0600 {
			t.Fatalf("hardlink metadata lost: %+v", e)
		}
	}
	if len(entries) != 2 {
		t.Fatalf("missing hardlink metadata: %+v", entries)
	}
}

func TestHardlinkExtractAcceptsOnlyEarlierSelectedRegular(t *testing.T) {
	r := openArchive(t, archiveEntry{name: "apps/one/row", data: "row", kind: tar.TypeReg}, archiveEntry{name: "apps/one/alias", link: "apps/one/row", kind: tar.TypeLink})
	staging := t.TempDir()
	if err := r.Extract(staging, selectedDestination(staging), nil); err != nil {
		t.Fatalf("earlier selected regular hardlink rejected: %v", err)
	}
}

func TestSpecialEntryDiagnosticIncludesOnlyFixedTypeCode(t *testing.T) {
	var stream, compressed bytes.Buffer
	tw := tar.NewWriter(&stream)
	if err := tw.WriteHeader(&tar.Header{Name: "synthetic-private-file-name", Typeflag: tar.TypeFifo, Mode: 0600}); err != nil {
		t.Fatal(err)
	}
	if err := tw.Close(); err != nil {
		t.Fatal(err)
	}
	w, err := Create(&compressed, "", Manifest{})
	if err != nil {
		t.Fatal(err)
	}
	defer w.Close()
	err = w.AddTar(&stream, "apps/one")
	if err == nil || !strings.Contains(err.Error(), "0x36") {
		t.Fatalf("FIFO diagnostic omitted type code: %v", err)
	}
	if strings.Contains(err.Error(), "synthetic-private-file-name") {
		t.Fatal("helper type diagnostic exposed filename")
	}
}

func TestHardlinkRejectsUnsafeTargetsAtImportAndExtraction(t *testing.T) {
	cases := []struct {
		name, source, target string
		sourceType           byte
		targetMode           int64
		targetUID, targetGID int
	}{
		{name: "absolute", source: "row", target: "/outside", sourceType: tar.TypeReg, targetMode: 0600},
		{name: "traversal", source: "row", target: "../outside", sourceType: tar.TypeReg, targetMode: 0600},
		{name: "secrets", source: "row", target: "../../secrets.env", sourceType: tar.TypeReg, targetMode: 0600},
		{name: "cross-app", source: "row", target: "../../two/row", sourceType: tar.TypeReg, targetMode: 0600},
		{name: "forward", source: "row", target: "later", sourceType: tar.TypeReg, targetMode: 0600},
		{name: "self", source: "row", target: "alias", sourceType: tar.TypeReg, targetMode: 0600},
		{name: "symlink-target", source: "row", target: "row", sourceType: tar.TypeSymlink, targetMode: 0600},
		{name: "directory-target", source: "row", target: "row", sourceType: tar.TypeDir, targetMode: 0600},
		{name: "mode-mismatch", source: "row", target: "row", sourceType: tar.TypeReg, targetMode: 0644},
		{name: "owner-mismatch", source: "row", target: "row", sourceType: tar.TypeReg, targetMode: 0600, targetUID: 999},
		{name: "group-mismatch", source: "row", target: "row", sourceType: tar.TypeReg, targetMode: 0600, targetGID: 999},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			var stream, compressed bytes.Buffer
			tw := tar.NewWriter(&stream)
			first := &tar.Header{Name: tc.source, Typeflag: tc.sourceType, Mode: 0600}
			if tc.sourceType == tar.TypeSymlink {
				first.Linkname = "config"
			}
			if err := tw.WriteHeader(first); err != nil {
				t.Fatal(err)
			}
			hardlink := &tar.Header{Name: "alias", Linkname: tc.target, Typeflag: tar.TypeLink, Mode: tc.targetMode, Uid: tc.targetUID, Gid: tc.targetGID}
			if err := tw.WriteHeader(hardlink); err != nil {
				t.Fatal(err)
			}
			if err := tw.Close(); err != nil {
				t.Fatal(err)
			}
			w, err := Create(&compressed, "", Manifest{Apps: []ManifestApp{{ID: "one"}}})
			if err != nil {
				t.Fatal(err)
			}
			if err := w.AddTar(&stream, "apps/one"); err == nil {
				t.Fatal("unsafe helper hardlink imported")
			}
			if err := w.Close(); err != nil {
				t.Fatal(err)
			}

			compressed.Reset()
			w, err = Create(&compressed, "", Manifest{Apps: []ManifestApp{{ID: "one"}}})
			if err != nil {
				t.Fatal(err)
			}
			first.Name = "apps/one/" + first.Name
			hardlink.Name = "apps/one/alias"
			if tc.target[0] == '/' {
				hardlink.Linkname = tc.target
			} else {
				hardlink.Linkname = "apps/one/" + tc.target
			}
			if err := w.tw.WriteHeader(first); err != nil {
				t.Fatal(err)
			}
			if err := w.tw.WriteHeader(hardlink); err != nil {
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
			if err := r.Extract(staging, selectedDestination(staging), nil); err == nil {
				t.Fatal("unsafe hardlink extracted")
			}
			if _, err := r.AppMetadata("one"); err == nil {
				t.Fatal("failed hardlink extraction exposed metadata")
			}
		})
	}
}

func TestHardlinkRejectsChainsAndUnselectedEarlierTargets(t *testing.T) {
	for _, entries := range [][]archiveEntry{
		{{name: "apps/one/row", kind: tar.TypeReg}, {name: "apps/one/alias", link: "apps/one/row", kind: tar.TypeLink}, {name: "apps/one/chain", link: "apps/one/alias", kind: tar.TypeLink}},
		{{name: "apps/one/alias", link: "apps/one/chain", kind: tar.TypeLink}, {name: "apps/one/chain", link: "apps/one/alias", kind: tar.TypeLink}},
		{{name: "apps/one/unselected", kind: tar.TypeReg}, {name: "apps/one/alias", link: "apps/one/unselected", kind: tar.TypeLink}},
	} {
		r := openArchive(t, entries...)
		staging := t.TempDir()
		resolve := selectedDestination(staging)
		dest := func(name string) string {
			if name == "apps/one/unselected" {
				return ""
			}
			return resolve(name)
		}
		if err := r.Extract(staging, dest, nil); err == nil {
			t.Fatal("hardlink chain/cycle/unselected target accepted")
		}
	}
}

func TestHardlinkRejectsDestinationAndAncestorSymlinksWithoutOutsideMutation(t *testing.T) {
	for _, destination := range []bool{false, true} {
		staging, outside := t.TempDir(), t.TempDir()
		sentinel := filepath.Join(outside, "sentinel")
		if err := os.WriteFile(sentinel, []byte("original"), 0600); err != nil {
			t.Fatal(err)
		}
		if err := os.MkdirAll(filepath.Join(staging, "apps/one"), 0700); err != nil {
			t.Fatal(err)
		}
		link, target := outside, "apps/one/config/created"
		if destination {
			link, target = sentinel, "apps/one/config"
		}
		if err := os.Symlink(link, filepath.Join(staging, "apps/one/config")); err != nil {
			t.Fatal(err)
		}
		r := openArchive(t, archiveEntry{name: "apps/one/row", data: "row", kind: tar.TypeReg}, archiveEntry{name: target, link: "apps/one/row", kind: tar.TypeLink})
		if err := r.Extract(staging, selectedDestination(staging), nil); err == nil {
			t.Fatal("hardlink wrote through destination/ancestor symlink")
		}
		data, err := os.ReadFile(sentinel)
		if err != nil || string(data) != "original" {
			t.Fatalf("outside sentinel changed: %q, %v", data, err)
		}
		if _, err := os.Stat(filepath.Join(outside, "created")); !os.IsNotExist(err) {
			t.Fatalf("outside hardlink created: %v", err)
		}
	}
}
