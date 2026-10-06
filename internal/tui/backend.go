package tui

import (
	"context"
	"io"

	"github.com/ajnart/self-host/internal/catalog"
	"github.com/ajnart/self-host/internal/events"
	"github.com/ajnart/self-host/internal/host"
	"github.com/ajnart/self-host/internal/service"
	"github.com/ajnart/self-host/internal/system"
)

type Action string

const (
	ActionStart   Action = "start"
	ActionStop    Action = "stop"
	ActionRestart Action = "restart"
	ActionUpdate  Action = "update"
	ActionSetup   Action = "setup"
	ActionRemove  Action = "remove"
	ActionPurge   Action = "purge"
	ActionBackup  Action = "backup"
	ActionRestore Action = "restore"
)

// Request is one mutating action. File is the archive for backup/restore.
type Request struct {
	Action Action
	IDs    []string
	File   string
}

// Backend is everything the dashboard needs from the Service.
type Backend interface {
	Status(ctx context.Context) (service.Status, error)
	Doctor(ctx context.Context) []host.Check
	// Updates returns App ID → available, current or unknown.
	Updates(ctx context.Context, status service.Status) map[string]string
	Credentials(ctx context.Context) (service.Credentials, error)
	Logs(ctx context.Context, id string, w io.Writer) error
	OpenURL(url string) error
	Backups(ctx context.Context) ([]service.BackupFile, error)
	// Run performs a mutating action, reporting progress to log.
	Run(ctx context.Context, req Request, log *events.Logger) error
}

// ServiceBackend runs every call on a fresh Service so each task gets its
// own event stream.
type ServiceBackend struct {
	Deps    *system.Deps
	Catalog *catalog.Catalog
}

func (b ServiceBackend) quiet() *service.Service {
	return service.New(b.Deps, events.Discard(), b.Catalog)
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

func (b ServiceBackend) OpenURL(url string) error {
	return b.quiet().OpenURL(context.Background(), url)
}

func (b ServiceBackend) Backups(ctx context.Context) ([]service.BackupFile, error) {
	return b.quiet().Backups(ctx)
}

func (b ServiceBackend) Run(ctx context.Context, req Request, log *events.Logger) error {
	s := service.New(b.Deps, log, b.Catalog)
	ids := req.IDs
	switch req.Action {
	case ActionBackup:
		_, err := s.Backup(ctx, ids, req.File, "")
		return err
	case ActionRestore:
		return s.Restore(ctx, req.File, ids, b.Deps.Getenv("SELF_HOST_BACKUP_PASSPHRASE"))
	case ActionStart:
		return s.Start(ctx, ids)
	case ActionStop:
		return s.Stop(ctx, ids)
	case ActionRestart:
		return s.Restart(ctx, ids)
	case ActionUpdate:
		return s.Update(ctx, ids)
	case ActionSetup:
		return s.Setup(ctx, ids)
	case ActionRemove:
		return s.Remove(ctx, ids, false)
	case ActionPurge:
		return s.Remove(ctx, ids, true)
	}
	return nil
}
