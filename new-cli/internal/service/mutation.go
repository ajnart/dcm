package service

import (
	"context"
	"fmt"
	"os"
	"strings"

	"github.com/ajnart/self-host/internal/app"
	"github.com/ajnart/self-host/internal/events"
	"github.com/ajnart/self-host/internal/helpers"
)

// composeStep is the Compose work a change runs after edit.
type composeStep int

const (
	composeNone composeStep = iota
	// composePullUp pulls the targets' images before recreating them.
	composePullUp
	composeUp
	composeStop
	composeRestart
	composeRemove
)

// afterStep runs once Compose succeeded.
type afterStep int

const (
	afterNone afterStep = iota
	afterSetup
	afterCheck
)

// change is one mutation of the Project, declared by a verb.
type change struct {
	title string
	// edit changes the session before Compose runs: render Apps, settings, fragments, unlink.
	edit func(ctx context.Context, ss *session) error
	// targets returns the App ids Compose acts on, after edit.
	targets func(ss *session) ([]string, error)
	compose composeStep // none, pullUp, up, stop, restart, remove
	// after runs once Compose succeeded: Setup (with Links), or only Check.
	after afterStep // none, setup, check
	// purge deletes the App's data folder when compose is remove.
	purge bool
}

// run owns every Project mutation: it takes the lock, opens the session,
// refreshes the root Compose file, runs the declared edit, saves state,
// resolves the targets' services, runs Compose, then the after step.
func (s *Service) run(ctx context.Context, c change) error {
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
	if c.compose == composeRemove {
		return s.removeApps(ctx, ss, ids, c.purge)
	}
	if len(ids) == 0 {
		return nil
	}
	services, err := ss.services(ids...)
	if err != nil {
		return err
	}
	if c.compose == composePullUp {
		if err := ss.pull(ctx, ids, services); err != nil {
			return err
		}
	}
	switch c.compose {
	case composeUp:
		if err := ss.compose.Up(ctx, services...); err != nil {
			ss.recordStage(ids, events.Event{Event: events.StepFail, Step: "start", Msg: "could not start " + strings.Join(ids, ", "), Error: err.Error()})
			return err
		}
		ss.recordStage(ids, events.Event{Event: events.StepOK, Step: "start", Msg: "started " + strings.Join(ids, ", ")})
	case composePullUp:
		if err := ss.compose.Up(ctx, services...); err != nil {
			if c.after == afterSetup {
				ss.recordStage(ids, events.Event{Event: events.StepFail, Step: "start", Msg: "could not start " + strings.Join(ids, ", "), Error: err.Error()})
			}
			return err
		}
		step, msg := "update", "recreated "
		if c.after == afterSetup {
			step, msg = "start", "started "
		}
		if step == "start" {
			ss.recordStage(ids, events.Event{Event: events.StepOK, Step: step, Msg: msg + strings.Join(ids, ", ")})
		} else {
			s.Log.Emit(events.Event{Event: events.StepOK, Step: step, Msg: msg + strings.Join(ids, ", ")})
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
		services, err := ss.services(id)
		if err != nil {
			return err
		}
		if err := ss.compose.Remove(ctx, services...); err != nil {
			return err
		}
		if err := os.Remove(ss.p.FragmentPath(id)); err != nil {
			return err
		}
		delete(ss.state.Apps, id)
		msg := "removed " + id + "; data kept in " + ss.p.Path("apps", id)
		if purge {
			if err := os.RemoveAll(ss.p.Path("apps", id)); err != nil {
				return err
			}
			msg = "removed " + id + " and deleted its data"
		}
		s.Log.Emit(events.Event{Event: events.StepOK, App: id, Step: "remove", Msg: msg})
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
		return ss.setupAll(ctx, apps)
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
	}
	return nil
}

// recordStage keeps mutation stages ahead of the App's existing Setup records.
func (ss *session) recordStage(ids []string, e events.Event) {
	for _, id := range ids {
		status := "ok"
		if e.Event == events.StepFail {
			status = "fail"
		}
		ss.recorder(id)(helpers.StepResult{ID: e.Step, Status: status, Msg: e.Msg, Error: e.Error, Hint: e.Hint})
		st := ss.state.Apps[id]
		if st == nil {
			continue
		}
		var order []string
		for _, stage := range []string{"render", "pull", "start"} {
			if _, found := st.Steps[stage]; found {
				order = append(order, stage)
			}
		}
		for _, step := range st.StepOrder {
			if step != "render" && step != "pull" && step != "start" {
				order = append(order, step)
			}
		}
		st.StepOrder = order
	}
	ss.s.Log.Emit(e)
}

// pull pulls the services' images before Compose starts them, reporting
// progress and naming the image when a pull fails.
func (ss *session) pull(ctx context.Context, ids, services []string) error {
	ss.s.Log.Emit(events.Event{Event: events.StepStart, Step: "pull", Msg: fmt.Sprintf("pull %d images", len(services))})
	if err := ss.compose.PullProgress(ctx, services...); err != nil {
		image := pullImageName(ss, ids, err)
		hint := fmt.Sprintf("Run `docker pull %s`, then check the network and the registry, and retry.", image)
		ss.recordStage(ids, events.Event{Event: events.StepFail, Step: "pull", Msg: "could not pull " + image, Error: err.Error(), Hint: hint})
		return err
	}
	ss.recordStage(ids, events.Event{Event: events.StepOK, Step: "pull", Msg: "pulled " + strings.Join(ids, ", ")})
	return nil
}
