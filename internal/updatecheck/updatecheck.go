// Package updatecheck remembers, in a small non-secret cache file, when the
// release lookup last ran, what it found and which release a person skipped,
// so the dashboard prompt and the one-line notice after a command never nag.
package updatecheck

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"time"

	"github.com/ajnart/self-host/internal/release"
	"github.com/ajnart/self-host/internal/system"
)

// EnvOptOut turns the check, the prompt and the notice off when it is 1.
const EnvOptOut = "SELF_HOST_NO_UPDATE_CHECK"

const (
	// Interval is how often a plain command may look for or announce a release.
	Interval = 24 * time.Hour

	lookupBudget = 2 * time.Second
	// waitBudget is all the time a finished command waits for the lookup.
	waitBudget = 300 * time.Millisecond
)

// State is what the cache file holds. Versions have no tag prefix.
type State struct {
	CheckedAt time.Time `json:"checked_at,omitempty"`
	Latest    string    `json:"latest,omitempty"`
	NoticedAt time.Time `json:"noticed_at,omitempty"`
	Skipped   string    `json:"skipped,omitempty"`
}

// Cache is the file under the user cache directory.
type Cache struct{ path string }

// Open finds the cache file's place; false when the host has no cache directory.
func Open(deps *system.Deps) (Cache, bool) {
	if deps.CacheDir == nil {
		return Cache{}, false
	}
	dir, err := deps.CacheDir()
	if err != nil || dir == "" {
		return Cache{}, false
	}
	return Cache{path: filepath.Join(dir, "self-host", "update.json")}, true
}

// Load returns the saved state, empty when the file is missing or unreadable.
func (c Cache) Load() State {
	var s State
	data, err := os.ReadFile(c.path)
	if err != nil || json.Unmarshal(data, &s) != nil {
		return State{}
	}
	return s
}

// Save replaces the file atomically.
func (c Cache) Save(s State) error {
	data, err := json.Marshal(s)
	if err != nil {
		return err
	}
	dir := filepath.Dir(c.path)
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return err
	}
	tmp, err := os.CreateTemp(dir, ".update-*")
	if err != nil {
		return err
	}
	defer os.Remove(tmp.Name())
	if _, err := tmp.Write(data); err != nil {
		tmp.Close()
		return err
	}
	if err := tmp.Close(); err != nil {
		return err
	}
	if err := os.Chmod(tmp.Name(), 0o600); err != nil {
		return err
	}
	return os.Rename(tmp.Name(), c.path)
}

// Disabled is true where no one should be asked or told about an update: a
// development build, continuous integration, or an explicit opt-out.
func Disabled(deps *system.Deps) bool {
	return !release.IsRelease(deps.Version) || deps.Getenv("CI") != "" || deps.Getenv(EnvOptOut) == "1"
}

// Notice is the line a plain command prints for a newer release.
func Notice(version string) string {
	return "self-host " + version + " is available: run self-host self-update"
}

// Lookup returns the newest release's version.
type Lookup func(ctx context.Context) (string, error)

// StartNotice looks for a newer release alongside a command and returns the
// function to call when the command is done. That function returns the line
// to print, or "" when there is nothing to say: the lookup is cached for 24 h,
// the line is announced at most once per 24 h, and a lookup that is not done
// within a moment is dropped, so the command is never held up.
func StartNotice(deps *system.Deps, lookup Lookup) func() string {
	none := func() string { return "" }
	cache, ok := Open(deps)
	if !ok {
		return none
	}
	return startNotice(deps.Version, deps.Now(), lookup, cache)
}

type noticeCache interface {
	Load() State
	Save(State) error
}

func startNotice(currentVersion string, now time.Time, lookup Lookup, cache noticeCache) func() string {
	newer := func(version string) string {
		if isNewer, err := release.Newer(currentVersion, version); err != nil || !isNewer {
			return ""
		}
		state := cache.Load()
		state.NoticedAt = now
		cache.Save(state)
		return Notice(version)
	}
	type result struct {
		notice string
		crash  *system.CapturedPanic
	}
	found := make(chan result, 1)
	ctx, cancel := context.WithTimeout(context.Background(), lookupBudget)
	go func() {
		defer cancel()
		var answer result
		answer.crash = system.CatchPanic(func() {
			state := cache.Load()
			if now.Sub(state.NoticedAt) < Interval {
				return
			}
			if now.Sub(state.CheckedAt) < Interval {
				if state.Latest != "" {
					answer.notice = newer(state.Latest)
				}
				return
			}
			version, err := lookup(ctx)
			if err != nil {
				return
			}
			state = cache.Load()
			state.CheckedAt, state.Latest = now, version
			cache.Save(state)
			answer.notice = newer(version)
		})
		found <- answer
	}()
	return func() string {
		defer cancel()
		select {
		case answer := <-found:
			if answer.crash != nil {
				panic(*answer.crash)
			}
			return answer.notice
		case <-time.After(waitBudget):
			cancel()
			select {
			case answer := <-found:
				if answer.crash != nil {
					panic(*answer.crash)
				}
			default:
			}
			return ""
		}
	}
}
