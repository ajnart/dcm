package service

import (
	"archive/tar"
	"bytes"
	"context"
	"encoding/csv"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/ajnart/self-host/internal/app"
	"github.com/ajnart/self-host/internal/backup"
	"github.com/ajnart/self-host/internal/events"
	"github.com/ajnart/self-host/internal/system"
)

const backupHelperImage = "docker.io/library/alpine@sha256:5291449c3df73caf6ed85e649dec1b9e818b39a5d8c871e97afc13e9cd5e8fa8"

func (s *Service) prepareBackupHelper(ctx context.Context) error {
	if _, ok := s.Deps.Runner.(system.StreamIORunner); !ok {
		return errors.New("Docker backup requires separate binary stdout streaming")
	}
	result, err := s.Deps.Runner.Run(ctx, system.Cmd{Name: "docker", Args: []string{"image", "inspect", backupHelperImage}})
	if err != nil {
		return err
	}
	if result.ExitCode == 0 {
		return nil
	}
	s.Log.Emit(events.Event{Event: events.Info, Step: "backup-helper", Msg: "pulling the pinned backup helper before stopping Apps"})
	result, err = s.Deps.Runner.Run(ctx, system.Cmd{Name: "docker", Args: []string{"pull", backupHelperImage}})
	if err != nil {
		return err
	}
	if result.ExitCode != 0 {
		return fmt.Errorf("pull backup helper: %s", s.Log.Redact(strings.TrimSpace(string(result.Stderr))))
	}
	return nil
}

// runBackupHelper mounts exactly one selected App directory. Script is trusted
// code and safely quoted metadata; neither its contents nor tar bytes are logged.
func (s *Service) runBackupHelper(ctx context.Context, dir string, readOnly, metadata bool, script io.Reader, stdout io.Writer) (result error) {
	if err := s.validateBackupHelperDirectory(dir); err != nil {
		return err
	}
	name := "selfhost-backup-" + GenerateHex(16)
	var mount bytes.Buffer
	fields := []string{"type=bind", "src=" + dir, "dst=/owned"}
	if readOnly {
		fields = append(fields, "readonly")
	}
	csvWriter := csv.NewWriter(&mount)
	if err := csvWriter.Write(fields); err != nil {
		return err
	}
	csvWriter.Flush()
	args := []string{"run", "--rm", "--name", name, "--network", "none", "--read-only", "--user", "0:0", "--security-opt", "no-new-privileges", "--cap-drop", "ALL", "--cap-add", "DAC_OVERRIDE"}
	if metadata {
		args = append(args, "--cap-add", "CHOWN", "--cap-add", "FOWNER")
	}
	args = append(args, "--mount", strings.TrimSuffix(mount.String(), "\n"), "--entrypoint", "sh", "-i", backupHelperImage, "-s")
	defer func() {
		if result == nil {
			return
		}
		cleanup, cancel := context.WithTimeout(context.WithoutCancel(ctx), 30*time.Second)
		defer cancel()
		err := s.removeBackupHelper(cleanup, name)
		if err != nil {
			result = errors.Join(result, fmt.Errorf("backup helper %s cleanup failed; run docker rm --force %s: %w", name, name, err))
		}
	}()
	var diagnostics limitedHelperDiagnostics
	err := s.Deps.Runner.(system.StreamIORunner).StreamIO(ctx, system.Cmd{Name: "docker", Args: args}, script, stdout, &diagnostics)
	if err != nil {
		return fmt.Errorf("backup helper: %w: %s", err, s.Log.Redact(strings.TrimSpace(diagnostics.String())))
	}
	return nil
}

func (s *Service) removeBackupHelper(ctx context.Context, name string) error {
	removed, err := s.Deps.Runner.Run(ctx, system.Cmd{Name: "docker", Args: []string{"rm", "--force", name}})
	if err != nil {
		return err
	}
	if removed.ExitCode == 0 || missingBackupHelper(removed.Stderr) {
		return nil
	}
	detail := strings.ToLower(string(removed.Stderr))
	if !strings.Contains(detail, "removal") || !strings.Contains(detail, "already in progress") {
		return errors.New(s.Log.Redact(strings.TrimSpace(string(removed.Stderr))))
	}
	// Docker --rm can already be removing this exact helper. Inspect only its
	// state until it disappears; never mistake an inspect error for absence.
	deadline := s.Deps.Now().Add(30 * time.Second)
	for {
		state, err := s.Deps.Runner.Run(ctx, system.Cmd{Name: "docker", Args: []string{"container", "inspect", "--format", "{{.State.Status}}", name}})
		if err != nil {
			return err
		}
		if state.ExitCode != 0 {
			if missingBackupHelper(state.Stderr) {
				return nil
			}
			return errors.New(s.Log.Redact(strings.TrimSpace(string(state.Stderr))))
		}
		if strings.TrimSpace(string(state.Stdout)) == "" {
			return errors.New("Docker did not report the owned helper's state")
		}
		if !s.Deps.Now().Before(deadline) {
			return fmt.Errorf("timed out confirming helper removal: %w", context.DeadlineExceeded)
		}
		if err := s.Deps.Sleep(ctx, 250*time.Millisecond); err != nil {
			return err
		}
	}
}

