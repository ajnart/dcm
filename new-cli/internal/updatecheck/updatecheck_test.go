package updatecheck_test

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/ajnart/self-host/internal/system"
	"github.com/ajnart/self-host/internal/systemtest"
	"github.com/ajnart/self-host/internal/updatecheck"
)

func depsAt(t *testing.T, version string, env map[string]string) *system.Deps {
	t.Helper()
	deps := systemtest.NewDeps(t)
	deps.Version = version
	systemtest.SetEnv(deps, env)
	return deps
}

func TestCacheLivesUnderTheUserCacheDirAndKeepsNoSecrets(t *testing.T) {
	deps := depsAt(t, "1.0.0", nil)
	cache, ok := updatecheck.Open(deps)
	if !ok {
		t.Fatal("no cache")
	}
	want := updatecheck.State{Latest: "1.2.0", Skipped: "1.1.0", CheckedAt: deps.Now(), NoticedAt: deps.Now().Add(-time.Hour)}

	if err := cache.Save(want); err != nil {
		t.Fatal(err)
	}

	dir, _ := deps.CacheDir()
	path := filepath.Join(dir, "self-host", "update.json")
	info, err := os.Stat(path)
	if err != nil || info.Mode().Perm() != 0o600 {
		t.Fatalf("cache file: %v %v", info, err)
	}
	got := cache.Load()
	if got.Latest != "1.2.0" || got.Skipped != "1.1.0" || !got.CheckedAt.Equal(want.CheckedAt) || !got.NoticedAt.Equal(want.NoticedAt) {
		t.Errorf("Load = %+v, want %+v", got, want)
	}
}

func TestACorruptOrMissingCacheIsEmpty(t *testing.T) {
	deps := depsAt(t, "1.0.0", nil)
	cache, _ := updatecheck.Open(deps)
	if got := cache.Load(); got != (updatecheck.State{}) {
		t.Errorf("missing cache = %+v", got)
	}
	dir, _ := deps.CacheDir()
	os.MkdirAll(filepath.Join(dir, "self-host"), 0o755)
	os.WriteFile(filepath.Join(dir, "self-host", "update.json"), []byte("{not json"), 0o600)
	if got := cache.Load(); got != (updatecheck.State{}) {
		t.Errorf("corrupt cache = %+v", got)
	}
}

func TestNoCacheDirMeansNoCache(t *testing.T) {
	deps := depsAt(t, "1.0.0", nil)
	deps.CacheDir = func() (string, error) { return "", errors.New("no home") }
	if _, ok := updatecheck.Open(deps); ok {
		t.Error("Open succeeded without a cache directory")
	}
}

func TestDisabled(t *testing.T) {
	for _, tc := range []struct {
		name    string
		version string
		env     map[string]string
		want    bool
	}{
		{"release build", "1.0.0", nil, false},
		{"development build", "dev", nil, true},
		{"opted out", "1.0.0", map[string]string{"SELF_HOST_NO_UPDATE_CHECK": "1"}, true},
		{"continuous integration", "1.0.0", map[string]string{"CI": "true"}, true},
		{"opt-out set to 0", "1.0.0", map[string]string{"SELF_HOST_NO_UPDATE_CHECK": "0"}, false},
	} {
		if got := updatecheck.Disabled(depsAt(t, tc.version, tc.env)); got != tc.want {
			t.Errorf("%s: Disabled = %v, want %v", tc.name, got, tc.want)
		}
	}
}

type lookup struct {
	version string
	err     error
	calls   int
	block   chan struct{}
}

func (l *lookup) Latest(ctx context.Context) (string, error) {
	l.calls++
	if l.block != nil {
		select {
		case <-l.block:
		case <-ctx.Done():
			return "", ctx.Err()
		}
	}
	return l.version, l.err
}

func notice(t *testing.T, deps *system.Deps, l *lookup) string {
	t.Helper()
	return updatecheck.StartNotice(deps, l.Latest)()
}

func TestNoticeNamesTheNewerReleaseOnce(t *testing.T) {
	deps := depsAt(t, "1.0.0", nil)
	l := &lookup{version: "1.1.0"}

	got := notice(t, deps, l)

	if got != "self-host 1.1.0 is available: run self-host self-update" {
		t.Errorf("notice = %q", got)
	}
	if again := notice(t, deps, l); again != "" || l.calls != 1 {
		t.Errorf("second command within 24 h: notice %q, lookups %d", again, l.calls)
	}
}

func TestNoticeComesBackAfterTwentyFourHours(t *testing.T) {
	deps := depsAt(t, "1.0.0", nil)
	l := &lookup{version: "1.1.0"}
	notice(t, deps, l)

	deps.Sleep(context.Background(), 24*time.Hour+time.Minute)

	if got := notice(t, deps, l); got == "" || l.calls != 2 {
		t.Errorf("after 24 h: notice %q, lookups %d", got, l.calls)
	}
}

func TestNoticeIsSilentButCachedWhenUpToDate(t *testing.T) {
	deps := depsAt(t, "1.1.0", nil)
	l := &lookup{version: "1.1.0"}

	if got := notice(t, deps, l); got != "" {
		t.Errorf("notice = %q", got)
	}
	notice(t, deps, l)
	if l.calls != 1 {
		t.Errorf("an up-to-date check was repeated within 24 h: %d lookups", l.calls)
	}
}

func TestNoticeUsesTheCachedLatestWithoutTheNetwork(t *testing.T) {
	deps := depsAt(t, "1.0.0", nil)
	cache, _ := updatecheck.Open(deps)
	cache.Save(updatecheck.State{Latest: "1.3.0", CheckedAt: deps.Now().Add(-2 * time.Hour), NoticedAt: deps.Now().Add(-48 * time.Hour)})
	l := &lookup{version: "9.9.9"}

	got := notice(t, deps, l)

	if got != "self-host 1.3.0 is available: run self-host self-update" || l.calls != 0 {
		t.Errorf("notice %q, lookups %d", got, l.calls)
	}
}

func TestNoticeSkipsALookupThatErrors(t *testing.T) {
	deps := depsAt(t, "1.0.0", nil)
	if got := notice(t, deps, &lookup{err: errors.New("offline")}); got != "" {
		t.Errorf("notice = %q", got)
	}
}

func TestNoticeNeverWaitsForASlowLookup(t *testing.T) {
	deps := depsAt(t, "1.0.0", nil)
	l := &lookup{version: "1.1.0", block: make(chan struct{})}
	defer close(l.block)

	start := time.Now()
	got := notice(t, deps, l)

	if got != "" || time.Since(start) > time.Second {
		t.Errorf("notice %q after %v", got, time.Since(start))
	}
}

func TestADevelopmentBuildIsNeverNoticed(t *testing.T) {
	deps := depsAt(t, "dev", nil)
	l := &lookup{version: "1.1.0"}
	if got := notice(t, deps, l); got != "" {
		t.Errorf("notice = %q", got)
	}
}
