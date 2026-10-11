package release

import (
	"context"
	"net/http"
	"strings"
	"testing"

	"github.com/ajnart/self-host/internal/system"
)

func TestNewerComparesVersionsNumerically(t *testing.T) {
	for _, tc := range []struct {
		current, latest string
		want            bool
	}{
		{"1.9.0", "v1.10.0", true},
		{"v1.10.0", "1.9.0", false},
		{"1.2.0", "v1.2.0", false},

		{"2.0.0", "new-cli-v2.0.1", true},
	} {
		got, err := Newer(tc.current, tc.latest)
		if err != nil || got != tc.want {
			t.Errorf("Newer(%q, %q) = %v, %v; want %v", tc.current, tc.latest, got, err, tc.want)
		}
	}
}

func TestDevBuildIsNotAReleaseVersion(t *testing.T) {
	if IsRelease("dev") {
		t.Error("dev is not a release version")
	}
	if _, err := Newer("dev", "v1.0.0"); err == nil {
		t.Error("Newer accepted a dev build")
	}
}

func TestMalformedVersionsAreNotReleases(t *testing.T) {
	for _, value := range []string{"1.2", "01.2.3", "1.2.3-rc1", "1.2.3+build", "1.2.3/path", "new-cli-vv1.2.3"} {
		if IsRelease(value) {
			t.Errorf("accepted malformed version %q", value)
		}
	}
}

func TestRepositoryComesFromOneConstantAndTheEnvironmentOverride(t *testing.T) {
	deps := &system.Deps{Getenv: func(string) string { return "" }}
	c := NewClient(deps)
	if c.api() != "https://api.github.com/repos/ajnart/selfhost" || c.web() != "https://github.com/ajnart/selfhost" {
		t.Errorf("defaults: %s %s", c.api(), c.web())
	}
	deps.Getenv = func(key string) string {
		if key == EnvRepo {
			return "ajnart/selfhost"
		}
		return ""
	}
	c = NewClient(deps)
	if c.api() != "https://api.github.com/repos/ajnart/selfhost" || c.web() != "https://github.com/ajnart/selfhost" {
		t.Errorf("override: %s %s", c.api(), c.web())
	}
}

func TestAnInvalidRepositoryOverrideIsRefused(t *testing.T) {
	for _, repo := range []string{"../../evil", "ajnart/..", "ajnart/.", "../evil", "just-a-name"} {
		c := Client{HTTP: http.DefaultClient, Repo: repo}
		if _, err := c.Latest(context.Background()); err == nil || !strings.Contains(err.Error(), EnvRepo) {
			t.Errorf("Repo %q: Latest error = %v", repo, err)
		}
	}
}
