package service

import (
	"context"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"slices"
	"strings"

	"github.com/ajnart/self-host/internal/app"
	"github.com/ajnart/self-host/internal/compose"
	"github.com/ajnart/self-host/internal/events"
	"github.com/ajnart/self-host/internal/helpers"
	"github.com/ajnart/self-host/internal/project"
	stepstatus "github.com/ajnart/self-host/internal/status"
)

// composeStep is the Compose work a change runs after edit.
type composeStep int

const (
	composeNone composeStep = iota
	// composePullUp pulls the targets' images before recreating them.
	composePullUp
	composeUp
	composeStop
	composeDown
	composeRestart
	composeRemove
)

// afterStep runs once Compose succeeded.
type afterStep int

const (
	afterNone afterStep = iota
	afterSetup
	afterCheck
	afterDashboard
	// afterUnmanagedDashboard refreshes the dashboard only when a target is an
	// Unmanaged app, whose tile no Link creates.
	afterUnmanagedDashboard
)

// change is one mutation of the Project, declared by a verb.
type change struct {
	services func() []string
	title    string
	// initialize creates a missing Project while holding the mutation lock.
	initialize func(*project.Project) error
	// edit changes the session before Compose runs: render Apps, settings, fragments, unlink.
	edit func(ctx context.Context, ss *session) error
	// targets returns the App ids Compose acts on, after edit.
	targets func(ss *session) ([]string, error)
	compose composeStep // none, pullUp, up, stop, down, restart, remove
	// after runs once Compose succeeded: Setup (with Links), or only Check.
	after afterStep // none, setup, check
	// purge deletes the App's data folder when compose is remove.
	purge          bool
	preflight      func(context.Context, *project.Project) error
	namesStart     func(*session) bool
	namesCancel    bool
	reconcileNames bool
	namesTargets   func() []string
	complete       func(*session) error
}

// run owns every Project mutation: it takes the lock, opens the session,
// refreshes the root Compose file, runs the declared edit, saves state,
// resolves the targets' services, runs Compose, then the after step.
func (s *Service) run(ctx context.Context, c change) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	p, err := s.Project()
	if err != nil {
		return err
	}
	if !p.Exists() && c.initialize == nil && c.compose != composeDown {
		return ErrNoProject
	}
	unlock, err := p.LockContext(ctx, s.Deps.PID, s.Deps.ProcessAlive)
	if err != nil {
		return err
	}
	defer unlock()
	return s.runLocked(ctx, c, p)
}

