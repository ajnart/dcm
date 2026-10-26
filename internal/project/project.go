// Package project owns the Project directory: Host settings, secrets, state,
// the include-only root Compose file and the lock.
package project

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/netip"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"

	"github.com/ajnart/self-host/internal/status"
	"github.com/ajnart/self-host/internal/system"
)

const (
	DirName = ".self-host"
	Name    = "selfhost"
)

// SettingKeys is the order Host settings are written in.
var SettingKeys = []string{"TZ", "PUID", "PGID", "UMASK", "LAN_IP", "EXPOSURE", "EASY_NAMES", "BIND_IP", "MEDIA_ROOT", "DOWNLOADS_ROOT"}

type Project struct {
	Root  string
	Owner system.User
	// ComposeName is the Compose project name; Name unless overridden.
	ComposeName string
}

func Open(owner system.User) *Project {
	return &Project{Root: filepath.Join(owner.Home, DirName), Owner: owner, ComposeName: Name}
}

func (p *Project) Path(parts ...string) string {
	return filepath.Join(append([]string{p.Root}, parts...)...)
}

func (p *Project) Exists() bool {
	_, err := os.Stat(p.Path(".env"))
	return err == nil
}

// MkdirAll creates a directory inside the Project owned by the Project owner.
func (p *Project) MkdirAll(parts ...string) error {
	dir := p.Path(parts...)
	if err := p.mkdirAll(dir); err != nil {
		return err
	}
	return p.chown(dir)
}

func (p *Project) mkdirAll(dir string) error {
	var created []string
	for path := dir; ; path = filepath.Dir(path) {
		if _, err := os.Lstat(path); err == nil || path == filepath.Dir(path) {
			break
		}
		created = append(created, path)
	}
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return err
	}
	for _, path := range created {
		if err := p.chown(path); err != nil {
			return err
		}
	}
	return nil
}

// Chown hands path to the Project owner when running as root.
func (p *Project) Chown(path string) error { return p.chown(path) }

func (p *Project) chown(path string) error {
	if os.Geteuid() != 0 || p.Owner.UID == 0 {
		return nil
	}
	return os.Lchown(path, p.Owner.UID, p.Owner.GID)
}

func (p *Project) writeFile(name string, data []byte, mode os.FileMode) error {
	if err := p.mkdirAll(filepath.Dir(name)); err != nil {
		return err
	}
	// A unique temporary file per write: concurrent writers sharing one used
	// to interleave their bytes.
	tmp, err := os.CreateTemp(filepath.Dir(name), "."+filepath.Base(name)+".*.tmp")
	if err != nil {
		return err
	}
	defer os.Remove(tmp.Name())
	if _, err := tmp.Write(data); err != nil {
		tmp.Close()
		return err
	}
	if err := tmp.Close(); err != nil {
		return err
	}
	if err := os.Chmod(tmp.Name(), mode); err != nil {
		return err
	}
	if err := p.chown(tmp.Name()); err != nil {
		return err
	}
	return os.Rename(tmp.Name(), name)
}

// Env files

func parseEnv(data []byte) map[string]string {
	values := map[string]string{}
	scanner := bufio.NewScanner(bytes.NewReader(data))
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		key, value, found := strings.Cut(line, "=")
		if !found {
			continue
		}
		if len(value) >= 2 && value[0] == '\'' && value[len(value)-1] == '\'' {
			value = value[1 : len(value)-1]
		}
		values[strings.TrimSpace(key)] = value
	}
	return values
}

func formatEnv(header string, values map[string]string, order []string) []byte {
	var b strings.Builder
	b.WriteString(header)
	seen := map[string]bool{}
	write := func(key string) {
		value, found := values[key]
		if !found || seen[key] {
			return
		}
		seen[key] = true
		if strings.ContainsAny(value, " $#\"\\`") {
			value = "'" + value + "'"
		}
		fmt.Fprintf(&b, "%s=%s\n", key, value)
	}
	for _, key := range order {
		write(key)
	}
	rest := make([]string, 0, len(values))
	for key := range values {
		rest = append(rest, key)
	}
	sort.Strings(rest)
	for _, key := range rest {
		write(key)
	}
	return []byte(b.String())
}

