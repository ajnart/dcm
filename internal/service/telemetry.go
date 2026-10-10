package service

import (
	"os"
	"path/filepath"

	"github.com/ajnart/self-host/internal/telemetry"
)

// Telemetry returns the Telemetry client for this machine: it keeps its notice
// marker in the Home folder and its install ID in the user config folder, so
// the ID outlives the Home folder, and sends through the Deps' HTTP transport.
// Without a usable Home folder it sends nothing.
func (s *Service) Telemetry() *telemetry.Client {
	opts := telemetry.Options{
		Version: s.Deps.Version,
		OS:      s.Deps.GOOS,
		Arch:    s.Deps.GOARCH,
		Getenv:  s.Deps.Getenv,
	}
	if s.Deps.HTTP != nil {
		opts.Transport = s.Deps.HTTP.Transport
	}
	if p, err := s.Project(); err == nil {
		opts.Store = p
	}
	if s.Deps.ConfigDir != nil {
		if dir, err := s.Deps.ConfigDir(); err == nil && dir != "" {
			opts.Config = configFolder{filepath.Join(dir, "self-host")}
		}
	}
	return telemetry.New(opts)
}

type configFolder struct{ dir string }

func (c configFolder) ReadConfigFile(name string) ([]byte, error) {
	return os.ReadFile(filepath.Join(c.dir, name))
}

func (c configFolder) WriteConfigFile(name string, data []byte, mode os.FileMode) error {
	if err := os.MkdirAll(c.dir, 0o700); err != nil {
		return err
	}
	return os.WriteFile(filepath.Join(c.dir, name), data, mode)
}
