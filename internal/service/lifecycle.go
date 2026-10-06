package service

import (
	"context"
	"fmt"
	"io"
	"os"
	"slices"
	"strings"
	"time"

	"github.com/ajnart/self-host/internal/events"
	"github.com/ajnart/self-host/internal/helpers"
	"github.com/ajnart/self-host/internal/project"
	"github.com/ajnart/self-host/internal/system"
)

// mutate opens the Project under the lock, refreshes the root Compose file
// so agent-added folders are included, and runs fn.
func (s *Service) mutate(ctx context.Context, title string, fn func(*session) error) error {
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
		return err
	}
	s.Log.Emit(events.Event{Event: events.RunStart, Msg: title})
	return s.finish(fn(ss))
}

// targets validates App IDs against the Project; empty means every App.
func (ss *session) targets(ids []string) ([]string, error) {
	all, err := ss.p.AppIDs()
	if err != nil {
		return nil, err
	}
	if len(ids) == 0 {
		if len(all) == 0 {
			return nil, fmt.Errorf("the Project has no Apps yet")
		}
		return all, nil
	}
	for _, id := range ids {
		if !slices.Contains(all, id) {
			return nil, fmt.Errorf("%s is not in the Project (see: self-host status)", id)
		}
	}
	return ids, nil
}

func (s *Service) composeAction(ctx context.Context, verb string, ids []string, action func(*session, []string) error) error {
	title := strings.TrimSpace(verb + " " + strings.Join(ids, " "))
	return s.mutate(ctx, title, func(ss *session) error {
		targets, err := ss.targets(ids)
		if err != nil {
			return err
		}
		services, err := ss.services(targets...)
		if err != nil {
			return err
		}
		if err := action(ss, services); err != nil {
			return err
		}
		s.Log.Emit(events.Event{Event: events.StepOK, Step: verb, Msg: verb + " " + strings.Join(targets, ", ")})
		return nil
	})
}

func (s *Service) Start(ctx context.Context, ids []string) error {
	return s.composeAction(ctx, "start", ids, func(ss *session, services []string) error { return ss.compose.Up(ctx, services...) })
}

func (s *Service) Stop(ctx context.Context, ids []string) error {
	return s.composeAction(ctx, "stop", ids, func(ss *session, services []string) error { return ss.compose.Stop(ctx, services...) })
}

func (s *Service) Restart(ctx context.Context, ids []string) error {
	return s.composeAction(ctx, "restart", ids, func(ss *session, services []string) error { return ss.compose.Restart(ctx, services...) })
}

// Update pulls newer images, recreates the Apps and reruns each catalog
// App's Check.
func (s *Service) Update(ctx context.Context, ids []string) error {
	title := strings.TrimSpace("update " + strings.Join(ids, " "))
	return s.mutate(ctx, title, func(ss *session) error {
		targets, err := ss.targets(ids)
		if err != nil {
			return err
		}
		services, err := ss.services(targets...)
		if err != nil {
			return err
		}
		if err := ss.compose.Pull(ctx, services...); err != nil {
			return err
		}
		if err := ss.compose.Up(ctx, services...); err != nil {
			return err
		}
		s.Log.Emit(events.Event{Event: events.StepOK, Step: "update", Msg: "recreated " + strings.Join(targets, ", ")})
		var failed []string
		for _, id := range targets {
			if err := ss.check(ctx, id); err != nil {
				failed = append(failed, id)
			}
		}
		if len(failed) > 0 {
			return fmt.Errorf("%w: check failed after update for %s", ErrIncomplete, strings.Join(failed, ", "))
		}
		return nil
	})
}

// check reruns a catalog App's Check, waiting for it to come back up.
func (ss *session) check(ctx context.Context, id string) error {
	a, found := ss.s.Catalog.App(id)
	if !found || ss.state.Apps[id] == nil {
		return nil
	}
	h := ss.helpers(a)
	return h.Step(ctx, "check", "verify "+a.Info().Name+" works", helpers.StepSpec{
		Do: func(ctx context.Context) error {
			return h.Poll(ctx, 2*time.Minute, func(ctx context.Context) (bool, error) {
				err := a.Check(ctx, h)
				return err == nil, err
			})
		},
		Hint: "Open " + h.URL + " and check the App's logs (self-host logs " + id + ").",
	})
}

