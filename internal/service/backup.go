package service

import (
	"context"
	"fmt"
	"os"
	"path"
	"path/filepath"
	"slices"
	"strconv"
	"strings"
	"time"

	"github.com/ajnart/self-host/internal/backup"
	"github.com/ajnart/self-host/internal/compose"
	"github.com/ajnart/self-host/internal/events"
	"github.com/ajnart/self-host/internal/project"
)

// BackupDir is where backups go when no output path is given.
func BackupDir(p *project.Project) string { return p.Path("backups") }

// Backup archives the Apps' folders plus Host settings, secrets and state
// into one file. Each running App is stopped only while it is archived.
func (s *Service) Backup(ctx context.Context, ids []string, out, passphrase string) (string, error) {
	var written string
	err := s.mutate(ctx, strings.TrimSpace("backup "+strings.Join(ids, " ")), func(ss *session) error {
		targets, err := ss.targets(ids)
		if err != nil {
			return err
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
			entry := backup.ManifestApp{ID: id}
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
			data, err := os.ReadFile(ss.p.Path(name))
			if err != nil {
				f.Close()
				return err
			}
			if err := w.AddBytes(name, data, 0o600); err != nil {
				f.Close()
				return err
			}
		}
		containers, _ := ss.compose.Ps(ctx)
		for _, id := range targets {
			if err := ss.archiveApp(ctx, w, id, containers); err != nil {
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
			Msg: fmt.Sprintf("wrote %s (%s)", out, humanSize(info.Size()))})
		return nil
	})
	return written, err
}

func (ss *session) archiveApp(ctx context.Context, w *backup.Writer, id string, containers []compose.Container) error {
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
		if err := ss.compose.Stop(ctx, running...); err != nil {
			return err
		}
		log.Emit(events.Event{Event: events.StepOK, App: id, Step: "stop", Msg: "stopped for a consistent copy"})
	} else {
		log.Emit(events.Event{Event: events.StepSkip, App: id, Step: "stop", Msg: "not running"})
	}
	archiveErr := w.AddTree(ss.p.Path("apps", id), "apps/"+id)
	if archiveErr == nil {
		log.Emit(events.Event{Event: events.StepOK, App: id, Step: "archive", Msg: "archived apps/" + id + "/"})
	}
	if len(running) > 0 {
		if err := ss.compose.Start(ctx, running...); err != nil {
			return err
		}
		log.Emit(events.Event{Event: events.StepOK, App: id, Step: "start", Msg: "started again"})
	} else {
		log.Emit(events.Event{Event: events.StepSkip, App: id, Step: "start", Msg: "was not running"})
	}
	return archiveErr
}

func humanSize(n int64) string {
	switch {
	case n >= 1<<30:
		return fmt.Sprintf("%.1f GB", float64(n)/(1<<30))
	case n >= 1<<20:
		return fmt.Sprintf("%.1f MB", float64(n)/(1<<20))
	case n >= 1<<10:
		return fmt.Sprintf("%.1f KB", float64(n)/(1<<10))
	}
	return strconv.FormatInt(n, 10) + " B"
}

