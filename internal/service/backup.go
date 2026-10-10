package service

import (
	"context"
	"errors"
	"fmt"
	"io"
	"maps"
	"os"
	"path"
	"path/filepath"
	"slices"
	"strconv"
	"strings"
	"time"

	"github.com/ajnart/self-host/internal/app"
	"github.com/ajnart/self-host/internal/backup"
	"github.com/ajnart/self-host/internal/compose"
	"github.com/ajnart/self-host/internal/events"
	"github.com/ajnart/self-host/internal/helpers"
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
					if err := s.validateBackupHelperDirectory(ss.p.Path("apps", id)); err != nil {
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
				entry := backup.ManifestApp{ID: id}
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
		err = w.AddTree(ss.p.Path("apps", id), "apps/"+id)
	}
	if err != nil {
		return err
	}
	if err := ctx.Err(); err != nil {
		return err
	}
	log.Emit(events.Event{Event: events.StepOK, App: id, Step: "archive", Msg: "archived apps/" + id + "/"})
	if len(running) == 0 {
		log.Emit(events.Event{Event: events.StepSkip, App: id, Step: StageStart, Msg: "was not running"})
	}
	return nil
}

// BackupInfo is one archive in the Project's backups folder.
type BackupInfo struct {
	Path      string
	Name      string
	Size      int64
	Created   time.Time
	Encrypted bool
	// Apps are the App IDs in its manifest. An encrypted archive has none
	// until BackupApps opens it with the passphrase.
	Apps []string
}

// Backups lists the archives in the Project's backups folder, newest first.
func (s *Service) Backups() ([]BackupInfo, error) {
	p, err := s.Project()
	if err != nil {
		return nil, err
	}
	var files []string
	for _, pattern := range []string{"selfhost-*.tar.zst", "selfhost-*.tar.zst.age"} {
		matches, err := filepath.Glob(filepath.Join(BackupDir(p), pattern))
		if err != nil {
			return nil, err
		}
		files = append(files, matches...)
	}
	var out []BackupInfo
	for _, file := range files {
		info, err := os.Stat(file)
		if err != nil || !info.Mode().IsRegular() {
			continue
		}
		entry := BackupInfo{Path: file, Name: filepath.Base(file), Size: info.Size(), Created: info.ModTime()}
		if stamp, ok := strings.CutPrefix(entry.Name, "selfhost-"); ok && len(stamp) >= len("20060102-150405") {
			if at, err := time.ParseInLocation("20060102-150405", stamp[:len("20060102-150405")], time.Local); err == nil {
				entry.Created = at
			}
		}
		entry.Encrypted = archiveEncrypted(file)
		if !entry.Encrypted {
			entry.Apps, _ = s.BackupApps(file, "")
		}
		out = append(out, entry)
	}
	slices.SortFunc(out, func(a, b BackupInfo) int {
		if c := b.Created.Compare(a.Created); c != 0 {
			return c
		}
		return strings.Compare(a.Name, b.Name)
	})
	return out, nil
}

func archiveEncrypted(file string) bool {
	f, err := os.Open(file)
	if err != nil {
		return false
	}
	defer f.Close()
	head := make([]byte, 32)
	n, _ := io.ReadFull(f, head)
	return backup.IsEncrypted(head[:n])
}

// BackupApps reads the App IDs from an archive's manifest, decrypting it with
// the passphrase when it is encrypted.
func (s *Service) BackupApps(file, passphrase string) ([]string, error) {
	f, err := os.Open(file)
	if err != nil {
		return nil, err
	}
	defer f.Close()
	r, err := backup.Open(f, passphrase)
	if err != nil {
		return nil, err
	}
	defer r.Close()
	var ids []string
	for _, a := range r.Manifest.Apps {
		ids = append(ids, a.ID)
	}
	return ids, nil
}

