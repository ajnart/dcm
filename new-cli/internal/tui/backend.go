package tui

import (
	"context"
	"io"

	"github.com/ajnart/self-host/internal/activity"
	"github.com/ajnart/self-host/internal/catalog"
	"github.com/ajnart/self-host/internal/events"
	"github.com/ajnart/self-host/internal/host"
	"github.com/ajnart/self-host/internal/project"
	"github.com/ajnart/self-host/internal/release"
	"github.com/ajnart/self-host/internal/service"
	"github.com/ajnart/self-host/internal/system"
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
)

// Request is one mutating Action.
type Request struct {
	Action  Action
	IDs     []string
	Install *service.InstallOptions
	// Pairs are the KEY=value Host settings ActionConfig sets.
	Pairs []string
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
	// Detect returns the Host settings a new Project would get.
	Detect(ctx context.Context) map[string]string
	// Run performs a mutating action, reporting progress to log.
	Run(ctx context.Context, req Request, log *events.Logger) error
	// Glyphs is the Project's glyph set: Simple until a person chooses, and
	// when no Project exists yet.
	Glyphs(ctx context.Context) activity.Glyphs
	// SetGlyphs saves the glyph set with the Project. It works while the
	// install that creates the Project runs, and after it.
	SetGlyphs(ctx context.Context, g activity.Glyphs) error
}

// ServiceBackend runs every call on a fresh Service so each task gets its
// own event stream.
type ServiceBackend struct {
	Deps *system.Deps
	Apps *catalog.Catalog
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

func (b ServiceBackend) OpenURL(url string) error {
	return b.quiet().OpenURL(context.Background(), url)
}

func (b ServiceBackend) LatestRelease(ctx context.Context) string {
	client := release.NewClient(b.Deps)
	rel, err := client.Latest(ctx)
	if err != nil {
		return ""
	}
	return rel.Tag
}

func (b ServiceBackend) Catalog() *catalog.Catalog { return b.Apps }

func (b ServiceBackend) Detect(context.Context) map[string]string {
	settings, err := b.quiet().Defaults()
	if err != nil {
		return map[string]string{}
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

func (b ServiceBackend) Run(ctx context.Context, req Request, log *events.Logger) error {
	s := service.New(b.Deps, log, b.Apps)
	ids := req.IDs
	switch req.Action {
	case ActionBackup:
		_, err := s.Backup(ctx, ids, "", "")
		return err
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