// ValidSetting reports whether a value is acceptable for a Host setting.
func ValidSetting(key, value string) error {
	switch key {
	case "PUID", "PGID":
		if n, err := strconv.Atoi(value); err != nil || n < 0 {
			return errors.New("a non-negative integer")
		}
	case "UMASK":
		if len(value) < 3 || len(value) > 4 {
			return errors.New("3 or 4 octal digits")
		}
		if _, err := strconv.ParseUint(value, 8, 16); err != nil {
			return errors.New("3 or 4 octal digits")
		}
	case "MEDIA_ROOT", "DOWNLOADS_ROOT":
		if !filepath.IsAbs(value) {
			return errors.New("an absolute path")
		}
	case "LAN_IP":
		if _, err := netip.ParseAddr(value); err != nil {
			return errors.New("an IP address")
		}
	case "TZ":
		if value == "" {
			return errors.New("a time zone such as Europe/Paris")
		}
		if _, err := time.LoadLocation(value); err != nil {
			return errors.New("a time zone such as Europe/Paris")
		}
	}
	return nil
}

// ValidEnvValue reports whether a value can be stored in an env file.
func ValidEnvValue(value string) error {
	if strings.ContainsAny(value, "'\n\r") {
		return errors.New("value must not contain quotes or newlines")
	}
	return nil
}

func (p *Project) LoadSettings() (map[string]string, error) {
	data, err := os.ReadFile(p.Path(".env"))
	if err != nil {
		return nil, err
	}
	return parseEnv(data), nil
}

func (p *Project) SaveSettings(settings map[string]string) error {
	header := "# Host settings shared by every App. Change with: self-host config set KEY=value\n"
	return p.writeFile(p.Path(".env"), formatEnv(header, settings, SettingKeys), 0o644)
}

func (p *Project) LoadSecrets() (map[string]string, error) {
	data, err := os.ReadFile(p.Path("secrets.env"))
	if errors.Is(err, os.ErrNotExist) {
		return map[string]string{}, nil
	}
	if err != nil {
		return nil, err
	}
	return parseEnv(data), nil
}

func (p *Project) SaveSecrets(secrets map[string]string) error {
	header := "# Private credentials. Show with: self-host credentials\n"
	return p.writeFile(p.Path("secrets.env"), formatEnv(header, secrets, []string{"ADMIN_USER", "ADMIN_PASSWORD"}), 0o600)
}

// Appearance is how the Dashboard and the interactive terminal draw. It is
// a non-secret choice kept in appearance.json, apart from the Host settings,
// so status and config never see it.
type Appearance struct {
	// Glyphs is the glyph set: nerd-font or simple.
	Glyphs string `json:"glyphs"`
}

// LoadAppearance reads the appearance; the zero Appearance when none was
// chosen.
func (p *Project) LoadAppearance() (Appearance, error) {
	var a Appearance
	data, err := os.ReadFile(p.Path("appearance.json"))
	if errors.Is(err, os.ErrNotExist) {
		return a, nil
	}
	if err != nil {
		return a, err
	}
	return a, json.Unmarshal(data, &a)
}

// SaveAppearance writes the appearance, creating the Project folder when an
// install has not created it yet.
func (p *Project) SaveAppearance(a Appearance) error {
	if err := p.MkdirAll(); err != nil {
		return err
	}
	data, err := json.MarshalIndent(a, "", "  ")
	if err != nil {
		return err
	}
	return p.writeFile(p.Path("appearance.json"), append(data, '\n'), 0o644)
}

// State

type StepRecord struct {
	Status status.Step `json:"status"`
	Msg    string      `json:"msg,omitempty"`
	Error  string      `json:"error,omitempty"`
	Hint   string      `json:"hint,omitempty"`
}

type AppState struct {
	Port   int               `json:"port"`
	Inputs map[string]string `json:"inputs,omitempty"`
	// Recipe is the Recipe the App was first installed through; empty for an
	// App installed directly.
	Recipe string                `json:"recipe,omitempty"`
	Setup  status.Setup          `json:"setup"`
	Steps  map[string]StepRecord `json:"steps,omitempty"`
	// StepOrder keeps steps in the order they last ran.
	StepOrder []string `json:"step_order,omitempty"`
	// FragmentSHA256 is the hash of the compose.yml self-host last wrote for
	// the App; empty for Projects older than the field.
	FragmentSHA256 string `json:"fragment_sha256,omitempty"`
}

type State struct {
	Version int                  `json:"version"`
	Apps    map[string]*AppState `json:"apps"`
}

