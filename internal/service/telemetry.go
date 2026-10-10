package service

import "github.com/ajnart/self-host/internal/telemetry"

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
		Config:  s.Deps.ConfigFiles,
	}
	if s.Deps.HTTP != nil {
		opts.Transport = s.Deps.HTTP.Transport
	}
	if p, err := s.Project(); err == nil {
		opts.Store = p
	}
	return telemetry.New(opts)
}