func (s *Service) runLocked(ctx context.Context, c change, p *project.Project) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	if !p.Exists() && c.compose == composeDown {
		pending, err := p.LoadRestoreStartup()
		if err != nil {
			return err
		}
		if pending == nil {
			return ErrNoProject
		}
		return s.finish(p.ClearRestoreStartup(""))
	}
	if c.preflight != nil {
		if err := c.preflight(ctx, p); err != nil {
			return err
		}
	} else if p.Exists() && c.after != afterNone && c.compose != composeStop && c.compose != composeDown {
		settings, err := p.LoadSettings()
		if err != nil {
			return err
		}
		if settings[settingNames] == namesOn {
			if check := s.CheckEasyNames(ctx); !check.Available {
				return &NamesBlocked{check}
			}
		}
	}
	if err := ctx.Err(); err != nil {
		return err
	}
	started := false
	if !p.Exists() {
		if c.initialize == nil {
			return ErrNoProject
		}
		s.Log.Emit(events.Event{Event: events.RunStart, Msg: c.title})
		started = true
		if err := c.initialize(p); err != nil {
			return err
		}
	}
	if err := p.RecoverState(); err != nil {
		return err
	}
	ss, err := s.open(ctx)
	if err != nil {
		return err
	}
	startNames := c.namesStart != nil && c.namesStart(ss)
	namesRuntime, err := ss.p.LoadNamesRuntime()
	if err != nil {
		return s.finish(err)
	}
	if namesRuntime.StartAction != "" && namesRuntime.StartAction == c.title && ss.namesOn() {
		startNames = true
	}
	if startNames {
		namesRuntime.StartAction = c.title
		if err := ss.p.SaveNamesRuntime(namesRuntime); err != nil {
			return s.finish(err)
		}
	} else if (c.compose == composeDown || c.namesCancel) && namesRuntime.StartAction != "" {
		namesRuntime.StartAction = ""
		if err := ss.p.SaveNamesRuntime(namesRuntime); err != nil {
			return s.finish(err)
		}
	}
	if c.compose == composeDown {
		if err := ss.p.ClearRestoreStartup(""); err != nil {
			return s.finish(err)
		}
	}
	if err := ss.migratePrivateInputs(); err != nil {
		return s.finish(err)
	}
	if err := ss.p.WriteRoot(); err != nil {
		return s.finish(err)
	}
	if !started {
		s.Log.Emit(events.Event{Event: events.RunStart, Msg: c.title})
	}
	if c.edit != nil {
		if err := c.edit(ctx, ss); err != nil {
			return s.finish(err)
		}
	}
	if err := ctx.Err(); err != nil {
		return s.finish(err)
	}
	if err := ss.p.WriteRoot(); err != nil {
		return s.finish(err)
	}
	if err := ss.p.SaveState(ss.state); err != nil {
		return s.finish(err)
	}
	var ids []string
	if c.targets != nil {
		if ids, err = c.targets(ss); err != nil {
			return s.finish(err)
		}
	}
	if c.compose != composeNone {
		err = s.runCompose(ctx, ss, c, ids)
	}
	if werr := ss.p.WriteRoot(); werr != nil && err == nil {
		err = werr
	}
	if (c.after != afterNone || c.reconcileNames) && err == nil {
		if c.compose != composeStop && c.compose != composeDown {
			var configured []string
			if c.namesTargets != nil {
				configured = c.namesTargets()
			}
			err = ss.syncNames(ctx, startNames, configured)
		}
	}
	if c.after != afterNone && err == nil {
		err = s.runAfter(ctx, ss, c.after, ids)
	}
	if serr := ss.p.SaveState(ss.state); serr != nil && err == nil {
		err = serr
	}
	if err == nil && c.complete != nil {
		err = c.complete(ss)
	}
	if c.compose == composeStop && slices.Contains(ids, cloudflareConnector) {
		err = errors.Join(err, ss.refreshRunningDashboard(ctx))
	}
	return s.finish(err)
}

