package service

import (
	"context"
	"errors"
	"fmt"
	"strconv"
	"strings"

	"github.com/ajnart/self-host/internal/app"
	"github.com/ajnart/self-host/internal/events"
	"github.com/ajnart/self-host/internal/helpers"
	"github.com/ajnart/self-host/internal/host"
	"github.com/ajnart/self-host/internal/project"
)

type InstallOptions struct {
	// Targets are App or Recipe IDs.
	Targets []string
	// Sets are "app.key=value" or "key=value" inputs.
	Sets []string
	// Exposure, MediaRoot and DownloadsRoot apply when the Project is created.
	Exposure      string
	MediaRoot     string
	DownloadsRoot string
	AdminUser     string
	AdminPassword string
	// Settings overrides detected Host settings for a new Project.
	Settings map[string]string
}

// Resolve expands Recipe IDs into App IDs, keeping order and removing duplicates.
func (s *Service) Resolve(targets []string) ([]app.App, error) {
	var apps []app.App
	seen := map[string]bool{}
	add := func(id string) error {
		a, found := s.Catalog.App(id)
		if !found {
			return fmt.Errorf("unknown app or recipe %q (see: self-host apps list)", id)
		}
		if !seen[id] {
			seen[id] = true
			apps = append(apps, a)
		}
		return nil
	}
	for _, target := range targets {
		if recipe, found := s.Catalog.Recipe(target); found {
			for _, id := range recipe.Apps {
				if err := add(id); err != nil {
					return nil, err
				}
			}
			continue
		}
		if err := add(target); err != nil {
			return nil, err
		}
	}
	if len(apps) == 0 {
		return nil, errors.New("nothing to install; name at least one app or recipe")
	}
	return apps, nil
}

// resolveInputs applies sets and defaults and reports missing required inputs.
func resolveInputs(apps []app.App, sets []string, previous map[string]map[string]string) (map[string]map[string]string, error) {
	scoped := map[string]map[string]string{}
	global := map[string]string{}
	for _, set := range sets {
		key, value, found := strings.Cut(set, "=")
		if !found || key == "" {
			return nil, fmt.Errorf("--set %q: want key=value or app.key=value", set)
		}
		if appID, name, ok := strings.Cut(key, "."); ok {
			if scoped[appID] == nil {
				scoped[appID] = map[string]string{}
			}
			scoped[appID][name] = value
		} else {
			global[key] = value
		}
	}
	result := map[string]map[string]string{}
	var missing []string
	for _, a := range apps {
		id := a.Info().ID
		values := map[string]string{}
		for key, value := range previous[id] {
			values[key] = value
		}
		if port, found := scoped[id]["port"]; found {
			values["port"] = port
		}
		for _, input := range a.Inputs() {
			if value, found := scoped[id][input.Key]; found {
				values[input.Key] = value
			} else if value, found := global[input.Key]; found {
				values[input.Key] = value
			} else if _, found := values[input.Key]; !found && input.Default != "" {
				values[input.Key] = input.Default
			}
			if input.Required && values[input.Key] == "" {
				missing = append(missing, id+"."+input.Key)
			}
		}
		result[id] = values
	}
	if len(missing) > 0 {
		return nil, fmt.Errorf("missing required input: %s (pass --set %s=VALUE)", strings.Join(missing, ", "), missing[0])
	}
	return result, nil
}

// requireDocker fails with the first failing Docker check.
func (s *Service) requireDocker(ctx context.Context) error {
	for _, check := range host.Docker(ctx, s.Deps) {
		if check.Level == host.Fail {
			msg := check.Title + ": " + check.Detail
			if check.Hint != "" {
				msg += ". " + check.Hint
			}
			if check.Docs != "" {
				msg += " Docs: " + check.Docs
			}
			return errors.New(msg)
		}
	}
	return nil
}

