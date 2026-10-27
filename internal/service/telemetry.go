package service

import "github.com/ajnart/self-host/internal/telemetry"

// Telemetry returns the Telemetry client for this machine; it sends through
// the Deps' HTTP transport.
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
	return telemetry.New(opts)
}
