package tui

import (
	"context"
	"errors"
	"fmt"
	"io"
	"os/exec"
	"strings"

	tea "charm.land/bubbletea/v2"

	"github.com/ajnart/self-host/internal/activity"
	"github.com/ajnart/self-host/internal/catalog"
	"github.com/ajnart/self-host/internal/events"
	"github.com/ajnart/self-host/internal/host"
	"github.com/ajnart/self-host/internal/names"
	"github.com/ajnart/self-host/internal/project"
	"github.com/ajnart/self-host/internal/release"
	"github.com/ajnart/self-host/internal/service"
	"github.com/ajnart/self-host/internal/system"
	"github.com/ajnart/self-host/internal/telemetry"
	"github.com/ajnart/self-host/internal/updatecheck"
)

type Action string

const (
	ActionStart   Action = "start"
	ActionStop    Action = "stop"
	ActionUp      Action = "up"
	ActionDown    Action = "down"
	ActionRestart Action = "restart"
	ActionUpdate  Action = "update"
	ActionSetup   Action = "setup"
	ActionBackup  Action = "backup"
	ActionRemove  Action = "remove"
	ActionInstall Action = "install"
	ActionConfig  Action = "config"
	ActionRestore Action = "restore"
)

// Request is one mutating Action.
type Request struct {
	Action  Action
	IDs     []string
	Install *service.InstallOptions
	// Pairs are the KEY=value Host settings ActionConfig sets.
	Pairs []string
	// File is the archive ActionRestore restores from.
	File string
	// Passphrase opens or encrypts a backup; it reaches only the Service and
	// is never shown or logged.
	Passphrase string
}

// Backend is everything the dashboard needs from the Service.
type Backend interface {
	Status(ctx context.Context) (service.Status, error)
	Doctor(ctx context.Context) []host.Check
	// Updates returns App ID → available, current or unknown.
	Updates(ctx context.Context, status service.Status) map[string]string
	Credentials(ctx context.Context) (service.Credentials, error)
	Logs(ctx context.Context, id string, w io.Writer) error
	// Usage reports the load of the Project's running containers to emit until
	// ctx ends.
	Usage(ctx context.Context, emit func([]service.ContainerUsage)) error
	OpenURL(url string) error
	// LookTool finds a program on PATH.
	LookTool(name string) (path string, ok bool)
	// ExecTool runs cmd with the terminal, pausing the TUI until it exits,
	// then delivers done's message.
	ExecTool(cmd *exec.Cmd, done func(error) tea.Msg) tea.Cmd
	// ReviewSettings compares Host settings with this machine now.
	ReviewSettings(ctx context.Context) ([]service.SettingReview, error)
	// Compose returns the App's Compose file.
	Compose(ctx context.Context, id string) (string, error)
	// Containers lists every container in the Project for App details.
	Containers(ctx context.Context) ([]service.ContainerStatus, error)
	Catalog() *catalog.Catalog
	// LatestRelease returns the newest published release tag, or "" when it
	// cannot be determined.
	LatestRelease(ctx context.Context) string
	// SkippedUpdate is the release version the person last declined, or "".
	SkippedUpdate() string
	// SkipUpdate remembers that the person declined a release version.
	SkipUpdate(version string)
	// SelfUpdate replaces the running binary with the newest release after
	// checking its checksum, returning the version it installed.
	SelfUpdate(ctx context.Context) (string, error)
	// Restart starts the replaced binary in this process's place with the
	// same arguments. It returns only when that failed.
	Restart() error
	// Detect returns the Host settings a new Project would get.
	Detect(ctx context.Context) map[string]string
	// Run performs a mutating action, reporting progress to log.
	Run(ctx context.Context, req Request, log *events.Logger) error
	// Backups lists the archives in the Project's backups folder.
	Backups(ctx context.Context) ([]service.BackupInfo, error)
	// BackupApps reads the App IDs from an archive's manifest, opening an
	// encrypted one with the passphrase.
	BackupApps(ctx context.Context, file, passphrase string) ([]string, error)
	// Glyphs is the Project's glyph set: Simple until a person chooses, and
	// when no Project exists yet.
	Glyphs(ctx context.Context) activity.Glyphs
	// SetGlyphs saves the glyph set with the Project. It works while the
	// install that creates the Project runs, and after it.
	SetGlyphs(ctx context.Context, g activity.Glyphs) error
	// Experience is the Experience level in the Profile, or "" until the
	// person answered.
	Experience(ctx context.Context) string
	// SetExperience saves the Experience level in the Profile. It works
	// before any Project exists.
	SetExperience(ctx context.Context, level string) error
	// TelemetryNotice is the one line that announces Telemetry the first
	// time, and "" once it has been shown or while Telemetry is off.
	TelemetryNotice() string
}

// ServiceBackend runs every call on a fresh Service so each task gets its
// own event stream.
type ServiceBackend struct {
	Deps *system.Deps
	Apps *catalog.Catalog
	// Args are the command-line arguments after the program name, which
	// Restart passes on to the new binary.
	Args []string
}

func (b ServiceBackend) TelemetryNotice() string {
	if b.quiet().Telemetry().Announce() {
		return telemetry.NoticeShort
	}
	return ""
}

func (b ServiceBackend) quiet() *service.Service {
	return service.New(b.Deps, events.Discard(), b.Apps)
}

func (b ServiceBackend) Status(ctx context.Context) (service.Status, error) {
	return b.quiet().Status(ctx)
}

func (b ServiceBackend) Doctor(ctx context.Context) []host.Check {
	return b.quiet().Doctor(ctx)
}

func (b ServiceBackend) Updates(ctx context.Context, status service.Status) map[string]string {
	b.quiet().CheckUpdates(ctx, &status)
	out := map[string]string{}
	for _, app := range status.Apps {
		out[app.ID] = app.Update
	}
	return out
}