// runCompose resolves the targets' services and runs the declared verb.
func (s *Service) runCompose(ctx context.Context, ss *session, c change, ids []string) error {
	if c.compose == composeRestart {
		blocked, err := ss.cloudflareSuspended()
		if err != nil {
			return err
		}
		if blocked {
			ids = slices.DeleteFunc(slices.Clone(ids), func(id string) bool { return id == cloudflareConnector })
		}
	}
	if c.compose == composeRemove {
		return s.removeApps(ctx, ss, ids, c.purge)
	}
	if len(ids) == 0 {
		return nil
	}
	if c.compose == composeDown {
		if err := ss.p.ValidateServiceOwnership(nil); err != nil {
			return err
		}
		if err := ss.compose.Down(ctx); err != nil {
			return err
		}
		s.Log.Emit(events.Event{Event: events.StepOK, Step: "down", Msg: "Project containers and networks removed; volumes kept"})
		return nil
	}
	if c.compose == composeUp || c.compose == composePullUp || c.compose == composeRestart {
		if err := ss.p.ValidateServiceOwnership(nil); err != nil {
			return err
		}
		for _, id := range ids {
			a, found := s.Catalog.App(id)
			if !found {
				continue
			}
			if preflight, ok := a.(app.PreflightChecker); ok {
				if err := preflight.Preflight(ctx, ss.helpers(a)); err != nil {
					return err
				}
			}
		}
	}
	services, err := ss.services(ids...)
	if err != nil {
		return err
	}
	if c.services != nil {
		services = append(services, c.services()...)
	}
	if c.compose == composePullUp {
		if err := ss.pull(ctx, ids, services); err != nil {
			return err
		}
	}
	switch c.compose {
	case composeUp, composePullUp:
		startable, err := ss.startServices(ids...)
		if err != nil {
			return err
		}
		if c.services != nil {
			startable = append(startable, c.services()...)
		}
		ss.emitStage(ids, events.Event{Event: events.StepStart, Step: StageStart, Msg: "start " + strings.Join(ids, ", ")})
		if err := ss.up(ctx, startable); err != nil {
			return errors.Join(err, ss.recordStage(ids, events.Event{Event: events.StepFail, Step: StageStart, Msg: "could not start " + strings.Join(ids, ", "), Error: err.Error()}))
		}
		msg := "started "
		if c.compose == composePullUp && c.after == afterCheck {
			msg = "recreated "
		}
		if err := ss.recordStage(ids, events.Event{Event: events.StepOK, Step: StageStart, Msg: msg + strings.Join(ids, ", ")}); err != nil {
			return err
		}
		if c.compose == composePullUp && c.after == afterCheck {
			s.Log.Emit(events.Event{Event: events.StepOK, Step: "update", Msg: msg + strings.Join(ids, ", ")})
		}
	case composeStop:
		if err := ss.compose.Stop(ctx, services...); err != nil {
			return err
		}
		s.Log.Emit(events.Event{Event: events.StepOK, Step: "stop", Msg: "stopped " + strings.Join(ids, ", ")})
	case composeRestart:
		if err := ss.compose.Restart(ctx, services...); err != nil {
			return err
		}
		ss.clearStartFailure(ids, "restarted "+strings.Join(ids, ", "))
		s.Log.Emit(events.Event{Event: events.StepOK, Step: "restart", Msg: "restarted " + strings.Join(ids, ", ")})
	}
	return nil
}

// removeApps unlinks each App from the others, removes its containers and
// fragment, and keeps its data unless purge is set.
func (s *Service) removeApps(ctx context.Context, ss *session, ids []string, purge bool) error {
	var unlinkFailed []string
	for _, id := range ids {
		if err := ss.p.WriteRoot(); err != nil {
			return err
		}
		if purge && ss.leftover(id) {
			if err := ss.purgeLeftover(id); err != nil {
				return err
			}
			s.Log.Emit(events.Event{Event: events.StepOK, App: id, Step: "remove", Msg: "deleted the data kept for " + id})
			if err := ss.forgetDataSecrets(id); err != nil {
				return err
			}
			continue
		}
		unlinkFailed = append(unlinkFailed, ss.unlink(ctx, id)...)
		if err := ss.retireNode(ctx, id); err != nil {
			return err
		}
		services, err := ss.services(id)
		if err != nil {
			return err
		}
		if err := ss.compose.Remove(ctx, services...); err != nil {
			return err
		}
		dir := ss.p.AppDir(id)
		if purge {
			if err := ss.purgeAppDir(ctx, id, dir, services); err != nil {
				return err
			}
		}
		remaining, err := ss.p.AppIDs()
		if err != nil {
			return err
		}
		if len(remaining) == 1 {
			if err := ss.compose.Down(ctx); err != nil {
				return err
			}
		}
		if err := ss.p.RemoveFragment(id); err != nil {
			return err
		}
		delete(ss.state.Apps, id)
		ss.forgetStep(tailscaleID, "name-"+id)
		msg := "removed " + id + "; data kept in " + dir
		if purge {
			if err := ss.p.RemoveAppDir(dir); err != nil {
				return err
			}
			msg = "removed " + id + " and deleted its data"
		}
		s.Log.Emit(events.Event{Event: events.StepOK, App: id, Step: "remove", Msg: msg})
		if purge {
			if err := ss.forgetDataSecrets(id); err != nil {
				return err
			}
		}
	}
	if _, err := ss.renderTailscale(); err != nil {
		return err
	}
	if len(unlinkFailed) > 0 {
		return fmt.Errorf("%w: removed, but %s still point at it; fix them using the hints above, then run: self-host setup %s",
			ErrIncomplete, strings.Join(unlinkFailed, ", "), strings.Join(unlinkFailed, " "))
	}
	return nil
}

