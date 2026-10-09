package backup

import (
	"archive/tar"
	"bytes"
	"io"
	"os"
	"path/filepath"
	"testing"
)

func TestDeclaredEphemeralFIFOIsOmittedAndConfigurationRestores(t *testing.T) {
	stream := ephemeralFIFOStream(t, "./cache/sleep", tar.TypeFifo)
	var archive bytes.Buffer
	w, err := Create(&archive, "", Manifest{Apps: []ManifestApp{{ID: "one"}}})
	if err != nil {
		t.Fatal(err)
	}
	if err := w.AddTar(stream, "apps/one", "cache/sleep"); err != nil {
		t.Fatal(err)
	}
	if err := w.Close(); err != nil {
		t.Fatal(err)
	}
	r, err := Open(bytes.NewReader(archive.Bytes()), "")
	if err != nil {
		t.Fatal(err)
	}
	defer r.Close()
	staging := t.TempDir()
	if err := r.Extract(staging, func(name string) string { return filepath.Join(staging, name) }, nil); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Lstat(filepath.Join(staging, "apps/one/cache/sleep")); !os.IsNotExist(err) {
		t.Fatal("ephemeral FIFO entered restored storage")
	}
	if data, err := os.ReadFile(filepath.Join(staging, "apps/one/config")); err != nil || string(data) != "retained configuration" {
		t.Fatal("configuration was not preserved")
	}
}

func ephemeralFIFOStream(t *testing.T, name string, kind byte) io.Reader {
	t.Helper()
	var stream bytes.Buffer
	tw := tar.NewWriter(&stream)
	if err := tw.WriteHeader(&tar.Header{Name: name, Typeflag: kind, Mode: 0600}); err != nil {
		t.Fatal(err)
	}
	body := "retained configuration"
	if err := tw.WriteHeader(&tar.Header{Name: "config", Typeflag: tar.TypeReg, Mode: 0600, Size: int64(len(body))}); err != nil {
		t.Fatal(err)
	}
	if _, err := io.WriteString(tw, body); err != nil {
		t.Fatal(err)
	}
	if err := tw.Close(); err != nil {
		t.Fatal(err)
	}
	return &stream
}

func TestEphemeralFIFOExclusionDoesNotOmitOtherEntries(t *testing.T) {
	for _, tc := range []struct {
		name      string
		kind      byte
		wantError bool
	}{
		{"cache/sleep", tar.TypeReg, false},
		{"cache/unknown", tar.TypeFifo, true},
		{"cache/sleep", tar.TypeChar, true},
		{"cache/sleep", tar.TypeBlock, true},
		{"../cache/sleep", tar.TypeFifo, true},
		{"cache//sleep", tar.TypeFifo, true},
		{"cache/./sleep", tar.TypeFifo, true},
		{"././cache/sleep", tar.TypeFifo, true},
	} {
		t.Run(tc.name+string(tc.kind), func(t *testing.T) {
			var archive bytes.Buffer
			w, err := Create(&archive, "", Manifest{})
			if err != nil {
				t.Fatal(err)
			}
			err = w.AddTar(ephemeralFIFOStream(t, tc.name, tc.kind), "apps/one", "cache/sleep")
			if err := w.Close(); err != nil {
				t.Fatal(err)
			}
			if (err != nil) != tc.wantError {
				t.Fatalf("entry exclusion error=%v", err)
			}
			if !tc.wantError {
				r, err := Open(bytes.NewReader(archive.Bytes()), "")
				if err != nil {
					t.Fatal(err)
				}
				defer r.Close()
				staging := t.TempDir()
				if err := r.Extract(staging, func(name string) string { return filepath.Join(staging, name) }, nil); err != nil {
					t.Fatal(err)
				}
				if info, err := os.Stat(filepath.Join(staging, "apps/one/cache/sleep")); err != nil || !info.Mode().IsRegular() {
					t.Fatal("regular file at declared FIFO path was omitted")
				}
			}
		})
	}
}

func TestEphemeralFIFODeclarationsMustBeContainedCanonicalPaths(t *testing.T) {
	for _, name := range []string{"", ".", "/cache/sleep", "../cache/sleep", "cache/../sleep", "./cache/sleep", "cache//sleep"} {
		var archive bytes.Buffer
		w, err := Create(&archive, "", Manifest{})
		if err != nil {
			t.Fatal(err)
		}
		err = w.AddTar(ephemeralFIFOStream(t, "cache/sleep", tar.TypeFifo), "apps/one", name)
		if closeErr := w.Close(); closeErr != nil {
			t.Fatal(closeErr)
		}
		if err == nil {
			t.Fatal("unsafe FIFO declaration accepted")
		}
	}
}

func TestDeclaredFIFOStillRejectsSymlinkAncestor(t *testing.T) {
	var stream, archive bytes.Buffer
	tw := tar.NewWriter(&stream)
	for _, h := range []*tar.Header{
		{Name: "cache", Typeflag: tar.TypeSymlink, Linkname: "other", Mode: 0600},
		{Name: "cache/sleep", Typeflag: tar.TypeFifo, Mode: 0600},
	} {
		if err := tw.WriteHeader(h); err != nil {
			t.Fatal(err)
		}
	}
	if err := tw.Close(); err != nil {
		t.Fatal(err)
	}
	w, err := Create(&archive, "", Manifest{})
	if err != nil {
		t.Fatal(err)
	}
	defer w.Close()
	if err := w.AddTar(&stream, "apps/one", "cache/sleep"); err == nil {
		t.Fatal("declared FIFO bypassed symlink ancestor protection")
	}
}