func (b ServiceBackend) Credentials(ctx context.Context) (service.Credentials, error) {
	return b.quiet().Credentials(ctx)
}

func (b ServiceBackend) Logs(ctx context.Context, id string, w io.Writer) error {
	return b.quiet().Logs(ctx, id, w, true, 300)
}

func (b ServiceBackend) Usage(ctx context.Context, emit func([]service.ContainerUsage)) error {
	return b.quiet().Usage(ctx, emit)
}

func (b ServiceBackend) LookTool(name string) (string, bool) {
	path, err := exec.LookPath(name)
	return path, err == nil
}

func (b ServiceBackend) ExecTool(cmd *exec.Cmd, done func(error) tea.Msg) tea.Cmd {
	return tea.ExecProcess(cmd, done)
}

func (b ServiceBackend) OpenURL(url string) error {
	return b.quiet().OpenURL(context.Background(), url)
}

func (b ServiceBackend) LatestRelease(ctx context.Context) string {
	client := release.NewClient(b.Deps)
	rel, err := client.Latest(ctx)
	if err != nil {
		return ""
	}
	return "v" + rel.Version()
}

func (b ServiceBackend) SkippedUpdate() string {
	cache, ok := updatecheck.Open(b.Deps)
	if !ok {
		return ""
	}
	return cache.Load().Skipped
}

func (b ServiceBackend) SkipUpdate(version string) {
	cache, ok := updatecheck.Open(b.Deps)
	if !ok {
		return
	}
	state := cache.Load()
	state.Skipped = version
	cache.Save(state)
}

func (b ServiceBackend) SelfUpdate(ctx context.Context) (string, error) {
	client := release.NewClient(b.Deps)
	rel, err := client.Latest(ctx)
	if err != nil {
		return "", err
	}
	if newer, err := release.Newer(b.Deps.Version, rel.Tag); err != nil || !newer {
		return "", fmt.Errorf("self-host %s is already the newest release", b.Deps.Version)
	}
	exe, err := b.Deps.Executable()
	if err != nil {
		return "", errors.New("cannot locate the running binary: " + err.Error())
	}
	if err := client.Install(ctx, rel, b.Deps.GOOS, b.Deps.GOARCH, exe); err != nil {
		return "", err
	}
	return rel.Version(), nil
}

func (b ServiceBackend) Restart() error {
	exe, err := b.Deps.Executable()
	if err != nil {
		return err
	}
	// Linux appends this to a path whose file was replaced.
	exe = strings.TrimSuffix(exe, " (deleted)")
	return b.Deps.Exec(exe, append([]string{exe}, b.Args...))
}

func (b ServiceBackend) Catalog() *catalog.Catalog { return b.Apps }

func (b ServiceBackend) Detect(ctx context.Context) map[string]string {
	settings, err := b.quiet().Defaults()
	if err != nil {
		return map[string]string{}
	}
	if b.quiet().CheckEasyNames(ctx).Available && names.Diagnose(ctx, b.Deps.Resolver, settings["LAN_IP"]) == names.Working {
		settings["EASY_NAMES"] = "on"
	}
	return settings
}

func (b ServiceBackend) ReviewSettings(ctx context.Context) ([]service.SettingReview, error) {
	return b.quiet().ReviewSettings(ctx)
}

func (b ServiceBackend) Compose(ctx context.Context, id string) (string, error) {
	return b.quiet().Compose(ctx, id)
}

func (b ServiceBackend) Containers(ctx context.Context) ([]service.ContainerStatus, error) {
	return b.quiet().Containers(ctx)
}

func (b ServiceBackend) Backups(context.Context) ([]service.BackupInfo, error) {
	return b.quiet().Backups()
}

func (b ServiceBackend) BackupApps(_ context.Context, file, passphrase string) ([]string, error) {
	return b.quiet().BackupApps(file, passphrase)
}

func (b ServiceBackend) Glyphs(context.Context) activity.Glyphs {
	appearance, err := b.quiet().Appearance()
	if err != nil {
		return activity.Simple
	}
	return activity.ParseGlyphs(appearance.Glyphs)
}

func (b ServiceBackend) SetGlyphs(_ context.Context, g activity.Glyphs) error {
	return b.quiet().SetAppearance(project.Appearance{Glyphs: string(g)})
}

func (b ServiceBackend) Experience(context.Context) string {
	profile, err := b.quiet().Profile()
	if err != nil {
		return ""
	}
	return profile.Experience
}

func (b ServiceBackend) SetExperience(_ context.Context, level string) error {
	return b.quiet().SetExperience(level)
}

func (b ServiceBackend) Run(ctx context.Context, req Request, log *events.Logger) error {
	s := service.New(b.Deps, log, b.Apps)
	ids := req.IDs
	switch req.Action {
	case ActionBackup:
		_, err := s.Backup(ctx, ids, "", req.Passphrase)
		return err
	case ActionRestore:
		return s.Restore(ctx, req.File, ids, req.Passphrase)
	case ActionInstall:
		return s.Install(ctx, *req.Install)
	case ActionConfig:
		return s.ConfigSet(ctx, req.Pairs)
	case ActionStart:
		return s.Start(ctx, ids)
	case ActionStop:
		return s.Stop(ctx, ids)
	case ActionUp:
		return s.Start(ctx, nil)
	case ActionDown:
		return s.Down(ctx)
	case ActionRestart:
		return s.Restart(ctx, ids)
	case ActionUpdate:
		return s.Update(ctx, ids)
	case ActionSetup:
		return s.Setup(ctx, ids)
	case ActionRemove:
		return s.Remove(ctx, ids, false)
	}
	return nil
}