// forgetDataSecrets drops the secrets bound to the data a purge just deleted:
// whatever Setup minted inside the App (account IDs, API keys, tokens). Kept:
// secrets the App declares (repository passwords, keys), private inputs the
// person supplied, and secrets of Apps whose ID extends this one's.
func (ss *session) forgetDataSecrets(id string) error {
	keep := map[string]bool{}
	if a, found := ss.s.Catalog.App(id); found {
		if declarer, ok := a.(app.SecretDeclarer); ok {
			for _, spec := range declarer.Secrets() {
				keep[SecretKey(id, spec.Name)] = true
			}
		}
		for _, input := range a.Inputs() {
			if input.Private && !input.RecoveryOnly {
				keep[SecretKey(id, input.Key)] = true
			}
		}
	}
	prefix := SecretKey(id, "")
	var longer []string
	for _, other := range ss.s.Catalog.AllApps() {
		if otherID := other.Info().ID; strings.HasPrefix(otherID, id+"-") {
			longer = append(longer, SecretKey(otherID, ""))
		}
	}
	var forgotten []string
	for key := range ss.secrets.values {
		if !strings.HasPrefix(key, prefix) || keep[key] {
			continue
		}
		if slices.ContainsFunc(longer, func(p string) bool { return strings.HasPrefix(key, p) }) {
			continue
		}
		forgotten = append(forgotten, key)
	}
	if len(forgotten) == 0 {
		return nil
	}
	slices.Sort(forgotten)
	for _, key := range forgotten {
		delete(ss.secrets.values, key)
	}
	if err := ss.p.SaveSecrets(ss.secrets.values); err != nil {
		return err
	}
	ss.s.Log.Emit(events.Event{Event: events.Info, App: id, Step: "remove", Msg: "forgot secrets bound to the deleted data: " + strings.Join(forgotten, ", ")})
	return nil
}

// leftover reports whether id is a catalog App that is no longer installed
// but whose folder, kept by an earlier remove, is still there.
func (ss *session) leftover(id string) bool {
	if _, found := ss.s.Catalog.App(id); !found || ss.state.Apps[id] != nil || ss.p.IsExtra(id) || ss.p.HasAppFile(id, "compose.yml") {
		return false
	}
	info, err := os.Stat(ss.p.AppDir(id))
	return err == nil && info.IsDir()
}

func (ss *session) purgeLeftover(id string) error {
	if err := ss.p.RemoveAppDir(ss.p.AppDir(id)); err != nil {
		if errors.Is(err, fs.ErrPermission) {
			return fmt.Errorf("%w: %s's data is owned by root; rerun with: sudo \"$(command -v self-host)\" remove %s --purge", err, id, id)
		}
		return err
	}
	return nil
}

// purgeAppDir deletes an App's data folder. Data a container wrote as root is
// emptied through a one-off container of the App's own first service.
func (ss *session) purgeAppDir(ctx context.Context, id, dir string, services []string) error {
	err := ss.p.RemoveAppData(id)
	if !errors.Is(err, fs.ErrPermission) {
		return err
	}
	if len(services) == 0 {
		return fmt.Errorf("%w: %s's data is owned by root; rerun with: sudo \"$(command -v self-host)\" remove %s --purge", err, id, id)
	}
	var cerr error
	for _, service := range services {
		if ss.compose.Chown(ctx, service, dir, ss.p.Owner.UID, ss.p.Owner.GID) == nil && ss.p.RemoveAppData(id) == nil {
			return nil
		}
		if cerr = ss.compose.EmptyDir(ctx, service, dir); cerr == nil {
			return ss.p.RemoveAppData(id)
		}
	}
	return fmt.Errorf("%w: %s's data is owned by root and a container could not delete it (%v); rerun with: sudo \"$(command -v self-host)\" remove %s --purge", err, id, cerr, id)
}

