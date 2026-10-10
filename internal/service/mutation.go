package service

import (
	"context"
	"errors"
	"fmt"
	"os"
	"slices"
	"strings"

	"github.com/ajnart/self-host/internal/app"
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
	purge bool
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
	if !p.Exists() && c.initialize == nil {
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
	if !p.Exists() {
		if c.initialize == nil {
			return ErrNoProject
		}
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
	if err := ss.migratePrivateInputs(); err != nil {
		return s.finish(err)
	}
	if err := ss.p.WriteRoot(); err != nil {
		return s.finish(err)
	}
	s.Log.Emit(events.Event{Event: events.RunStart, Msg: c.title})
	if c.edit != nil {
		if err := c.edit(ctx, ss); err != nil {
			return s.finish(err)
		}
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
	if c.after != afterNone && err == nil {
		err = s.runAfter(ctx, ss, c.after, ids)
	}
	if serr := ss.p.SaveState(ss.state); serr != nil && err == nil {
		err = serr
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
		s.Log.Emit(events.Event{Event: events.StepOK, Step: "restart", Msg: "restarted " + strings.Join(ids, ", ")})
	}
	return nil
}

// removeApps unlinks each App from the others, removes its containers and
// fragment, and keeps its data unless purge is set.
func (s *Service) removeApps(ctx context.Context, ss *session, ids []string, purge bool) error {
	var unlinkFailed []string
	for _, id := range ids {
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
		if err := os.Remove(ss.p.FragmentPath(id)); err != nil {
			return err
		}
		delete(ss.state.Apps, id)
		ss.forgetStep(tailscaleID, "name-"+id)
		msg := "removed " + id + "; data kept in " + dir
		if purge {
			if err := os.RemoveAll(dir); err != nil {
				return err
			}
			msg = "removed " + id + " and deleted its data"
		}
		s.Log.Emit(events.Event{Event: events.StepOK, App: id, Step: "remove", Msg: msg})
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
		err := ss.setupAll(ctx, apps)
		if !slices.Contains(ids, "homarr") {
			err = errors.Join(err, ss.refreshDashboard(ctx))
		}
		return err
	case afterCheck:
		var failed []string
		for _, id := range ids {
			if err := ss.check(ctx, id); err != nil {
				failed = append(failed, id)
			}
		}
		if len(failed) > 0 {
			return fmt.Errorf("%w: check failed after update for %s", ErrIncomplete, strings.Join(failed, ", "))
		}
		return nil
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

// refreshDashboard lets its adapter reconcile the final Project inventory and URLs.
func (ss *session) refreshDashboard(ctx context.Context) error {
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
	ss.emitStage(ids, events.Event{Event: events.StepStart, Step: StagePull, Msg: fmt.Sprintf("pull %d images", len(services))})
	if err := ss.compose.PullProgress(ctx, services...); err != nil {
		image := pullImageName(ss, ids, err)
		hint := fmt.Sprintf("Run `docker pull %s`, then check the network and the registry, and retry.", image)
		return errors.Join(err, ss.recordStage(ids, events.Event{Event: events.StepFail, Step: StagePull, Msg: "could not pull " + image, Error: err.Error(), Hint: hint}))
	}
	return ss.recordStage(ids, events.Event{Event: events.StepOK, Step: StagePull, Msg: "pulled " + strings.Join(ids, ", ")})
}
