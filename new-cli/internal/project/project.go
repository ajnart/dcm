// Package project owns the Project directory: Host settings, secrets, state,
// the include-only root Compose file and the lock.
package project

import (
	"bufio"
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"sync"

	"github.com/ajnart/self-host/internal/system"
)

const (
	DirName = "self-host"
	Name    = "selfhost"
)

// SettingKeys is the order Host settings are written in.
var SettingKeys = []string{"TZ", "PUID", "PGID", "UMASK", "LAN_IP", "EXPOSURE", "BIND_IP", "MEDIA_ROOT", "DOWNLOADS_ROOT"}

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
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return err
	}
	return p.chown(dir)
}

func (p *Project) chown(path string) error {
	if os.Geteuid() != 0 || p.Owner.UID == 0 {
		return nil
	}
	return os.Lchown(path, p.Owner.UID, p.Owner.GID)
}

func (p *Project) writeFile(name string, data []byte, mode os.FileMode) error {
	if err := os.MkdirAll(filepath.Dir(name), 0o755); err != nil {
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

// State

type StepRecord struct {
	Status string `json:"status"`
	Msg    string `json:"msg,omitempty"`
	Error  string `json:"error,omitempty"`
	Hint   string `json:"hint,omitempty"`
}

type AppState struct {
	Port   int                   `json:"port"`
	Inputs map[string]string     `json:"inputs,omitempty"`
	Setup  string                `json:"setup"`
	Steps  map[string]StepRecord `json:"steps,omitempty"`
	// StepOrder keeps steps in the order they last ran.
	StepOrder []string `json:"step_order,omitempty"`
}

type State struct {
	Version int                  `json:"version"`
	Apps    map[string]*AppState `json:"apps"`
}

func (p *Project) LoadState() (*State, error) {
	state := &State{Version: 1, Apps: map[string]*AppState{}}
	data, err := os.ReadFile(p.Path("state.json"))
	if errors.Is(err, os.ErrNotExist) {
		return state, nil
	}
	if err != nil {
		return nil, err
	}
	if err := json.Unmarshal(data, state); err != nil {
		recovered, rerr := p.recoverState(data)
		if rerr != nil {
			return nil, fmt.Errorf("state.json: %w (a copy is kept next to it; run self-host setup to rebuild Setup results)", err)
		}
		state = recovered
	}
	if state.Apps == nil {
		state.Apps = map[string]*AppState{}
	}
	return state, nil
}

// recoverState keeps the first complete JSON value of a damaged state.json
// (two writers used to interleave and leave a tail behind), saves the damaged
// file as state.json.corrupt and rewrites a clean one.
func (p *Project) recoverState(data []byte) (*State, error) {
	if err := os.WriteFile(p.Path("state.json.corrupt"), data, 0o644); err != nil {
		return nil, err
	}
	state := &State{Version: 1, Apps: map[string]*AppState{}}
	if err := json.NewDecoder(bytes.NewReader(data)).Decode(state); err != nil {
		return nil, err
	}
	if state.Apps == nil {
		state.Apps = map[string]*AppState{}
	}
	return state, p.SaveState(state)
}

func (p *Project) SaveState(state *State) error {
	data, err := json.MarshalIndent(state, "", "  ")
	if err != nil {
		return err
	}
	return p.writeFile(p.Path("state.json"), append(data, '\n'), 0o644)
}

// Compose files

func (p *Project) FragmentPath(id string) string { return p.Path("apps", id, "compose.yml") }

func (p *Project) WriteFragment(id, content string) error {
	if err := p.MkdirAll("apps", id); err != nil {
		return err
	}
	header := "# Generated by self-host for " + id + ". Reinstalling the App rewrites this file.\n"
	return p.writeFile(p.FragmentPath(id), []byte(header+content), 0o644)
}

// WriteAppFile writes a config file at rel inside apps/<id>, owned like the
// rest of the Project.
func (p *Project) WriteAppFile(id, rel string, data []byte, mode os.FileMode) error {
	if err := p.MkdirAll(append([]string{"apps", id}, strings.Split(filepath.Dir(rel), string(filepath.Separator))...)...); err != nil {
		return err
	}
	return p.writeFile(p.Path("apps", id, rel), data, mode)
}

// AppIDs lists every folder in apps/ that holds a compose.yml, catalog or not.
func (p *Project) AppIDs() ([]string, error) {
	entries, err := os.ReadDir(p.Path("apps"))
	if errors.Is(err, os.ErrNotExist) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	var ids []string
	for _, entry := range entries {
		if !entry.IsDir() {
			continue
		}
		if _, err := os.Stat(p.FragmentPath(entry.Name())); err == nil {
			ids = append(ids, entry.Name())
		}
	}
	sort.Strings(ids)
	return ids, nil
}

// WriteRoot rewrites compose.yml as an include list of every app folder.
func (p *Project) WriteRoot() error {
	ids, err := p.AppIDs()
	if err != nil {
		return err
	}
	var b strings.Builder
	b.WriteString("# Generated by self-host on every change. Do not edit.\n")
	b.WriteString("# To add an app yourself, create apps/<id>/compose.yml and run: self-host start <id>\n")
	b.WriteString("name: " + Name + "\n")
	if len(ids) == 0 {
		b.WriteString("services: {}\n")
	} else {
		b.WriteString("include:\n")
		for _, id := range ids {
			b.WriteString("  - apps/" + id + "/compose.yml\n")
		}
	}
	return p.writeFile(p.Path("compose.yml"), []byte(b.String()), 0o644)
}

// Lock

type LockedError struct{ PID int }

func (e LockedError) Error() string {
	return fmt.Sprintf("another self-host command (PID %d) is changing this Project; wait for it or stop it", e.PID)
}

// projectLocks serialises mutations inside one process: the Dashboard runs
// several tasks at once under the same PID, which the lock file alone cannot
// tell apart.
var projectLocks sync.Map

// Lock takes the Project lock for pid, waiting for other mutations of this
// process. A lock file held by another live process is refused; one held by a
// dead process is replaced.
func (p *Project) Lock(pid int, alive func(int) bool) (func(), error) {
	mu, _ := projectLocks.LoadOrStore(p.Root, &sync.Mutex{})
	mu.(*sync.Mutex).Lock()
	unlockFile, err := p.lockFile(pid, alive)
	if err != nil {
		mu.(*sync.Mutex).Unlock()
		return nil, err
	}
	return func() {
		unlockFile()
		mu.(*sync.Mutex).Unlock()
	}, nil
}

func (p *Project) lockFile(pid int, alive func(int) bool) (func(), error) {
	if err := os.MkdirAll(p.Root, 0o755); err != nil {
		return nil, err
	}
	path := p.Path(".lock")
	for attempt := 0; attempt < 2; attempt++ {
		f, err := os.OpenFile(path, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o644)
		if err == nil {
			_, err = f.WriteString(strconv.Itoa(pid))
			f.Close()
			if err != nil {
				return nil, err
			}
			return func() { os.Remove(path) }, nil
		}
		if !errors.Is(err, os.ErrExist) {
			return nil, err
		}
		data, _ := os.ReadFile(path)
		holder, convErr := strconv.Atoi(strings.TrimSpace(string(data)))
		if convErr == nil && holder != pid && alive(holder) {
			return nil, LockedError{PID: holder}
		}
		// Stale, unreadable or left by this process: replace it.
		os.Remove(path)
	}
	return nil, errors.New("could not take the Project lock (.lock)")
}