// runAfter runs Setup (and Links) or only Check for the targets.
func (s *Service) runAfter(ctx context.Context, ss *session, step afterStep, ids []string) error {
	switch step {
	case afterSetup:
		var apps []app.App
		for _, id := range ids {
			if a, found := s.Catalog.App(id); found {
				apps = append(apps, a)
			}
		}
		if slices.Contains(ids, "homarr") {
			apps = append(apps, ss.homarrTargets(ids)...)
		}
		err := ss.setupAll(ctx, apps)
		if !slices.Contains(ids, "homarr") || slices.Contains(ids, tailscaleID) || slices.Contains(ids, cloudflareConnector) {
			err = errors.Join(err, ss.refreshDashboard(ctx))
		}
		return err
	case afterCheck:
		var apps []app.App
		targets := slices.Clone(ss.refreshed)
		for _, id := range ids {
			st := ss.state.Apps[id]
			if st != nil && (st.Setup == stepstatus.SetupManual || st.Setup == stepstatus.SetupPending) && !slices.Contains(targets, id) {
				targets = append(targets, id)
			}
		}
		for _, id := range targets {
			if a, found := s.Catalog.App(id); found {
				apps = append(apps, a)
			}
		}
		var setupManual error
		if len(apps) > 0 {
			if err := ss.setupAll(ctx, apps); errors.Is(err, ErrManual) {
				setupManual = err
			} else if err != nil {
				return err
			}
		}
		var failed, manual []string
		for _, id := range ids {
			err := ss.check(ctx, id)
			switch {
			case err == nil:
			case errors.Is(err, helpers.ErrManual):
				manual = append(manual, id)
			default:
				failed = append(failed, id)
			}
		}
		if len(failed) > 0 {
			return fmt.Errorf("%w: check failed after update for %s", ErrIncomplete, strings.Join(failed, ", "))
		}
		if len(manual) > 0 {
			return fmt.Errorf("%w: check needs manual steps after update for %s; follow their hints, then run: self-host setup %s", ErrManual, strings.Join(manual, ", "), strings.Join(manual, " "))
		}
		return setupManual
	case afterDashboard:
		return ss.refreshDashboard(ctx)
	case afterUnmanagedDashboard:
		for _, id := range ids {
			if _, managed := ss.s.Catalog.App(id); !managed || ss.state.Apps[id] == nil {
				return ss.refreshDashboard(ctx)
			}
		}
	}
	return nil
}

// homarrTargets are installed Apps Homarr links to that are not already part
// of the run: their Setup prepares the Homarr credentials once Homarr exists.
func (ss *session) homarrTargets(ids []string) []app.App {
	dashboard, found := ss.s.Catalog.App(dashboardAppID)
	if !found {
		return nil
	}
	var apps []app.App
	for _, link := range dashboard.Links() {
		if slices.Contains(ids, link.Target) || ss.state.Apps[link.Target] == nil {
			continue
		}
		if a, found := ss.s.Catalog.App(link.Target); found && !slices.ContainsFunc(apps, func(o app.App) bool { return o.Info().ID == link.Target }) {
			apps = append(apps, a)
		}
	}
	return apps
}

// refreshDashboard lets its adapter reconcile the final Project inventory and URLs.
func (ss *session) refreshDashboard(ctx context.Context) error {
	if ss.deferDashboard {
		return nil
	}
	ss.navigationAddresses, ss.navigationContainers = nil, nil
	return ss.reconcileDashboard(ctx)
}

func (ss *session) refreshRunningDashboard(ctx context.Context) error {
	a, found := ss.s.Catalog.App(dashboardAppID)
	if !found || !ss.ready(dashboardAppID) {
		return nil
	}
	ss.invalidateNavigation()
	containers, err := ss.compose.Ps(ctx)
	if err != nil {
		return err
	}
	byService := map[string]compose.Container{}
	for _, c := range containers {
		byService[c.Service] = c
	}
	if byService[a.Info().Service].State != "running" {
		return nil
	}
	ids, err := ss.p.AppIDs()
	if err != nil {
		return err
	}
	rec, _, err := loadCloudflareRecord(ss.p)
	if err != nil {
		return err
	}
	ss.observeNavigation(ctx, ids, byService, rec)
	return ss.reconcileDashboard(ctx)
}

