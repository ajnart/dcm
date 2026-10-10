package service

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path"
	"slices"
	"strconv"
	"strings"

	"github.com/ajnart/self-host/internal/app"
	"github.com/ajnart/self-host/internal/compose"
	"github.com/ajnart/self-host/internal/events"
	"github.com/ajnart/self-host/internal/helpers"
	"github.com/ajnart/self-host/internal/host"
	"github.com/ajnart/self-host/internal/project"
	stepstatus "github.com/ajnart/self-host/internal/status"
)

type InstallOptions struct {
	// Targets are App or Recipe IDs.
	Targets []string
	// Sets are "app.key=value" or "key=value" inputs.
	Sets []string
	// SetFiles are private input references in "app.key=PATH" form.
	SetFiles []string
	// PrivateInputs carries interactive values only in memory.
	PrivateInputs map[string]map[string]string
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
		_, ids, found := s.Catalog.Expand(target)
		if !found {
			return nil, fmt.Errorf("unknown app or recipe %q (see: self-host apps list)", target)
		}
		for _, id := range ids {
			if err := add(id); err != nil {
				return nil, err
			}
		}
	}
	if len(apps) == 0 {
		return nil, errors.New("nothing to install; name at least one app or recipe")
	}
	return apps, nil
}

// recipeOf maps each App to the first Recipe named in targets that includes
// it; an App named only by its own ID has none.
func (s *Service) recipeOf(targets []string) map[string]string {
	out := map[string]string{}
	for _, target := range targets {
		recipe, ids, _ := s.Catalog.Expand(target)
		if recipe == "" {
			continue
		}
		for _, id := range ids {
			if _, taken := out[id]; !taken {
				out[id] = recipe
			}
		}
	}
	return out
}

// resolveInputs applies sets and defaults and reports missing required inputs.
func resolveInputs(apps []app.App, sets []string, previous map[string]map[string]string) (map[string]map[string]string, error) {
	scoped := map[string]map[string]string{}
	global := map[string]string{}
	for _, set := range sets {
		key, value, found := strings.Cut(set, "=")
		if !found || key == "" {
			return nil, fmt.Errorf("--set requires key=value or app.key=value")
		}
		for _, a := range apps {
			for _, input := range a.Inputs() {
				if input.Private && (key == input.Key || key == a.Info().ID+"."+input.Key) {
					return nil, fmt.Errorf("private input %s.%s must use --set-file %s.%s=PATH", a.Info().ID, input.Key, a.Info().ID, input.Key)
				}
			}
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
			if input.Private {
				delete(values, input.Key)
				continue
			}
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
			if input.Validate != nil {
				if err := input.Validate(values[input.Key]); err != nil {
					return nil, fmt.Errorf("invalid input %s.%s: %w", id, input.Key, err)
				}
			}
		}
		result[id] = values
	}
	if len(missing) > 0 {
		return nil, fmt.Errorf("missing required input: %s (pass --set %s=VALUE)", strings.Join(missing, ", "), missing[0])
	}
	return result, nil
}