func (s *Service) Install(ctx context.Context, opts InstallOptions) error {
	apps, err := s.Resolve(opts.Targets)
	if err != nil {
		return err
	}
	p, err := s.Project()
	if err != nil {
		return err
	}
	var previous map[string]map[string]string
	if p.Exists() {
		state, err := p.LoadState()
		if err != nil {
			return err
		}
		previous = map[string]map[string]string{}
		for id, st := range state.Apps {
			previous[id] = st.Inputs
		}
	}
	inputs, err := resolveInputs(apps, opts.Sets, previous)
	if err != nil {
		return err
	}
	if opts.Exposure != "" && opts.Exposure != ExposureLAN && opts.Exposure != ExposureLocal {
		return fmt.Errorf("--exposure must be %s or %s", ExposureLAN, ExposureLocal)
	}
	if err := s.requireDocker(ctx); err != nil {
		return err
	}

	names := make([]string, len(apps))
	for i, a := range apps {
		names[i] = a.Info().ID
	}
	s.Log.Emit(events.Event{Event: events.RunStart, Msg: "install " + strings.Join(names, " ")})

	if !p.Exists() {
		if err := s.createProject(p, opts); err != nil {
			return err
		}
	}
	unlock, err := s.lock(p)
	if err != nil {
		return err
	}
	defer unlock()
	ss, err := s.open(ctx)
	if err != nil {
		return err
	}
	if err := ss.ensureAdmin(opts); err != nil {
		return err
	}

	for _, a := range apps {
		info := a.Info()
		st := ss.state.Apps[info.ID]
		if st == nil {
			st = &project.AppState{Setup: "pending"}
			ss.state.Apps[info.ID] = st
		}
		values := inputs[info.ID]
		port, err := ss.allocatePort(info, values["port"], st.Port)
		if err != nil {
			return err
		}
		delete(values, "port")
		st.Port, st.Inputs = port, values
		if err := ss.p.WriteFragment(info.ID, a.Compose(app.RenderContext{Port: port, Inputs: values})); err != nil {
			return err
		}
		s.Log.Emit(events.Event{Event: events.StepOK, App: info.ID, Step: "render",
			Msg: fmt.Sprintf("wrote apps/%s/compose.yml (%s on port %d)", info.ID, info.Image, port)})
	}
	if err := ss.p.WriteRoot(); err != nil {
		return err
	}
	if err := ss.p.SaveState(ss.state); err != nil {
		return err
	}
	services, err := ss.services(names...)
	if err != nil {
		return err
	}
	if err := ss.compose.Up(ctx, services...); err != nil {
		return err
	}
	s.Log.Emit(events.Event{Event: events.StepOK, Step: "start", Msg: "started " + strings.Join(names, ", ")})
	return s.finish(ss.setupAll(ctx, apps))
}

func (s *Service) createProject(p *project.Project, opts InstallOptions) error {
	settings := s.DetectSettings(p.Owner, opts.Exposure)
	for key, value := range opts.Settings {
		if value != "" && key != "EXPOSURE" && key != "BIND_IP" {
			settings[key] = value
		}
	}
	if opts.MediaRoot != "" {
		settings["MEDIA_ROOT"] = opts.MediaRoot
	}
	if opts.DownloadsRoot != "" {
		settings["DOWNLOADS_ROOT"] = opts.DownloadsRoot
	}
	if err := p.MkdirAll(); err != nil {
		return err
	}
	if err := p.SaveSettings(settings); err != nil {
		return err
	}
	s.Log.Emit(events.Event{Event: events.StepOK, Step: "project",
		Msg: fmt.Sprintf("created %s (exposure %s, LAN IP %s, TZ %s, PUID %s, PGID %s)", p.Root,
			settings["EXPOSURE"], settings["LAN_IP"], settings["TZ"], settings["PUID"], settings["PGID"])})
	return nil
}