// Restore puts Apps back from a Backup: every App in it when ids is empty.
// Other Apps are not touched. Restoring onto a new host recreates the Project.
func (s *Service) Restore(ctx context.Context, file string, ids []string, passphrase string) error {
	f, err := os.Open(file)
	if err != nil {
		return err
	}
	defer f.Close()
	r, err := backup.Open(f, passphrase)
	if err != nil {
		return err
	}
	defer r.Close()
	targets := ids
	if len(targets) == 0 {
		for _, a := range r.Manifest.Apps {
			targets = append(targets, a.ID)
		}
	}
	for _, id := range targets {
		if !r.Manifest.Has(id) {
			return fmt.Errorf("%s is not in this backup", id)
		}
	}
	all := len(targets) == len(r.Manifest.Apps)

	p, err := s.Project()
	if err != nil {
		return err
	}
	fresh := !p.Exists()
	if fresh && !all {
		return fmt.Errorf("no Project yet; restore the whole backup first (self-host restore %s)", file)
	}
	if err := p.MkdirAll(); err != nil {
		return err
	}
	unlock, err := s.lock(p)
	if err != nil {
		return err
	}
	defer unlock()
	s.Log.Emit(events.Event{Event: events.RunStart, Msg: "restore " + strings.Join(targets, " ") + " from " + filepath.Base(file)})

	staging := p.Path(".restore-" + strconv.Itoa(s.Deps.PID))
	os.RemoveAll(staging)
	defer os.RemoveAll(staging)
	var chown func(string, int, int) error
	if os.Geteuid() == 0 {
		chown = func(p string, uid, gid int) error { return os.Lchown(p, uid, gid) }
	}
	err = r.Extract(func(name string) string {
		if name == ".env" || name == "secrets.env" || name == "state.json" {
			return filepath.Join(staging, name)
		}
		parts := strings.SplitN(name, "/", 3)
		if len(parts) >= 2 && parts[0] == "apps" && slices.Contains(targets, parts[1]) {
			return filepath.Join(staging, filepath.FromSlash(path.Clean(name)))
		}
		return ""
	}, chown)
	if err != nil {
		return err
	}
	if fresh {
		data, err := os.ReadFile(filepath.Join(staging, ".env"))
		if err != nil {
			return err
		}
		if err := os.WriteFile(p.Path(".env"), data, 0o644); err != nil {
			return err
		}
	}
	ss, err := s.open(ctx)
	if err != nil {
		return err
	}
	if err := ss.restoreRecords(staging, targets, all); err != nil {
		return err
	}
	existing, _ := ss.p.AppIDs()
	for _, id := range targets {
		if slices.Contains(existing, id) {
			services, err := ss.services(id)
			if err != nil {
				return err
			}
			if err := ss.compose.Remove(ctx, services...); err != nil {
				return err
			}
		}
		old := filepath.Join(staging, "replaced-"+id)
		if err := os.Rename(ss.p.Path("apps", id), old); err != nil && !os.IsNotExist(err) {
			return err
		}
		if err := ss.p.MkdirAll("apps"); err != nil {
			return err
		}
		if err := os.Rename(filepath.Join(staging, "apps", id), ss.p.Path("apps", id)); err != nil {
			return err
		}
		s.Log.Emit(events.Event{Event: events.StepOK, App: id, Step: "restore", Msg: "restored apps/" + id + "/"})
	}
	if err := ss.p.WriteRoot(); err != nil {
		return err
	}
	services, err := ss.services(targets...)
	if err != nil {
		return err
	}
	if err := ss.compose.Up(ctx, services...); err != nil {
		return err
	}
	s.Log.Emit(events.Event{Event: events.StepOK, Step: "start", Msg: "started " + strings.Join(targets, ", ")})
	return s.finish(nil)
}

// restoreRecords merges secrets and state for the restored Apps.
func (ss *session) restoreRecords(staging string, targets []string, all bool) error {
	backupProject := &project.Project{Root: staging}
	secrets, err := backupProject.LoadSecrets()
	if err != nil {
		return err
	}
	state, err := backupProject.LoadState()
	if err != nil {
		return err
	}
	if all {
		ss.secrets.values = secrets
	} else {
		for key, value := range secrets {
			for _, id := range targets {
				if strings.HasPrefix(key, SecretKey(id, "")) {
					ss.secrets.values[key] = value
				}
			}
		}
		if secrets["ADMIN_PASSWORD"] != ss.secrets.values["ADMIN_PASSWORD"] {
			ss.s.Log.Emit(events.Event{Event: events.StepWarn, Step: "admin-login",
				Msg:  "the backup used a different Admin login than this Project",
				Hint: "Run self-host setup " + strings.Join(targets, " ") + " to switch the restored Apps to the current Admin login."})
		}
	}
	for _, value := range ss.secrets.values {
		ss.s.Log.Secret(value)
	}
	if err := ss.p.SaveSecrets(ss.secrets.values); err != nil {
		return err
	}
	for _, id := range targets {
		if st := state.Apps[id]; st != nil {
			ss.state.Apps[id] = st
		}
	}
	return ss.p.SaveState(ss.state)
}

type BackupFile struct {
	Path      string    `json:"path"`
	Name      string    `json:"name"`
	Size      int64     `json:"size"`
	Modified  time.Time `json:"modified"`
	Encrypted bool      `json:"encrypted"`
}

// HumanSize formats the archive size.
func (b BackupFile) HumanSize() string { return humanSize(b.Size) }

// Backups lists archives in the default backup folder, newest first.
func (s *Service) Backups(ctx context.Context) ([]BackupFile, error) {
	p, err := s.Project()
	if err != nil {
		return nil, err
	}
	entries, err := os.ReadDir(BackupDir(p))
	if os.IsNotExist(err) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	var files []BackupFile
	for _, e := range entries {
		name := e.Name()
		if e.IsDir() || !(strings.HasSuffix(name, ".tar.zst") || strings.HasSuffix(name, ".tar.zst.age")) {
			continue
		}
		info, err := e.Info()
		if err != nil {
			continue
		}
		files = append(files, BackupFile{Path: filepath.Join(BackupDir(p), name), Name: name, Size: info.Size(),
			Modified: info.ModTime(), Encrypted: strings.HasSuffix(name, ".age")})
	}
	slices.SortFunc(files, func(a, b BackupFile) int { return b.Modified.Compare(a.Modified) })
	return files, nil
}