// requireDocker reports warnings before apply and fails with the first failing check.
func (s *Service) requireDocker(ctx context.Context) error {
	for _, check := range host.Docker(ctx, s.Deps) {
		if check.Level == host.Warn {
			s.Log.Emit(events.Event{Event: events.StepWarn, Step: check.ID, Msg: check.Title + ": " + check.Detail,
				Hint: check.Hint, Docs: check.Docs})
		}
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
	return s.install(ctx, opts, nil)
}

func (s *Service) install(ctx context.Context, opts InstallOptions, locked *project.Project) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	apps, err := s.Resolve(opts.Targets)
	if err != nil {
		return err
	}
	if _, err := privateReferences(apps, opts); err != nil {
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
	preflightInputs, err := resolveInputs(apps, opts.Sets, previous)
	if err != nil {
		return err
	}
	if !p.Exists() {
		if _, err := s.resolvePrivateInputs(p, nil, apps, opts, preflightInputs); err != nil {
			return err
		}
		opts.SetFiles = nil
		opts.PrivateInputs = map[string]map[string]string{}
		for _, a := range apps {
			id := a.Info().ID
			opts.PrivateInputs[id] = map[string]string{}
			for _, input := range a.Inputs() {
				if input.Private {
					opts.PrivateInputs[id][input.Key] = preflightInputs[id][input.Key]
				}
			}
		}
	}
	if opts.Exposure != "" && opts.Exposure != ExposureLAN && opts.Exposure != ExposureLocal {
		return fmt.Errorf("--exposure must be %s or %s", ExposureLAN, ExposureLocal)
	}
	for _, a := range apps {
		if preflight, ok := a.(app.PreflightChecker); ok {
			h := helpers.New(helpers.Config{App: a.Info().ID, Dir: p.Path("apps", a.Info().ID), Inputs: publicInputs(a, preflightInputs[a.Info().ID]), Log: s.Log})
			if err := preflight.Preflight(ctx, h); err != nil {
				return err
			}
		}
	}
	if err := s.requireDocker(ctx); err != nil {
		return err
	}

	recipes := s.recipeOf(opts.Targets)
	names := make([]string, len(apps))
	for i, a := range apps {
		names[i] = a.Info().ID
	}
	var nodes []string
	run := s.run
	if locked != nil {
		run = func(ctx context.Context, c change) error { return s.runLocked(ctx, c, locked) }
	}
	return run(ctx, change{
		services:   func() []string { return nodes },
		title:      "install " + strings.Join(names, " "),
		initialize: func(p *project.Project) error { return s.createProject(ctx, p, opts) },
		edit: func(ctx context.Context, ss *session) error {
			var containers []compose.Container
			if ss.tailscaleOn() && !slices.Contains(names, tailscaleID) {
				var err error
				containers, err = ss.compose.Ps(ctx)
				if err != nil {
					return err
				}
			}
			previous := map[string]map[string]string{}
			for id, st := range ss.state.Apps {
				previous[id] = st.Inputs
			}
			inputs, err := resolveInputs(apps, opts.Sets, previous)
			if err != nil {
				return err
			}
			if err := ss.applyPrivateInputs(apps, opts, inputs); err != nil {
				return err
			}
			if err := ss.ensureAdmin(opts); err != nil {
				return err
			}
			for _, a := range apps {
				info := a.Info()
				st := ss.state.Apps[info.ID]
				if st == nil {
					st = &project.AppState{Setup: stepstatus.SetupPending, Recipe: recipes[info.ID]}
					ss.state.Apps[info.ID] = st
				}
				values := inputs[info.ID]
				port, err := ss.allocatePort(info, values["port"], st.Port)
				if err != nil {
					return err
				}
				delete(values, "port")
				if err := ss.ensureSecrets(a); err != nil {
					return err
				}
				previousPort, previousInputs := st.Port, st.Inputs
				st.Port, st.Inputs = port, publicInputs(a, values)
				if preflight, ok := a.(app.PreflightChecker); ok {
					if err := preflight.Preflight(ctx, ss.helpers(a)); err != nil {
						return err
					}
				}
				ss.emitStage([]string{info.ID}, events.Event{Event: events.StepStart, App: info.ID, Step: StageRender, Msg: "render " + info.ID})
				fragment := a.Compose(app.RenderContext{Port: port, Inputs: values})
				if err := ss.p.ValidateFragment(info.ID, fragment); err != nil {
					st.Port, st.Inputs = previousPort, previousInputs
					return errors.Join(err, ss.recordStage([]string{info.ID}, events.Event{Event: events.StepFail, App: info.ID, Step: StageRender, Error: err.Error()}))
				}
				if err := ss.writeFiles(a, app.RenderContext{Port: port, Inputs: values}); err != nil {
					return errors.Join(err, ss.recordStage([]string{info.ID}, events.Event{Event: events.StepFail, App: info.ID, Step: StageRender, Error: err.Error()}))
				}
				if err := ss.p.WriteFragment(info.ID, fragment); err != nil {
					return errors.Join(err, ss.recordStage([]string{info.ID}, events.Event{Event: events.StepFail, App: info.ID, Step: StageRender, Error: err.Error()}))
				}
				if err := ss.recordStage([]string{info.ID}, events.Event{Event: events.StepOK, App: info.ID, Step: StageRender,
					Msg: fmt.Sprintf("wrote apps/%s/compose.yml (%s on port %d)", info.ID, info.Image, port)}); err != nil {
					return err
				}
			}
			_, err = ss.renderTailscale()
			if err != nil {
				return err
			}
			if !slices.Contains(names, tailscaleID) {
				nodes = ss.pendingTailscaleServices(names, containers)
			}
			return ss.ensureMediaFolders(apps)
		},
		targets: func(*session) ([]string, error) { return names, nil },
		compose: composePullUp,
		after:   afterSetup,
	})
}

func (s *Service) createProject(ctx context.Context, p *project.Project, opts InstallOptions) error {
	settings := s.detectSettings(ctx, p.Owner, opts.Exposure)
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
		values["ADMIN_PASSWORD"] = generateAdminPassword()
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

// writeFiles writes the config files an App declares into its folder.
func (ss *session) writeFiles(a app.App, rc app.RenderContext) error {
	declarer, found := a.(app.FileDeclarer)
	if !found {
		return nil
	}
	id := a.Info().ID
	secret := func(name string) string {
		if name == "ADMIN_USER" || name == "ADMIN_PASSWORD" {
			return ss.secrets.values[name]
		}
		return ss.secrets.values[SecretKey(id, name)]
	}
	for _, f := range declarer.Files(rc, secret) {
		clean := path.Clean(f.Path)
		if path.IsAbs(clean) || clean == "." || strings.HasPrefix(clean, "..") {
			return fmt.Errorf("%s: file %q must stay inside apps/%s", id, f.Path, id)
		}
		if _, err := os.Stat(ss.p.Path("apps", id, clean)); err == nil && f.Keep {
			continue
		}
		mode := os.FileMode(f.Mode)
		if mode == 0 {
			mode = 0o644
		}
		if err := ss.p.WriteAppFile(id, clean, []byte(f.Content), mode); err != nil {
			return err
		}
	}
	return nil
}

// ensureSecrets generates the secrets an App declares that secrets.env lacks.
func (ss *session) ensureSecrets(a app.App) error {
	declarer, found := a.(app.SecretDeclarer)
	if !found {
		return nil
	}
	id := a.Info().ID
	for _, spec := range declarer.Secrets() {
		key := SecretKey(id, spec.Name)
		if ss.secrets.values[key] != "" {
			ss.s.Log.Secret(ss.secrets.values[key])
			continue
		}
		value := GeneratePassword(spec.Length)
		if spec.Hex {
			value = GenerateHex(spec.Length)
		}
		ss.s.Log.Secret(value)
		if err := ss.secrets.Set(key, value); err != nil {
			return err
		}
		ss.s.Log.Emit(events.Event{Event: events.StepOK, App: id, Step: "secret",
			Msg: "generated " + key + " (show it with: self-host credentials)"})
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
	var touched []string
	for _, a := range apps {
		incomplete, err := ss.runSetup(ctx, a)
		if err != nil {
			return err
		}
		touched = append(append(touched, a.Info().ID), incomplete...)
	}
	// A later App's Setup can complete an earlier consumer's Link, so the
	// verdict is read once every App has run.
	var failed, manual []string
	for _, id := range touched {
		if st := ss.state.Apps[id]; st != nil && st.Setup == stepstatus.SetupManual && !slices.Contains(manual, id) {
			manual = append(manual, id)
		}
		if st := ss.state.Apps[id]; st != nil && st.Setup == stepstatus.SetupIncomplete && !slices.Contains(failed, id) {
			failed = append(failed, id)
		}
	}
	if len(failed) > 0 {
		return fmt.Errorf("%w for %s; finish the failed steps using their hints, then run: self-host setup %s",
			ErrIncomplete, strings.Join(failed, ", "), strings.Join(failed, " "))
	}
	if len(manual) > 0 {
		return fmt.Errorf("%w for %s; follow their hints, then run: self-host setup %s", ErrManual, strings.Join(manual, ", "), strings.Join(manual, " "))
	}
	return nil
}

func (s *Service) finish(err error) error {
	switch {
	case err == nil:
		s.Log.Emit(events.Event{Event: events.RunEnd, Msg: "done"})
	case errors.Is(err, ErrIncomplete), errors.Is(err, ErrManual):
		s.Log.Emit(events.Event{Event: events.RunEnd, Msg: err.Error()})
	}
	return s.Log.RedactError(err)
}

// Setup reruns Setup for installed catalog Apps (all when ids is empty).
func (s *Service) Setup(ctx context.Context, ids []string) error {
	return s.run(ctx, change{
		title: "setup " + strings.Join(ids, " "),
		targets: func(ss *session) ([]string, error) {
			if len(ids) == 0 {
				for id := range ss.state.Apps {
					ids = append(ids, id)
				}
				sortStrings(ids)
			}
			for _, id := range ids {
				if _, found := s.Catalog.App(id); !found {
					return nil, fmt.Errorf("%s is not a catalog App; Setup only runs for catalog Apps", id)
				}
				if ss.state.Apps[id] == nil {
					return nil, fmt.Errorf("%s is not installed (run: self-host install %s)", id, id)
				}
			}
			return ids, nil
		},
		after: afterSetup,
	})
}

// ensureMediaFolders creates the media and downloads folders before Docker
// would create them owned by root.
func (ss *session) ensureMediaFolders(apps []app.App) error {
	for _, a := range apps {
		if !a.Info().UsesMedia {
			continue
		}
		for _, key := range []string{"MEDIA_ROOT", "DOWNLOADS_ROOT"} {
			dir := ss.settings[key]
			if dir == "" {
				continue
			}
			if err := os.MkdirAll(dir, 0o755); err != nil {
				return fmt.Errorf("%s %s: %w", key, dir, err)
			}
			if os.Geteuid() == 0 {
				os.Chown(dir, ss.p.Owner.UID, ss.p.Owner.GID)
			}
		}
		return nil
	}
	return nil
}