func missingBackupHelper(stderr []byte) bool {
	detail := strings.ToLower(string(stderr))
	return strings.Contains(detail, "no such container") || strings.Contains(detail, "no such object")
}

func (s *Service) validateBackupHelperDirectory(dir string) error {
	p, err := s.Project()
	if err != nil {
		return err
	}
	rel, err := filepath.Rel(p.Root, dir)
	if err != nil || !filepath.IsLocal(rel) || rel == "." {
		return errors.New("backup helper directory must stay inside its Project")
	}
	root, err := filepath.EvalSymlinks(p.Root)
	if err != nil {
		return err
	}
	resolved, err := filepath.EvalSymlinks(dir)
	if err != nil {
		return err
	}
	if resolved != filepath.Join(root, rel) {
		return fmt.Errorf("backup helper directory has an unowned symlink ancestor: %s", dir)
	}
	info, err := os.Lstat(dir)
	if err != nil {
		return err
	}
	if !info.IsDir() || info.Mode()&os.ModeSymlink != 0 {
		return fmt.Errorf("backup helper requires an owned App directory: %s", dir)
	}
	return nil
}

type limitedHelperDiagnostics struct{ buffer bytes.Buffer }

func (w *limitedHelperDiagnostics) String() string { return w.buffer.String() }

func (w *limitedHelperDiagnostics) Write(p []byte) (int, error) {
	n := len(p)
	if remaining := 4096 - w.buffer.Len(); remaining > 0 {
		w.buffer.Write(p[:min(n, remaining)])
	}
	return n, nil
}

func (ss *session) archiveDockerTree(ctx context.Context, w *backup.Writer, id string) error {
	var ephemeralFIFOs []string
	if adapter, found := ss.s.Catalog.App(id); found {
		if declarer, ok := adapter.(app.EphemeralFIFODeclarer); ok {
			ephemeralFIFOs = declarer.EphemeralFIFOs()
		}
	}
	reader, writer := io.Pipe()
	done := make(chan error, 1)
	go func() {
		err := w.AddTar(reader, "apps/"+id, ephemeralFIFOs...)
		if err == nil {
			_, err = io.Copy(io.Discard, reader)
		}
		reader.CloseWithError(err)
		done <- err
	}()
	err := ss.s.runBackupHelper(ctx, ss.p.Path("apps", id), true, false, strings.NewReader("set -eu\ntar -c -C /owned .\n"), writer)
	writer.CloseWithError(err)
	return errors.Join(err, <-done)
}

func (s *Service) applyDockerMetadata(ctx context.Context, dir string, entries []backup.EntryMetadata) error {
	var script strings.Builder
	script.WriteString("set -eu\ncd /owned\n")
	for _, entry := range entries {
		if entry.Path != "." && !filepath.IsLocal(entry.Path) {
			return errors.New("unsafe App metadata path")
		}
		quoted := "'" + strings.ReplaceAll(entry.Path, "'", "'\"'\"'") + "'"
		fmt.Fprintf(&script, "chown -h %d:%d -- %s\n", entry.UID, entry.GID, quoted)
		if entry.Type != tar.TypeSymlink {
			fmt.Fprintf(&script, "chmod %03o -- %s\n", entry.Mode, quoted)
		}
	}
	return s.runBackupHelper(ctx, dir, false, true, strings.NewReader(script.String()), io.Discard)
}

func (s *Service) removeDockerAppDirectory(ctx context.Context, dir string) error {
	if _, err := os.Lstat(dir); errors.Is(err, os.ErrNotExist) {
		return nil
	}
	script := "set -eu\nrm -rf -- /owned/* /owned/.[!.]* /owned/..?*\n"
	if err := s.runBackupHelper(ctx, dir, false, false, strings.NewReader(script), io.Discard); err != nil {
		return err
	}
	return os.Remove(dir)
}
