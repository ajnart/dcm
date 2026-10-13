package service

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"time"

	"github.com/ajnart/self-host/internal/backup"
	"github.com/ajnart/self-host/internal/compose"
	"github.com/ajnart/self-host/internal/events"
	"github.com/ajnart/self-host/internal/host"
	"github.com/ajnart/self-host/internal/project"
)

// BackupDir is where backups go when no output path is given.
func BackupDir(p *project.Project) string { return p.Path("backups") }

// Backup archives the Apps' folders plus Host settings, secrets and state
// into one file. Each running App is stopped only while it is archived.
func (s *Service) Backup(ctx context.Context, ids []string, out, passphrase string) (string, error) {
	var written string
	err := s.run(ctx, change{
		title: strings.TrimSpace("backup " + strings.Join(ids, " ")),
		edit: func(ctx context.Context, ss *session) error {
			targets, err := ss.targets(ids)
			if err != nil {
				return err
			}
			rootless, err := host.Rootless(ctx, s.Deps)
			if err != nil {
				return err
			}
			if rootless {
				if err := s.prepareBackupHelper(ctx); err != nil {
					return err
				}
				for _, id := range targets {
					if err := s.validateBackupHelperDirectory(ss.p.AppDir(id)); err != nil {
						return err
					}
				}
			}
			if out == "" {
				ext := ".tar.zst"
				if passphrase != "" {
					ext += ".age"
				}
				out = filepath.Join(BackupDir(ss.p), "selfhost-"+s.Deps.Now().Format("20060102-150405")+ext)
			}
			if err := os.MkdirAll(filepath.Dir(out), 0o700); err != nil {
				return err
			}
			if passphrase == "" {
				s.Log.Emit(events.Event{Event: events.StepWarn, Step: "unencrypted",
					Msg:  "this backup is not encrypted and contains your passwords and API keys",
					Hint: "Keep it private, or use --encrypt with SELF_HOST_BACKUP_PASSPHRASE."})
			}
			manifest := backup.Manifest{Version: 1, Created: s.Deps.Now().UTC(), CLIVersion: s.Deps.Version}
			for _, id := range targets {
				entry := backup.ManifestApp{ID: id, Extra: ss.p.IsExtra(id)}
				if rootless {
					entry.OwnershipNamespace = backup.OwnershipDocker
				}
				if a, found := s.Catalog.App(id); found && ss.state.Apps[id] != nil {
					entry.Name, entry.Image, entry.Managed = a.Info().Name, a.Info().Image, true
				}
				manifest.Apps = append(manifest.Apps, entry)
			}
			tmp := out + ".partial"
			f, err := os.OpenFile(tmp, os.O_CREATE|os.O_TRUNC|os.O_WRONLY, 0o600)
			if err != nil {
				return err
			}
			defer os.Remove(tmp)
			w, err := backup.Create(f, passphrase, manifest)
			if err != nil {
				f.Close()
				return err
			}
			for _, name := range []string{".env", "secrets.env", "state.json"} {
				data, err := ss.p.ReadHomeFile(name)
				if err != nil {
					f.Close()
					return err
				}
				if err := w.AddBytes(name, data, 0o600); err != nil {
					f.Close()
					return err
				}
			}
			if data, err := ss.p.ReadHomeFile(cloudflareRecordFile); err == nil {
				if err := w.AddBytes(cloudflareRecordFile, data, 0o600); err != nil {
					f.Close()
					return err
				}
			} else if !errors.Is(err, os.ErrNotExist) {
				f.Close()
				return err
			}
			containers, err := ss.compose.Ps(ctx)
			if err != nil {
				f.Close()
				return fmt.Errorf("cannot determine running Apps before backup: %w", err)
			}
			for _, id := range targets {
				if err := ss.archiveApp(ctx, w, id, containers, rootless); err != nil {
					f.Close()
					return err
				}
			}
			if err := w.Close(); err != nil {
				f.Close()
				return err
			}
			if err := f.Close(); err != nil {
				return err
			}
			if err := os.Rename(tmp, out); err != nil {
				return err
			}
			info, _ := os.Stat(out)
			written = out
			s.Log.Emit(events.Event{Event: events.StepOK, Step: "backup",
				Msg: fmt.Sprintf("wrote %s (%s)", out, HumanSize(info.Size()))})
			return nil
		},
	})
	return written, err
}

func (ss *session) archiveApp(ctx context.Context, w *backup.Writer, id string, containers []compose.Container, rootless bool) (result error) {
	services, err := ss.services(id)
	if err != nil {
		return err
	}
	var running []string
	for _, c := range containers {
		if slices.Contains(services, c.Service) && c.State == "running" {
			running = append(running, c.Service)
		}
	}
	log := ss.s.Log
	if len(running) > 0 {
		// Stop can partially succeed; always recover services that were running,
		// even when the caller cancelled or the archive failed.
		defer func() {
			recovery, cancel := context.WithTimeout(context.WithoutCancel(ctx), 2*time.Minute)
			defer cancel()
			if err := ss.compose.Start(recovery, running...); err != nil {
				log.Emit(events.Event{Event: events.StepFail, App: id, Step: StageStart, Msg: "could not restart after backup", Error: err.Error()})
				result = errors.Join(result, fmt.Errorf("restart %s after backup: %w", id, err))
				return
			}
			log.Emit(events.Event{Event: events.StepOK, App: id, Step: StageStart, Msg: "started again"})
		}()
		if err := ss.compose.Stop(ctx, running...); err != nil {
			return err
		}
		log.Emit(events.Event{Event: events.StepOK, App: id, Step: "stop", Msg: "stopped for a consistent copy"})
	} else {
		log.Emit(events.Event{Event: events.StepSkip, App: id, Step: "stop", Msg: "not running"})
	}
	if err := ctx.Err(); err != nil {
		return err
	}
	if rootless {
		err = ss.archiveDockerTree(ctx, w, id)
	} else {
		err = w.AddTree(ss.p.AppDir(id), ss.p.AppFolder(id)+"/"+id)
	}
	if err != nil {
		return err
	}
	if err := ctx.Err(); err != nil {
		return err
	}
	log.Emit(events.Event{Event: events.StepOK, App: id, Step: "archive", Msg: "archived " + ss.p.AppFolder(id) + "/" + id + "/"})
	if len(running) == 0 {
		log.Emit(events.Event{Event: events.StepSkip, App: id, Step: StageStart, Msg: "was not running"})
	}
	return nil
}
