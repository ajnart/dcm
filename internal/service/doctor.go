package service

import (
	"context"
	"fmt"
	"strconv"
	"strings"

	"github.com/ajnart/self-host/internal/compose"
	"github.com/ajnart/self-host/internal/host"
)

// Doctor runs host checks, then per-App container, binding and LAN
// reachability checks when a Project exists.
func (s *Service) Doctor(ctx context.Context) []host.Check {
	checks := host.Docker(ctx, s.Deps)
	if host.Worst(checks) == host.Fail {
		return checks
	}
	ss, err := s.open(ctx)
	if err != nil {
		return checks
	}
	if err := ss.p.LockError(); err != nil {
		checks = append(checks, host.Check{ID: "project-lock", Title: "Project lock", Level: host.Fail, Detail: err.Error()})
	}
	if rootless, err := host.Rootless(ctx, s.Deps); err == nil && rootless && (ss.settings["PUID"] != "0" || ss.settings["PGID"] != "0") {
		checks = append(checks, host.Check{ID: "project-userns", Title: "Project container IDs", Level: host.Warn,
			Detail: fmt.Sprintf("rootless Docker maps host-user-owned folders to container 0:0, but this Project uses PUID=%s PGID=%s; Apps using these IDs may be unable to write bind mounts", ss.settings["PUID"], ss.settings["PGID"]),
			Hint:   "Review existing bind-mount ownership first; for host-user-owned folders use: self-host config set PUID=0 PGID=0. Images with fixed nonzero users and their backups need separate ownership/read access."})
	}
	status, err := s.Status(ctx)
	if err != nil {
		return append(checks, host.Check{ID: "project", Title: "Project", Level: host.Fail, Detail: err.Error()})
	}
	containers, _ := ss.compose.Ps(ctx)
	byService := map[string]compose.Container{}
	for _, c := range containers {
		byService[c.Service] = c
	}
	if status.Names != nil {
		check := host.Check{ID: "easy-names", Title: "Easy names at home", Level: host.OK, Detail: "Names resolve, checked from this computer, not your phone or TV."}
		if !status.Names.Working {
			check.Level, check.Detail, check.Hint = host.Warn, status.Names.Message, "Use the addresses with numbers; see self-host status --json for Technical details."
		}
		checks = append(checks, check)
	}

	lan := status.Exposure != ExposureLocal
	if lan {
		checks = append(checks, host.Check{ID: "exposure", Title: "Access", Level: host.OK,
			Detail: "Home network: other devices connect to " + status.LANIP}, s.lanCheck(ss.settings))
	} else {
		checks = append(checks, host.Check{ID: "exposure", Title: "Access", Level: host.Warn,
			Detail: "this machine only: other devices cannot connect (TVs, phones, other computers)",
			Hint:   "To reach Apps from other devices run: self-host config set EXPOSURE=lan"})
	}
	var ports []string
	if ss.namesOn() {
		ports = append(ports, "80")
	}
	for _, app := range status.Apps {
		if app.Port != 0 {
			ports = append(ports, strconv.Itoa(app.Port))
		}
	}
	if lan {
		checks = append(checks, host.Firewall(ctx, s.Deps, strings.Join(ports, ",")))
	}

	for _, app := range status.Apps {
		checks = append(checks, s.appChecks(ctx, app, byService, lan)...)
	}
	return checks
}

func (s *Service) appChecks(ctx context.Context, app AppStatus, byService map[string]compose.Container, lan bool) []host.Check {
	id := app.ID
	if app.State != "running" {
		return []host.Check{{ID: "running", App: id, Title: "Container", Level: host.Fail,
			Detail: "state " + app.State, Hint: "Start it with: self-host start " + id + " (logs: self-host logs " + id + ")"}}
	}
	checks := []host.Check{{ID: "running", App: id, Title: "Container", Level: host.OK, Detail: "running " + app.Health}}

	bind := ""
	for _, name := range append([]string{mainService(app)}, app.Services...) {
		for _, pub := range byService[name].Publishers {
			if pub.PublishedPort == app.Port || app.Port == 0 {
				bind = pub.URL
				break
			}
		}
		if bind != "" {
			break
		}
	}
	loopback := strings.HasPrefix(bind, "127.") || bind == "::1"
	switch {
	case bind == "":
		checks = append(checks, host.Check{ID: "binding", App: id, Title: "Port", Level: host.Warn,
			Detail: "no published port found", Hint: "The App is not reachable from outside Docker; check apps/" + id + "/compose.yml ports."})
	case lan && loopback:
		checks = append(checks, host.Check{ID: "binding", App: id, Title: "Port", Level: host.Fail,
			Detail: fmt.Sprintf("port %d is bound to %s, so other devices cannot connect", app.Port, bind),
			Hint:   "Recreate it with the current Access: self-host start " + id})
	case !lan && !loopback:
		checks = append(checks, host.Check{ID: "binding", App: id, Title: "Port", Level: host.Warn,
			Detail: fmt.Sprintf("port %d is bound to %s although Access is this machine only", app.Port, bind),
			Hint:   "Recreate it with the current Access: self-host start " + id})
	default:
		checks = append(checks, host.Check{ID: "binding", App: id, Title: "Port", Level: host.OK,
			Detail: fmt.Sprintf("port %d bound to %s", app.Port, bind)})
	}

	if app.URL != "" {
		if err := host.Reachable(ctx, s.Deps.HTTP, app.URL); err != nil {
			checks = append(checks, host.Check{ID: "reachable", App: id, Title: "Reachable", Level: host.Fail,
				Detail: err.Error(), Hint: "Check the App's logs (self-host logs " + id + ") and the firewall check above."})
		} else {
			checks = append(checks, host.Check{ID: "reachable", App: id, Title: "Reachable", Level: host.OK, Detail: "answers on " + app.URL})
		}
	}
	return checks
}

func mainService(app AppStatus) string {
	if len(app.Services) == 1 {
		return app.Services[0]
	}
	return app.ID
}