// LoadState reads state without modifying any Project files. A damaged tail
// can be ignored when the first JSON value is complete.
func (p *Project) LoadState() (*State, error) {
	state := &State{Version: 1, Apps: map[string]*AppState{}}
	data, err := os.ReadFile(p.Path("state.json"))
	if errors.Is(err, os.ErrNotExist) {
		return state, nil
	}
	if err != nil {
		return nil, err
	}
	state, _, err = decodeState(data)
	if err != nil {
		return nil, stateRecoveryError(err)
	}
	return state, nil
}

func decodeState(data []byte) (*State, bool, error) {
	state := &State{Version: 1, Apps: map[string]*AppState{}}
	damaged := false
	if err := json.Unmarshal(data, state); err != nil {
		damaged = true
		state = &State{Version: 1, Apps: map[string]*AppState{}}
		if decodeErr := json.NewDecoder(bytes.NewReader(data)).Decode(state); decodeErr != nil {
			return nil, true, err
		}
	}
	if state.Apps == nil {
		state.Apps = map[string]*AppState{}
	}
	return state, damaged, nil
}

func stateRecoveryError(err error) error {
	return fmt.Errorf("state.json: %w (restore state.json from a backup or move it aside, then run self-host setup to rebuild Setup results)", err)
}

// RecoverState repairs a salvageable damaged state.json. The caller must hold
// the Project mutation lock. Read current bytes after acquiring that lock;
// never repair a snapshot previously loaded by an unlocked reader.
func (p *Project) RecoverState() error {
	data, err := os.ReadFile(p.Path("state.json"))
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	if err != nil {
		return err
	}
	state, damaged, decodeErr := decodeState(data)
	if !damaged {
		return nil
	}
	if err := p.writeFile(p.Path("state.json.corrupt"), data, 0o600); err != nil {
		return fmt.Errorf("preserve damaged state.json: %w", err)
	}
	if decodeErr != nil {
		return stateRecoveryError(decodeErr)
	}
	return p.SaveState(state)
}

func (p *Project) SaveState(state *State) error {
	data, err := json.MarshalIndent(state, "", "  ")
	if err != nil {
		return err
	}
	return p.writeFile(p.Path("state.json"), append(data, '\n'), 0o644)
}

// Compose files

// ExtraDirName is the folder of Unmanaged apps, each in extra/<name>/.
const ExtraDirName = "extra"

// IsExtra reports whether id is an Unmanaged app in extra/. A folder in apps/
// with the same name wins, so a Catalog App is never shadowed by one.
func (p *Project) IsExtra(id string) bool {
	if _, err := os.Stat(p.Path("apps", id, "compose.yml")); err == nil {
		return false
	}
	_, err := os.Stat(p.Path(ExtraDirName, id, "compose.yml"))
	return err == nil
}

// AppFolder is the folder name that holds an App: apps or extra.
func (p *Project) AppFolder(id string) string {
	if p.IsExtra(id) {
		return ExtraDirName
	}
	return "apps"
}

// AppDir is the absolute folder that holds an App's compose.yml and data.
func (p *Project) AppDir(id string) string { return p.Path(p.AppFolder(id), id) }

func (p *Project) FragmentPath(id string) string { return filepath.Join(p.AppDir(id), "compose.yml") }

func (p *Project) WriteFragment(id, content string) error {
	if err := p.ValidateFragment(id, content); err != nil {
		return err
	}
	if p.IsExtra(id) {
		return fmt.Errorf("%s is an Unmanaged app in %s; choose another name or move that folder", id, p.Path(ExtraDirName, id))
	}
	if err := p.MkdirAll("apps", id); err != nil {
		return err
	}
	return p.writeFile(p.FragmentPath(id), []byte(FragmentHeader(id)+content), 0o644)
}

// FragmentHeader is the first line WriteFragment puts in an App's compose.yml.
func FragmentHeader(id string) string {
	return "# Generated by self-host for " + id + ". Reinstalling the App rewrites this file.\n"
}

// WriteAppFile writes a config file at rel inside apps/<id>, owned like the
// rest of the Project.
func (p *Project) WriteAppFile(id, rel string, data []byte, mode os.FileMode) error {
	if err := p.MkdirAll(append([]string{"apps", id}, strings.Split(filepath.Dir(rel), string(filepath.Separator))...)...); err != nil {
		return err
	}
	return p.writeFile(p.Path("apps", id, rel), data, mode)
}