func (ss *session) reconcileDashboard(ctx context.Context) error {
	a, found := ss.s.Catalog.App("homarr")
	if !found || !ss.ready("homarr") {
		return nil
	}
	if err := ctx.Err(); err != nil {
		return err
	}
	incomplete, err := ss.runSetup(ctx, a)
	if err != nil {
		return err
	}
	if len(incomplete) > 0 {
		return fmt.Errorf("%w: dashboard reconciliation failed; follow its hints, then run self-host setup homarr", ErrIncomplete)
	}
	return nil
}

// clearStartFailure overwrites a start failure left by an earlier run once the
// Apps are running again.
func (ss *session) clearStartFailure(ids []string, msg string) {
	for _, id := range ids {
		if st := ss.state.Apps[id]; st != nil && st.Steps[StageStart].Status == stepstatus.StepFail {
			ss.recorder(id)(helpers.StepResult{ID: StageStart, Status: stepstatus.StepOK, Msg: msg})
		}
	}
}

// recordStage saves completed stages before the next external operation.
func (ss *session) recordStage(ids []string, e events.Event) error {
	for _, id := range ids {
		status := stepstatus.StepOK
		if e.Event == events.StepFail {
			status = stepstatus.StepFail
		}
		ss.recorder(id)(helpers.StepResult{ID: e.Step, Status: status, Msg: e.Msg, Error: e.Error, Hint: e.Hint})
		st := ss.state.Apps[id]
		if st == nil {
			continue
		}
		var order []string
		for _, stage := range []string{StageRender, StagePull, StageStart} {
			if _, found := st.Steps[stage]; found {
				order = append(order, stage)
			}
		}
		for _, step := range st.StepOrder {
			if !IsStage(step) {
				order = append(order, step)
			}
		}
		st.StepOrder = order
	}
	err := ss.p.SaveState(ss.state)
	ss.emitStage(ids, e)
	if err != nil {
		ss.emitStage(ids, events.Event{Event: events.StepFail, Step: "state", Error: err.Error(),
			Hint: "Check free disk space and Project directory permissions, then retry the command."})
		return fmt.Errorf("could not save %s stage; check disk space and Project permissions before retrying: %w", e.Step, err)
	}
	return nil
}

// emitStage names every affected App while keeping the command's summary.
func (ss *session) emitStage(ids []string, e events.Event) {
	for _, id := range ids {
		perApp := e
		perApp.App = id
		ss.s.Log.Emit(perApp)
	}
	if e.App == "" {
		ss.s.Log.Emit(e)
	}
}

// pull pulls the services' images before Compose starts them, reporting
// progress and naming the image when a pull fails.
func (ss *session) pull(ctx context.Context, ids, services []string) error {
	ss.emitStage(ids, events.Event{Event: events.StepStart, Step: StagePull, Msg: pullMessage(len(services))})
	if err := ss.compose.PullProgress(ctx, services...); err != nil {
		if ctx.Err() != nil {
			return errors.Join(err, ss.recordStage(ids, events.Event{Event: events.StepFail, Step: StagePull, Msg: "pull cancelled", Error: "cancelled", Hint: "Run self-host to resume the install."}))
		}
		image := pullImageName(ss, ids, err)
		hint := fmt.Sprintf("Run `docker pull %s`, then check the network and the registry, and retry.", image)
		return errors.Join(err, ss.recordStage(ids, events.Event{Event: events.StepFail, Step: StagePull, Msg: "could not pull " + image, Error: err.Error(), Hint: hint}))
	}
	return ss.recordStage(ids, events.Event{Event: events.StepOK, Step: StagePull, Msg: "pulled " + strings.Join(ids, ", ")})
}

func pullMessage(n int) string {
	if n == 1 {
		return "pull 1 image"
	}
	return fmt.Sprintf("pull %d images", n)
}
