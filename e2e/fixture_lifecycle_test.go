//go:build e2e

package e2e

import (
	"reflect"
	"testing"
)

type fakeLifecycleFixture struct{ calls *[]string }

func (f *fakeLifecycleFixture) overrideFile() string { return "/owned/override.yml" }
func (f *fakeLifecycleFixture) args() []string       { return []string{"--set", "fake.input=owned"} }
func (f *fakeLifecycleFixture) install(args []string) (result, bool) {
	*f.calls = append(*f.calls, "install")
	if !reflect.DeepEqual(args, []string{"install", "--set", "fake.input=owned"}) {
		return result{code: 1}, true
	}
	return result{}, true
}
func (f *fakeLifecycleFixture) check(phase string) result {
	*f.calls = append(*f.calls, "check:"+phase)
	return result{}
}
func (f *fakeLifecycleFixture) reattach(target *runner) error {
	*f.calls = append(*f.calls, "reattach")
	target.fixtures = append(target.fixtures, fixtureEntry{fixture: f})
	return nil
}
func (f *fakeLifecycleFixture) close(before bool) {
	if before {
		*f.calls = append(*f.calls, "close")
	}
}

func TestFixtureLifecycle(t *testing.T) {
	var calls []string
	r := &runner{project: "/owned/project", fixtures: []fixtureEntry{{fixture: &fakeLifecycleFixture{calls: &calls}}}}
	args := r.fixtureArgs([]string{"install"})
	if res := r.installFixtures(args); res.code != 0 {
		t.Fatal("fixture install did not receive its input args")
	}
	r.checkFixtures("source")
	restored := &runner{}
	if err := r.reattachFixtures(restored); err != nil {
		t.Fatal(err)
	}
	restored.checkFixtures("restored")
	r.closeFixtures(true)
	restored.closeFixtures(true)
	want := []string{"install", "check:source", "reattach", "check:restored", "close", "close"}
	if !reflect.DeepEqual(calls, want) {
		t.Fatalf("fixture lifecycle = %v, want %v", calls, want)
	}
	compose := r.dockerArgs("compose", "-p", "selfhost-e2e-fake", "down", "--volumes", "--remove-orphans")
	wantCompose := []string{"compose", "--project-directory", "/owned/project", "--env-file", "/owned/project/.env", "--env-file", "/owned/project/secrets.env", "-f", "/owned/project/compose.yml", "-f", "/owned/override.yml", "-p", "selfhost-e2e-fake", "down", "--volumes", "--remove-orphans"}
	if !reflect.DeepEqual(compose, wantCompose) {
		t.Fatalf("Compose args = %v, want %v", compose, wantCompose)
	}
}

func TestFixtureRegistrationOrder(t *testing.T) {
	r := &runner{project: "/owned/project"}
	var calls []string
	for _, registration := range fixtureRegistry() {
		id := registration.id
		hooks := &fixtureHooks{
			inputs:     []string{id},
			reattachFn: func(*runner) error { calls = append(calls, id); return nil },
			closeFn: func(before bool) {
				if before && id == "wud" {
					calls = append(calls, id)
				}
				if !before && (id == "netbird" || id == "authelia" || id == "passbolt") {
					calls = append(calls, id)
				}
			},
		}
		if id == "netbird" || id == "passbolt" || id == "wud" {
			hooks.override = "/owned/" + id + ".yml"
		}
		if id == "passbolt" || id == "wud" || id == "renovate" {
			hooks.installFn = func([]string) result { calls = append(calls, id); return result{} }
		}
		r.addFixture(id, nil, hooks)
	}
	if got := r.fixtureArgs(nil); !reflect.DeepEqual(got, []string{"renovate", "netbird", "authelia", "passbolt", "wud", "beszel"}) {
		t.Fatalf("input order = %v", got)
	}
	wantOverrides := []string{"-f", "/owned/project/compose.yml", "-f", "/owned/netbird.yml", "-f", "/owned/passbolt.yml", "-f", "/owned/wud.yml"}
	if got := r.fixtureOverrides(nil); !reflect.DeepEqual(got, wantOverrides) {
		t.Fatalf("override order = %v", got)
	}
	r.installFixtures(nil)
	if !reflect.DeepEqual(calls, []string{"passbolt"}) {
		t.Fatalf("install precedence = %v", calls)
	}
	calls = nil
	if err := r.reattachFixtures(&runner{}); err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(calls, []string{"wud", "passbolt", "netbird", "authelia", "renovate", "beszel"}) {
		t.Fatalf("restore attachment order = %v", calls)
	}
	calls = nil
	r.closeFixtures(true)
	r.closeFixtures(false)
	if !reflect.DeepEqual(calls, []string{"wud", "netbird", "authelia", "passbolt"}) {
		t.Fatalf("cleanup order = %v", calls)
	}
}
