package service

import (
	"context"
	"errors"
	"fmt"
	"io"
	"maps"
	"slices"
	"strings"
	"time"

	"github.com/ajnart/self-host/internal/compose"
	"github.com/ajnart/self-host/internal/events"
	"github.com/ajnart/self-host/internal/helpers"
	"github.com/ajnart/self-host/internal/project"
	stepstatus "github.com/ajnart/self-host/internal/status"
	"github.com/ajnart/self-host/internal/system"
)

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

func (s *Service) Start(ctx context.Context, ids []string) error {
	return s.run(ctx, change{
		namesStart: func(ss *session) bool { return ss.namesOn() },
		title:      strings.TrimSpace("start " + strings.Join(ids, " ")),
		targets:    func(ss *session) ([]string, error) { return ss.targets(ids) },
		compose:    composeUp,
		after:      afterUnmanagedDashboard,
	})
}

func (s *Service) Stop(ctx context.Context, ids []string) error {
	return s.run(ctx, change{
		title:   strings.TrimSpace("stop " + strings.Join(ids, " ")),
		targets: func(ss *session) ([]string, error) { return ss.targets(ids) },
		compose: composeStop,
	})
}

// Down takes down only the selected Project; App files, state and volumes stay.
func (s *Service) Down(ctx context.Context) error {
	return s.run(ctx, change{
		title: "down Project",
		targets: func(ss *session) ([]string, error) {
			return ss.p.AppIDs()
		},
		compose: composeDown,
	})
}

func (s *Service) Restart(ctx context.Context, ids []string) error {
	return s.run(ctx, change{
		title:   strings.TrimSpace("restart " + strings.Join(ids, " ")),
		targets: func(ss *session) ([]string, error) { return ss.targets(ids) },
		compose: composeRestart,
	})
}

// Update pulls newer images, recreates the Apps and reruns each catalog
// App's Check.
func (s *Service) Update(ctx context.Context, ids []string) error {
	return s.run(ctx, change{
		title:   strings.TrimSpace("update " + strings.Join(ids, " ")),
		targets: func(ss *session) ([]string, error) { return ss.targets(ids) },
		compose: composePullUp,
		after:   afterCheck,
	})
}

func pullImageName(ss *session, ids []string, err error) string {
	var perr *compose.PullError
	if errors.As(err, &perr) && perr.Image != "" {
		return perr.Image
	}
	for _, id := range ids {
		if a, found := ss.s.Catalog.App(id); found {
			return a.Info().Image
		}
	}
	return "the image"
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
	return s.run(ctx, change{
		title: "remove " + strings.Join(ids, " "),
		edit: func(_ context.Context, ss *session) error {
			if slices.Contains(ids, cloudflareConnector) {
				_, published, err := loadCloudflareRecord(ss.p)
				if err != nil {
					return err
				}
				if published {
					return errors.New("published Cloudflare routes still need cleanup; use self-host cloudflare remove with a fresh private API token, not ordinary App removal")
				}
			}
			return nil
		},
		targets: func(ss *session) ([]string, error) { return ss.targets(ids) },
		compose: composeRemove,
		after:   afterDashboard,
		purge:   purge,
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
				ss.state.Apps[otherID].Setup = stepstatus.SetupIncomplete
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
	if st == nil {
		return
	}
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
			return fmt.Errorf("%q: settable keys are TZ, PUID, PGID, UMASK, LAN_IP, EXPOSURE, EASY_NAMES, MEDIA_ROOT, DOWNLOADS_ROOT", pair)
		}
		value, err := s.resolveAuto(key, strings.TrimSpace(value))
		if err != nil {
			return err
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
		if key == settingNames && value != "on" && value != "off" {
			return fmt.Errorf("EASY_NAMES must be on or off")
		}
		changes[key] = value
	}
	if len(changes) == 0 {
		return fmt.Errorf("nothing to set; pass KEY=value")
	}
	if changes["EXPOSURE"] == ExposureLocal {
		if changes[settingNames] == namesOn {
			return fmt.Errorf("Easy names need Home network")
		}
		changes[settingNames] = "off"
	}
	after := afterNone
	if _, changed := changes[settingNames]; changed {
		after = afterDashboard
	}
	if _, changed := changes["LAN_IP"]; changed {
		after = afterDashboard
	}
	if _, changed := changes["EXPOSURE"]; changed {
		after = afterDashboard
	}
	var rendered []string
	fragments := map[string]string{}
	return s.run(ctx, change{
		title:       "config set " + strings.Join(pairs, " "),
		namesStart:  func(ss *session) bool { return changes[settingNames] == namesOn && !ss.namesOn() },
		namesCancel: changes[settingNames] == "off",
		preflight: func(ctx context.Context, p *project.Project) error {
			previous, err := p.LoadSettings()
			if err != nil {
				return err
			}
			next := maps.Clone(previous)
			maps.Copy(next, changes)
			state, err := p.LoadState()
			if err != nil {
				return err
			}
			if err := s.validateNames(ctx, next, state); err != nil {
				return err
			}
			for _, a := range s.Catalog.Apps() {
				id := a.Info().ID
				st := state.Apps[id]
				if st == nil || p.IsExtra(id) {
					continue
				}
				rc, err := s.renderContext(ctx, a, st.Port, st.Inputs, previous)
				if err != nil {
					return err
				}
				old := a.Compose(rc)
				rc.Settings = next
				fragment := a.Compose(rc)
				if old == fragment {
					continue
				}
				data, err := p.ReadFragment(id)
				if err != nil {
					return err
				}
				header := "# Generated by self-host for " + id + ". Reinstalling the App rewrites this file.\n"
				if string(data) != header+old {
					return fmt.Errorf("%s has a customized Compose fragment; update its Access origin manually or explicitly approve a reinstall first. Nothing was changed", id)
				}
				fragments[id] = fragment
			}
			return nil
		},
		edit: func(_ context.Context, ss *session) error {
			for key, value := range changes {
				if old := ss.settings[key]; old != value {
					s.Log.Emit(events.Event{Event: events.Info, Step: "config", Msg: key + ": " + old + " → " + value})
				}
				ss.settings[key] = value
			}
			for id, fragment := range fragments {
				if err := ss.p.WriteFragment(id, fragment); err != nil {
					return err
				}
				rendered = append(rendered, id)
			}
			slices.Sort(rendered)
			if err := ss.p.SaveSettings(ss.settings); err != nil {
				return err
			}
			s.Log.Emit(events.Event{Event: events.StepOK, Step: "config", Msg: "saved " + ss.p.Path(".env")})
			return nil
		},
		targets: func(ss *session) ([]string, error) {
			ids, err := ss.p.AppIDs()
			if err != nil {
				return nil, err
			}
			affected := slices.Clone(rendered)
			for _, id := range ids {
				data, err := ss.p.ReadFragment(id)
				if err != nil {
					return nil, err
				}
				for key := range changes {
					if strings.Contains(string(data), "${"+key+"}") {
						if !slices.Contains(affected, id) {
							affected = append(affected, id)
						}
						break
					}
				}
			}
			return affected, nil
		},
		compose: composeUp,
		after:   after,
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
	data, err := ss.p.ReadFragment(id)
	return string(data), err
}
