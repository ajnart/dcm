package service

import (
	"archive/tar"
	"context"
	"io"
	"path/filepath"
	"strings"
	"testing"

	"github.com/ajnart/self-host/internal/backup"
	"github.com/ajnart/self-host/internal/system"
)

func TestApplyDockerMetadataUsesFourDigitModes(t *testing.T) {
	h := newHarness(t, &testApp{id: "one", done: map[string]bool{}})
	if err := h.install("one"); err != nil {
		t.Fatal(err)
	}
	var script string
	h.runner.OnStreamIO("--entrypoint sh", func(_ context.Context, _ system.Cmd, stdin io.Reader, _, _ io.Writer) error {
		data, err := io.ReadAll(stdin)
		script = string(data)
		return err
	})
	entries := []backup.EntryMetadata{
		{Path: "config", Mode: 0o644, Type: tar.TypeReg, UID: 0, GID: 0},
		{Path: "cache", Mode: 0o1777, Type: tar.TypeDir, UID: 0, GID: 0},
	}
	if err := h.svc.applyDockerMetadata(context.Background(), filepath.Join(h.root(), "apps", "one"), entries); err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(script, "chmod 0644 -- 'config'") {
		t.Fatalf("ordinary mode is not four-digit: %q", script)
	}
	if !strings.Contains(script, "chmod 1777 -- 'cache'") {
		t.Fatalf("special mode lost: %q", script)
	}
}
