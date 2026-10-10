package service

import (
	"archive/tar"
	"bytes"
	"context"
	"io"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/ajnart/self-host/internal/backup"
	"github.com/ajnart/self-host/internal/system"
)

type ephemeralFIFOApp struct{ *testApp }

func (ephemeralFIFOApp) EphemeralFIFOs() []string { return []string{"cache/sleep"} }

func TestBackupUsesAdapterEphemeralFIFODeclaration(t *testing.T) {
	h := newHarness(t, ephemeralFIFOApp{&testApp{id: "one", done: map[string]bool{}}})
	if err := h.install("one"); err != nil {
		t.Fatal(err)
	}
	h.runner.On("docker info", system.Result{Stdout: []byte(`["name=rootless"]`)})
	var stream bytes.Buffer
	tw := tar.NewWriter(&stream)
	if err := tw.WriteHeader(&tar.Header{Name: "./cache/sleep", Typeflag: tar.TypeFifo, Mode: 0600}); err != nil {
		t.Fatal(err)
	}
	body := "saved adapter configuration"
	if err := tw.WriteHeader(&tar.Header{Name: "./config", Typeflag: tar.TypeReg, Mode: 0600, Size: int64(len(body))}); err != nil {
		t.Fatal(err)
	}
	if _, err := io.WriteString(tw, body); err != nil {
		t.Fatal(err)
	}
	if err := tw.Close(); err != nil {
		t.Fatal(err)
	}
	h.runner.OnStreamIO("--entrypoint sh", func(_ context.Context, _ system.Cmd, stdin io.Reader, stdout, stderr io.Writer) error {
		script, err := io.ReadAll(stdin)
		if err != nil {
			return err
		}
		if !strings.Contains(string(script), "tar -c -C /owned .") {
			t.Fatal("archive helper selection changed")
		}
		_, err = stdout.Write(stream.Bytes())
		return err
	})
	file := filepath.Join(t.TempDir(), "backup.tar.zst")
	if _, err := h.svc.Backup(context.Background(), []string{"one"}, file, ""); err != nil {
		t.Fatal(err)
	}
	f, err := os.Open(file)
	if err != nil {
		t.Fatal(err)
	}
	defer f.Close()
	r, err := backup.Open(f, "")
	if err != nil {
		t.Fatal(err)
	}
	defer r.Close()
	staging := t.TempDir()
	if err := r.Extract(staging, func(name string) string { return filepath.Join(staging, name) }, nil); err != nil {
		t.Fatal(err)
	}
	if data, err := os.ReadFile(filepath.Join(staging, "apps/one/config")); err != nil || string(data) != body {
		t.Fatal("adapter configuration lost")
	}
	if _, err := os.Lstat(filepath.Join(staging, "apps/one/cache/sleep")); !os.IsNotExist(err) {
		t.Fatal("ephemeral FIFO was restored")
	}
}