// Remove deletes the Apps' containers and Compose fragments. Data stays in
// apps/<id>/ unless purge is set.
func (s *Service) Remove(ctx context.Context, ids []string, purge bool) error {
	if len(ids) == 0 {
		return fmt.Errorf("name the Apps to remove")
	}
	return s.mutate(ctx, "remove "+strings.Join(ids, " "), func(ss *session) error {
		targets, err := ss.targets(ids)
		if err != nil {
			return err
		}
		var unlinkFailed []string
		for _, id := range targets {
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
		if err := ss.p.SaveState(ss.state); err != nil {
			return err
		}
		if err := ss.p.WriteRoot(); err != nil {
			return err
		}
		if len(unlinkFailed) > 0 {
			return fmt.Errorf("%w: removed, but %s still point at it; fix them using the hints above, then run: self-host setup %s",
				ErrIncomplete, strings.Join(unlinkFailed, ", "), strings.Join(unlinkFailed, " "))
		}
		return nil
	})
}

// unlink runs Remove for Links that point at id from other installed Apps.
// A Link that cannot be undone stays recorded as a failed step on the App
// that declares it, and makes the removal incomplete.
func (ss *session) unlink(ctx context.Context, id string) []string {
	target, found := ss.s.Catalog.App(id)
	if !found || ss.state.Apps[id] == nil {
		return nil
	}
	var failed []string
	for _, other := range ss.s.Catalog.Apps() {
		otherID := other.Info().ID
		if otherID == id || ss.state.Apps[otherID] == nil {
			continue
		}
		for _, link := range other.Links() {
			if link.Target != id || link.Remove == nil {
				continue
			}
			h := ss.helpers(other)
			err := link.Remove(ctx, h, ss.helpers(target))
			ss.reportUnexpected(h, "un"+link.ID, err)
			if err != nil {
				ss.state.Apps[otherID].Setup = "incomplete"
				failed = append(failed, otherID)
				continue
			}
			ss.forgetStep(otherID, link.ID)
			ss.forgetStep(otherID, "un"+link.ID)
		}
	}
	return failed
}

// forgetStep drops a step record that no longer describes the App, such as
// a Link whose target was removed.
func (ss *session) forgetStep(id, step string) {
	st := ss.state.Apps[id]
	delete(st.Steps, step)
	st.StepOrder = slices.DeleteFunc(st.StepOrder, func(s string) bool { return s == step })
}

// ConfigSet changes Host settings and recreates the Apps that use them.
func (s *Service) ConfigSet(ctx context.Context, pairs []string) error {
	changes := map[string]string{}
	for _, pair := range pairs {
		key, value, found := strings.Cut(pair, "=")
		key = strings.ToUpper(strings.TrimSpace(key))
		if !found || !slices.Contains(project.SettingKeys, key) || key == "BIND_IP" {
			return fmt.Errorf("%q: settable keys are TZ, PUID, PGID, UMASK, LAN_IP, EXPOSURE, MEDIA_ROOT, DOWNLOADS_ROOT", pair)
		}
		if err := project.ValidEnvValue(value); err != nil {
			return fmt.Errorf("%s: %w", key, err)
		}
		if key == "EXPOSURE" {
			if value != ExposureLAN && value != ExposureLocal {
				return fmt.Errorf("EXPOSURE must be %s or %s", ExposureLAN, ExposureLocal)
			}
			changes["BIND_IP"] = BindIP(value)
		}
		changes[key] = value
	}
	if len(changes) == 0 {
		return fmt.Errorf("nothing to set; pass KEY=value")
	}
	return s.mutate(ctx, "config set "+strings.Join(pairs, " "), func(ss *session) error {
		for key, value := range changes {
			ss.settings[key] = value
		}
		if err := ss.p.SaveSettings(ss.settings); err != nil {
			return err
		}
		ids, err := ss.p.AppIDs()
		if err != nil {
			return err
		}
		var affected []string
		for _, id := range ids {
			data, err := os.ReadFile(ss.p.FragmentPath(id))
			if err != nil {
				return err
			}
			for key := range changes {
				if strings.Contains(string(data), "${"+key+"}") {
					affected = append(affected, id)
					break
				}
			}
		}
		s.Log.Emit(events.Event{Event: events.StepOK, Step: "config", Msg: "saved " + ss.p.Path(".env")})
		if len(affected) == 0 {
			return nil
		}
		services, err := ss.services(affected...)
		if err != nil {
			return err
		}
		if err := ss.compose.Up(ctx, services...); err != nil {
			return err
		}
		s.Log.Emit(events.Event{Event: events.StepOK, Step: "recreate", Msg: "recreated " + strings.Join(affected, ", ")})
		return nil
	})
}

// Logs streams the containers' logs of one App to w. It does not take the lock.
func (s *Service) Logs(ctx context.Context, id string, w io.Writer, follow bool, tail int) error {
	ss, err := s.open(ctx)
	if err != nil {
		return err
	}
	targets, err := ss.targets([]string{id})
	if err != nil {
		return err
	}
	services, err := ss.services(targets...)
	if err != nil {
		return err
	}
	return ss.compose.Logs(ctx, w, follow, tail, services...)
}

// OpenURL opens url in the desktop browser.
func (s *Service) OpenURL(ctx context.Context, url string) error {
	name := "xdg-open"
	if s.Deps.GOOS == "darwin" {
		name = "open"
	}
	result, err := s.Deps.Runner.Run(ctx, system.Cmd{Name: name, Args: []string{url}})
	if err != nil {
		return err
	}
	if result.ExitCode != 0 {
		return fmt.Errorf("%s exited %d", name, result.ExitCode)
	}
	return nil
}

// Compose returns the Compose file of one installed App.
func (s *Service) Compose(ctx context.Context, id string) (string, error) {
	ss, err := s.open(ctx)
	if err != nil {
		return "", err
	}
	if _, err := ss.targets([]string{id}); err != nil {
		return "", err
	}
	data, err := os.ReadFile(ss.p.FragmentPath(id))
	return string(data), err
}