// AppIDs lists every folder in apps/ or extra/ that holds a compose.yml,
// Catalog Apps and Unmanaged apps alike.
func (p *Project) AppIDs() ([]string, error) {
	seen := map[string]bool{}
	var ids []string
	for _, folder := range []string{"apps", ExtraDirName} {
		entries, err := os.ReadDir(p.Path(folder))
		if errors.Is(err, os.ErrNotExist) {
			continue
		}
		if err != nil {
			return nil, err
		}
		for _, entry := range entries {
			if !entry.IsDir() || seen[entry.Name()] {
				continue
			}
			if _, err := os.Stat(p.Path(folder, entry.Name(), "compose.yml")); err == nil {
				seen[entry.Name()] = true
				ids = append(ids, entry.Name())
			}
		}
	}
	sort.Strings(ids)
	return ids, nil
}

// NamesFolder is where the Caddy that serves Easy names lives, in access/caddy.
// It is a managed service of the Project, not an App.
const NamesFolder = "access/caddy"

// NamesFragmentPath is the Compose fragment of the Caddy for Easy names.
func (p *Project) NamesFragmentPath() string { return p.Path(NamesFolder, "compose.yml") }

// NamesCaddyfilePath is the Caddyfile that fragment mounts.
func (p *Project) NamesCaddyfilePath() string { return p.Path(NamesFolder, "config", "Caddyfile") }

// HasNames reports whether the Caddy for Easy names has been written.
func (p *Project) HasNames() bool {
	_, err := os.Stat(p.NamesFragmentPath())
	return err == nil
}

// WriteNamesFragment writes the Compose fragment of the Caddy for Easy names.
func (p *Project) WriteNamesFragment(content string) error {
	if err := p.MkdirAll("access", "caddy"); err != nil {
		return err
	}
	header := "# Generated by self-host for Easy names at home. Turning them off removes this file.\n"
	return p.writeFile(p.NamesFragmentPath(), []byte(header+content), 0o644)
}

// WriteNamesCaddyfile writes the Caddyfile and reports whether it changed.
func (p *Project) WriteNamesCaddyfile(content string) (bool, error) {
	if old, err := os.ReadFile(p.NamesCaddyfilePath()); err == nil && string(old) == content {
		return false, nil
	}
	if err := p.MkdirAll("access", "caddy", "config"); err != nil {
		return false, err
	}
	runtime, err := p.LoadNamesRuntime()
	if err != nil {
		return false, err
	}
	runtime.Applied = ""
	if err := p.SaveNamesRuntime(runtime); err != nil {
		return false, err
	}
	return true, p.writeFile(p.NamesCaddyfilePath(), []byte(content), 0o644)
}

// RemoveNames deletes the Caddy for Easy names and everything it holds.
func (p *Project) RemoveNames() error {
	if err := os.RemoveAll(p.Path(NamesFolder)); err != nil {
		return err
	}
	_ = os.Remove(p.Path("access"))
	return nil
}

// WriteRoot rewrites compose.yml as an include list of every app folder, then
// the Caddy for Easy names when it exists.
func (p *Project) WriteRoot() error {
	ids, err := p.AppIDs()
	if err != nil {
		return err
	}
	var includes []string
	for _, id := range ids {
		includes = append(includes, p.AppFolder(id)+"/"+id+"/compose.yml")
	}
	if p.HasNames() {
		includes = append(includes, NamesFolder+"/compose.yml")
	}
	var b strings.Builder
	b.WriteString("# Generated by self-host on every change. Do not edit.\n")
	b.WriteString("# To add an app yourself, create extra/<name>/compose.yml and run: self-host start <name>\n")
	b.WriteString("name: " + Name + "\n")
	if len(includes) == 0 {
		b.WriteString("services: {}\n")
	} else {
		b.WriteString("include:\n")
		for _, include := range includes {
			b.WriteString("  - " + include + "\n")
		}
	}
	return p.writeFile(p.Path("compose.yml"), []byte(b.String()), 0o644)
}

// Lock

type LockedError struct{ PID int }

func (e LockedError) Error() string {
	if e.PID <= 0 {
		return "another self-host command is changing this Project; wait for it or stop it"
	}
	return fmt.Sprintf("another self-host command (PID %d) is changing this Project; wait for it or stop it", e.PID)
}

// projectLocks serialises mutations inside one process: the Dashboard runs
// several tasks at once under the same PID, which the lock file alone cannot
// tell apart.
var projectLocks sync.Map

// Lock takes the Project lock for pid, waiting for other mutations of this
// process. Another process's claim is refused; a dead owner's claim is recovered.
func (p *Project) Lock(pid int, alive func(int) bool) (func(), error) {
	return p.LockContext(context.Background(), pid, alive)
}