// HumanSize is a byte count as B, KB, MB or GB.
func HumanSize(n int64) string {
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
func (s *Service) Restore(ctx context.Context, file string, ids []string, passphrase string) (result error) {
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
	// Manifest and target IDs enter mount and cleanup paths. Validate them
	// before preparing helpers, creating staging, or registering cleanup.
	for _, app := range r.Manifest.Apps {
		if err := validBackupAppID(app.ID); err != nil {
			return err
		}
	}
	for _, id := range ids {
		if err := validBackupAppID(id); err != nil {
			return err
		}
	}
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
	dockerApps := map[string]bool{}
	for _, app := range r.Manifest.Apps {
		if app.OwnershipNamespace == backup.OwnershipDocker && slices.Contains(targets, app.ID) {
			dockerApps[app.ID] = true
		}
	}
	if len(dockerApps) > 0 {
		if err := s.prepareBackupHelper(ctx); err != nil {
			return err
		}
	}

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
	staging, err := os.MkdirTemp(p.Root, ".restore-")
	if err != nil {
		return err
	}
	keepRecovery := false
	defer func() {
		if keepRecovery {
			return
		}
		cleanup, cancel := context.WithTimeout(context.WithoutCancel(ctx), 2*time.Minute)
		defer cancel()
		var cleanupErrors []error
		for _, id := range targets {
			if !dockerApps[id] {
				continue
			}
			for _, dir := range []string{filepath.Join(staging, "apps", id), filepath.Join(staging, "replaced-"+id)} {
				if err := s.removeDockerAppDirectory(cleanup, dir); err != nil {
					cleanupErrors = append(cleanupErrors, err)
				}
			}
		}
		if err := errors.Join(cleanupErrors...); err != nil {
			result = errors.Join(result, fmt.Errorf("restore cleanup failed; data retained in %s: %w", staging, err))
			return
		}
		if err := os.RemoveAll(staging); err != nil {
			result = errors.Join(result, fmt.Errorf("restore cleanup failed; data retained in %s: %w", staging, err))
		}
	}()
	var chown func(string, int, int) error
	if os.Geteuid() == 0 {
		chown = func(p string, uid, gid int) error {
			rel, err := filepath.Rel(staging, p)
			if err != nil {
				return err
			}
			parts := strings.SplitN(rel, string(filepath.Separator), 3)
			if len(parts) > 1 && parts[0] == "apps" && dockerApps[parts[1]] {
				return nil
			}
			return os.Lchown(p, uid, gid)
		}
	}
	err = r.Extract(staging, func(name string) string {
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
	// Reject an incomplete archive before stopping containers or replacing data.
	for _, id := range targets {
		fragment := filepath.Join(staging, "apps", id, "compose.yml")
		services, err := fragmentServices(fragment)
		if err != nil {
			return fmt.Errorf("backup is missing a valid replacement for %s: %w", id, err)
		}
		if len(services) == 0 {
			return fmt.Errorf("backup replacement for %s declares no services", id)
		}
	}
	// Validate safely extracted prerequisites before inspecting or removing
	// original containers. Runtime startup checks them again after replacement.
	for _, id := range targets {
		a, found := s.Catalog.App(id)
		if !found {
			continue
		}
		preflight, ok := a.(app.PreflightChecker)
		if !ok {
			continue
		}
		archived, err := (&project.Project{Root: staging}).LoadState()
		if err != nil {
			return err
		}
		record := archived.Apps[id]
		if record == nil {
			return fmt.Errorf("backup is missing the configuration record for %s", id)
		}
		h := helpers.New(helpers.Config{App: id, Dir: filepath.Join(staging, "apps", id), Inputs: publicInputs(a, record.Inputs), Log: s.Log})
		if err := preflight.Preflight(ctx, h); err != nil {
			return fmt.Errorf("backup prerequisites for %s: %w", id, err)
		}
	}
	// Only the initializer, called under the mutation lock, may claim fresh
	// recovery. Another command may have created the Project during extraction.
	fresh = false
	replaced := false
	err = s.run(ctx, change{
		title: "restore " + strings.Join(targets, " ") + " from " + filepath.Base(file),
		initialize: func(p *project.Project) error {
			if !all {
				return fmt.Errorf("no Project yet; restore the whole backup first (self-host restore %s)", file)
			}
			settings, err := (&project.Project{Root: staging}).LoadSettings()
			if err != nil {
				return err
			}
			if err := p.SaveSettings(settings); err != nil {
				return err
			}
			fresh = true
			return nil
		},
		edit: func(ctx context.Context, ss *session) (result error) {
			replacements := map[string]string{}
			for _, id := range targets {
				content, err := os.ReadFile(filepath.Join(staging, "apps", id, "compose.yml"))
				if err != nil {
					return err
				}
				replacements[id] = string(content)
			}
			if err := ss.p.ValidateServiceOwnership(replacements); err != nil {
				return err
			}
			var containers []compose.Container
			if !fresh {
				var err error
				containers, err = ss.compose.Ps(ctx)
				if err != nil {
					return fmt.Errorf("cannot determine running Apps before restore: %w", err)
				}
			}
			oldApps := maps.Clone(ss.state.Apps)
			oldSecrets := maps.Clone(ss.secrets.values)
			original := &project.Project{Root: filepath.Join(staging, "original-records")}
			if err := original.SaveSecrets(oldSecrets); err != nil {
				return err
			}
			if err := original.SaveState(ss.state); err != nil {
				return err
			}
			if err := original.SaveSettings(ss.settings); err != nil {
				return err
			}
			type replacement struct {
				id             string
				old, installed bool
			}
			var changed []*replacement
			var recoverServices, recoverApps []string
			defer func() {
				if result == nil {
					return
				}
				var recoveryErrors []error
				for i := len(changed) - 1; i >= 0; i-- {
					item := changed[i]
					dir := ss.p.Path("apps", item.id)
					if item.installed {
						var err error
						if dockerApps[item.id] {
							cleanup, cancel := context.WithTimeout(context.WithoutCancel(ctx), 2*time.Minute)
							err = s.removeDockerAppDirectory(cleanup, dir)
							cancel()
						} else {
							err = os.RemoveAll(dir)
						}
						if err != nil {
							recoveryErrors = append(recoveryErrors, err)
							continue
						}
					}
					if item.old {
						if err := os.Rename(filepath.Join(staging, "replaced-"+item.id), dir); err != nil {
							recoveryErrors = append(recoveryErrors, err)
						}
					}
				}
				ss.state.Apps, ss.secrets.values = oldApps, oldSecrets
				recoveryErrors = append(recoveryErrors, ss.p.SaveSecrets(oldSecrets), ss.p.SaveState(ss.state), ss.p.WriteRoot())
				if err := errors.Join(recoveryErrors...); err != nil {
					keepRecovery = true
					result = errors.Join(result, fmt.Errorf("restore rollback failed; original data retained in %s: %w", staging, err))
					return
				}
				if len(recoverServices) > 0 {
					recovery, cancel := context.WithTimeout(context.WithoutCancel(ctx), 2*time.Minute)
					defer cancel()
					if err := ss.compose.Up(recovery, recoverServices...); err != nil {
						keepRecovery = true
						result = errors.Join(result, fmt.Errorf("could not restart original Apps after rollback; records retained in %s; run self-host start %s: %w", staging, strings.Join(recoverApps, " "), err))
					}
				}
			}()
			for _, id := range targets {
				if !dockerApps[id] {
					continue
				}
				entries, err := r.AppMetadata(id)
				if err != nil {
					return err
				}
				if err := s.applyDockerMetadata(ctx, filepath.Join(staging, "apps", id), entries); err != nil {
					return err
				}
			}
			existing, err := ss.p.AppIDs()
			if err != nil {
				return err
			}
			for _, id := range targets {
				if slices.Contains(existing, id) {
					services, err := ss.services(id)
					if err != nil {
						return err
					}
					// rm can partially succeed, so remember running services first.
					for _, container := range containers {
						if container.State == "running" && slices.Contains(services, container.Service) && !slices.Contains(recoverServices, container.Service) {
							recoverServices = append(recoverServices, container.Service)
							if !slices.Contains(recoverApps, id) {
								recoverApps = append(recoverApps, id)
							}
						}
					}
					if err := ss.compose.Remove(ctx, services...); err != nil {
						return err
					}
				}
				old := filepath.Join(staging, "replaced-"+id)
				item := &replacement{id: id}
				changed = append(changed, item)
				if err := os.Rename(ss.p.Path("apps", id), old); err != nil {
					if !os.IsNotExist(err) {
						return err
					}
				} else {
					item.old = true
				}
				if err := ss.p.MkdirAll("apps"); err != nil {
					return err
				}
				if err := os.Rename(filepath.Join(staging, "apps", id), ss.p.Path("apps", id)); err != nil {
					return err
				}
				item.installed = true
			}
			if err := ss.restoreRecords(staging, targets, fresh); err != nil {
				return err
			}
			replaced = true
			for _, id := range targets {
				s.Log.Emit(events.Event{Event: events.StepOK, App: id, Step: "restore", Msg: "restored apps/" + id + "/"})
			}
			return nil
		},
		targets: func(*session) ([]string, error) { return targets, nil },
		compose: composeUp,
	})
	if err != nil && replaced {
		keepRecovery = true
		return fmt.Errorf("restore could not finish; original data and records retained in %s: %w", staging, err)
	}
	return err
}

func validBackupAppID(id string) error {
	if id == "" || id == "." || !filepath.IsLocal(id) || filepath.Base(id) != id || strings.ContainsAny(id, "/\\\x00\r\n") {
		return fmt.Errorf("invalid App ID in backup: %q", id)
	}
	return nil
}

// restoreRecords merges secrets and state for the restored Apps.
func (ss *session) restoreRecords(staging string, targets []string, fresh bool) error {
	backupProject := &project.Project{Root: staging}
	secrets, err := backupProject.LoadSecrets()
	if err != nil {
		return err
	}
	state, err := backupProject.LoadState()
	if err != nil {
		return err
	}
	if fresh {
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
	registerSecrets(ss.s.Log, ss.secrets.values)
	if err := ss.p.SaveSecrets(ss.secrets.values); err != nil {
		return err
	}
	for _, id := range targets {
		if st := state.Apps[id]; st != nil {
			ss.state.Apps[id] = st
		}
	}
	if err := ss.migratePrivateInputs(); err != nil {
		return err
	}
	return ss.p.SaveState(ss.state)
}