func (ss *session) ensureAdmin(opts InstallOptions) error {
	values := ss.secrets.values
	if opts.AdminUser != "" {
		values["ADMIN_USER"] = opts.AdminUser
	}
	if values["ADMIN_USER"] == "" {
		values["ADMIN_USER"] = "admin"
	}
	if opts.AdminPassword != "" {
		values["ADMIN_PASSWORD"] = opts.AdminPassword
	}
	generated := values["ADMIN_PASSWORD"] == ""
	if generated {
		values["ADMIN_PASSWORD"] = GeneratePassword(20)
	}
	if err := project.ValidEnvValue(values["ADMIN_PASSWORD"]); err != nil {
		return fmt.Errorf("admin password: %w", err)
	}
	ss.s.Log.Secret(values["ADMIN_PASSWORD"])
	if err := ss.p.SaveSecrets(values); err != nil {
		return err
	}
	if generated {
		ss.s.Log.Emit(events.Event{Event: events.StepOK, Step: "admin-login",
			Msg: "generated the Admin login for user " + values["ADMIN_USER"] + " (show it with: self-host credentials)"})
	}
	return nil
}

// allocatePort keeps an App's existing port, honours an explicit one, and
// otherwise takes the first free port from the App's default.
func (ss *session) allocatePort(info app.Info, requested string, current int) (int, error) {
	if requested != "" {
		port, err := strconv.Atoi(requested)
		if err != nil || port < 1 || port > 65535 {
			return 0, fmt.Errorf("%s.port: %q is not a port", info.ID, requested)
		}
		return port, nil
	}
	if current != 0 {
		return current, nil
	}
	used := map[int]bool{}
	for id, st := range ss.state.Apps {
		if id != info.ID {
			used[st.Port] = true
		}
	}
	for port := info.Port; port <= 65535; port++ {
		if !used[port] && ss.s.Deps.PortFree(port) {
			if port != info.Port {
				ss.s.Log.Emit(events.Event{Event: events.StepWarn, App: info.ID, Step: "port",
					Msg: fmt.Sprintf("port %d is taken, using %d", info.Port, port)})
			}
			return port, nil
		}
	}
	return 0, fmt.Errorf("%s: no free port from %d", info.ID, info.Port)
}

// setupAll runs Setup for each App, continuing past failures.
func (ss *session) setupAll(ctx context.Context, apps []app.App) error {
	var failed []string
	for _, a := range apps {
		if err := ss.runSetup(ctx, a); err != nil {
			if !errors.Is(err, helpers.ErrStepFailed) {
				ss.s.Log.Emit(events.Event{Event: events.StepFail, App: a.Info().ID, Step: "setup", Error: err.Error()})
			}
			failed = append(failed, a.Info().ID)
		}
	}
	if len(failed) > 0 {
		return fmt.Errorf("%w for %s; finish the failed steps using their hints, then run: self-host setup %s",
			ErrIncomplete, strings.Join(failed, ", "), strings.Join(failed, " "))
	}
	return nil
}

func (s *Service) finish(err error) error {
	switch {
	case err == nil:
		s.Log.Emit(events.Event{Event: events.RunEnd, Msg: "done"})
	case errors.Is(err, ErrIncomplete):
		s.Log.Emit(events.Event{Event: events.RunEnd, Msg: err.Error()})
	}
	return err
}

// Setup reruns Setup for installed catalog Apps (all when ids is empty).
func (s *Service) Setup(ctx context.Context, ids []string) error {
	p, err := s.Project()
	if err != nil {
		return err
	}
	if !p.Exists() {
		return ErrNoProject
	}
	unlock, err := s.lock(p)
	if err != nil {
		return err
	}
	defer unlock()
	ss, err := s.open(ctx)
	if err != nil {
		return err
	}
	if len(ids) == 0 {
		for id := range ss.state.Apps {
			ids = append(ids, id)
		}
		sortStrings(ids)
	}
	var apps []app.App
	for _, id := range ids {
		a, found := s.Catalog.App(id)
		if !found {
			return fmt.Errorf("%s is not a catalog App; Setup only runs for catalog Apps", id)
		}
		if ss.state.Apps[id] == nil {
			return fmt.Errorf("%s is not installed (run: self-host install %s)", id, id)
		}
		apps = append(apps, a)
	}
	s.Log.Emit(events.Event{Event: events.RunStart, Msg: "setup " + strings.Join(ids, " ")})
	return s.finish(ss.setupAll(ctx, apps))
}