// LockContext waits for this process's current mutation until ctx is canceled.
// Another process's claim is refused immediately, as in Lock.
func (p *Project) LockContext(ctx context.Context, pid int, alive func(int) bool) (func(), error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	key, err := filepath.Abs(p.Root)
	if err != nil {
		return nil, err
	}
	entry, _ := projectLocks.LoadOrStore(key, make(chan struct{}, 1))
	gate := entry.(chan struct{})
	select {
	case gate <- struct{}{}:
	case <-ctx.Done():
		return nil, ctx.Err()
	}
	if err := ctx.Err(); err != nil {
		<-gate
		return nil, err
	}
	unlockFile, err := p.lockFile(pid, alive)
	if err != nil {
		<-gate
		return nil, err
	}
	if err := ctx.Err(); err != nil {
		unlockFile()
		<-gate
		return nil, err
	}
	var once sync.Once
	return func() {
		once.Do(func() {
			unlockFile()
			<-gate
		})
	}, nil
}

// lockOpenError explains a lock the current user cannot open because of its
// owner or mode, naming the file and the two safe fixes.
func (p *Project) lockOpenError(err error) error {
	if !errors.Is(err, os.ErrPermission) {
		return err
	}
	user := p.Owner.Name
	if user == "" {
		user = strconv.Itoa(p.Owner.UID)
	}
	path := p.Path(".lock")
	return fmt.Errorf("cannot open Project lock %s: %w; fix it with: sudo chown %s %s, or remove %s if no self-host is running",
		path, err, user, path, path)
}

// LockError reports a Project lock the current user cannot open, for read-only
// diagnostics such as doctor. It never takes the lock or creates the file.
func (p *Project) LockError() error {
	f, err := os.OpenFile(p.Path(".lock"), os.O_RDWR|syscall.O_NOFOLLOW|syscall.O_NONBLOCK, 0o644)
	if err == nil {
		f.Close()
		return nil
	}
	if errors.Is(err, os.ErrPermission) {
		return p.lockOpenError(err)
	}
	return nil
}

func (p *Project) lockFile(pid int, alive func(int) bool) (func(), error) {
	if err := p.mkdirAll(p.Root); err != nil {
		return nil, err
	}
	// Keep this inode in place: unlinking even a stale claim can split owners
	// between an already-open file and its replacement. The kernel releases
	// ownership when this descriptor closes, including after a process crash.
	f, err := os.OpenFile(p.Path(".lock"), os.O_RDWR|os.O_CREATE|syscall.O_NOFOLLOW|syscall.O_NONBLOCK, 0o644)
	if err != nil {
		return nil, p.lockOpenError(err)
	}
	info, err := f.Stat()
	if err != nil {
		f.Close()
		return nil, err
	}
	if !info.Mode().IsRegular() {
		f.Close()
		return nil, errors.New("Project lock (.lock) must be a regular file")
	}
	err = syscall.Flock(int(f.Fd()), syscall.LOCK_EX|syscall.LOCK_NB)
	data, readErr := io.ReadAll(f)
	claim := strings.TrimSpace(string(data))
	owner, kernelClaim := strings.CutPrefix(claim, "flock:")
	holder, convErr := strconv.Atoi(owner)
	if err != nil {
		f.Close()
		if errors.Is(err, syscall.EWOULDBLOCK) || errors.Is(err, syscall.EAGAIN) {
			return nil, LockedError{PID: holder}
		}
		return nil, err
	}
	if readErr != nil {
		f.Close()
		return nil, readErr
	}
	// Respect live PID-only claims from older binaries, which did not flock.
	if !kernelClaim && convErr == nil && holder != pid && alive(holder) {
		f.Close()
		return nil, LockedError{PID: holder}
	}
	// A sudo command must leave the persistent inode writable by its normal
	// Project owner. Operate on this descriptor, never a replaceable path.
	if os.Geteuid() == 0 {
		if err := f.Chown(p.Owner.UID, p.Owner.GID); err != nil {
			f.Close()
			return nil, err
		}
		if err := f.Chmod(0o644); err != nil {
			f.Close()
			return nil, err
		}
	}
	if err := f.Truncate(0); err != nil {
		f.Close()
		return nil, err
	}
	if _, err := f.WriteAt([]byte("flock:"+strconv.Itoa(pid)), 0); err != nil {
		f.Close()
		return nil, err
	}
	return func() {
		// Clear owner metadata while we still own the kernel lock.
		f.Truncate(0)
		f.Close()
	}, nil
}
