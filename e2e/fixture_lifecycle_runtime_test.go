//go:build e2e

package e2e

import (
	"path/filepath"
	"slices"
)

type fixture interface {
	overrideFile() string
	args() []string
	install([]string) (result, bool)
	check(string) result
	reattach(*runner) error
	close(bool)
}

type fixtureHooks struct {
	override   string
	inputs     []string
	installFn  func([]string) result
	checkFn    func(string) result
	reattachFn func(*runner) error
	closeFn    func(bool)
}

func (f *fixtureHooks) overrideFile() string { return f.override }
func (f *fixtureHooks) args() []string       { return f.inputs }
func (f *fixtureHooks) install(args []string) (result, bool) {
	if f.installFn == nil {
		return result{}, false
	}
	return f.installFn(args), true
}
func (f *fixtureHooks) check(phase string) result {
	if f.checkFn != nil {
		return f.checkFn(phase)
	}
	return result{}
}
func (f *fixtureHooks) reattach(target *runner) error { return f.reattachFn(target) }
func (f *fixtureHooks) close(before bool) {
	if f.closeFn != nil {
		f.closeFn(before)
	}
}

type fixtureEntry struct {
	fixture
	app   any
	order [5]int
}

const (
	fixtureArguments = iota
	fixtureCompose
	fixtureInstall
	fixtureRestore
	fixtureClose
)

// Each column preserves the existing argument, override, install, restore and
// deferred-close order. New App fixtures register their preparation here.
type fixtureRegistration struct {
	id      string
	prepare func(*runner, *portReservation)
	order   [5]int
}

func fixtureRegistry() []fixtureRegistration {
	return []fixtureRegistration{
		{"beszel", func(r *runner, p *portReservation) { r.prepareBeszelFixture(p.primary) }, [5]int{5, 5, 5, 5, 5}},
		{"renovate", func(r *runner, p *portReservation) { r.prepareRenovateFixture(p.primary) }, [5]int{0, 0, 2, 4, 4}},
		{"wud", func(r *runner, p *portReservation) { r.prepareWUDFixture(p.primary) }, [5]int{4, 2, 1, 0, 0}},
		{"netbird", (*runner).prepareNetBirdFixture, [5]int{1, 0, 3, 2, 1}},
		{"authelia", (*runner).prepareAutheliaFixture, [5]int{2, 0, 3, 3, 2}},
		{"passbolt", (*runner).preparePassboltFixture, [5]int{3, 1, 0, 1, 3}},
	}
}

func (r *runner) addFixture(id string, app any, f fixture) {
	for _, registration := range fixtureRegistry() {
		if registration.id == id {
			r.fixtures = append(r.fixtures, fixtureEntry{fixture: f, app: app, order: registration.order})
			return
		}
	}
	panic("unregistered App fixture")
}
func fixtureApp[T any](r *runner) T {
	for _, entry := range r.fixtures {
		if app, ok := entry.app.(T); ok {
			return app
		}
	}
	var zero T
	return zero
}
func (r *runner) orderedFixtures(operation int) []fixtureEntry {
	entries := slices.Clone(r.fixtures)
	slices.SortStableFunc(entries, func(a, b fixtureEntry) int { return a.order[operation] - b.order[operation] })
	return entries
}
func (r *runner) prepareFixtures(p *portReservation) {
	r.fixturePorts = p.primary
	for _, registration := range fixtureRegistry() {
		registration.prepare(r, p)
	}
}
func (r *runner) fixtureArgs(args []string) []string {
	for _, f := range r.orderedFixtures(fixtureArguments) {
		args = append(args, f.args()...)
	}
	return args
}
func (r *runner) installFixtures(args []string) result {
	for _, f := range r.orderedFixtures(fixtureInstall) {
		if res, handled := f.install(args); handled {
			return res
		}
	}
	return r.runWithTimeout(installCommandLimit(r.spec), args...)
}
func (r *runner) checkFixtures(phase string) result {
	for _, f := range r.orderedFixtures(fixtureInstall) {
		if res := f.check(phase); res.code != 0 {
			return res
		}
	}
	return result{}
}
func (r *runner) reattachFixtures(target *runner) error {
	target.fixturePorts = r.fixturePorts
	for _, f := range r.orderedFixtures(fixtureRestore) {
		if err := f.reattach(target); err != nil {
			return err
		}
	}
	return nil
}
func (r *runner) closeFixtures(before bool) {
	for _, f := range r.orderedFixtures(fixtureClose) {
		f.close(before)
	}
}
func (r *runner) fixtureOverrides(prefix []string) []string {
	first := true
	for _, f := range r.orderedFixtures(fixtureCompose) {
		if file := f.overrideFile(); file != "" {
			if first {
				prefix = append(prefix, "-f", filepath.Join(r.project, "compose.yml"))
				first = false
			}
			prefix = append(prefix, "-f", file)
		}
	}
	return prefix
}
