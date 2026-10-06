package release

import "testing"

func TestNewerComparesVersionsNumerically(t *testing.T) {
	for _, tc := range []struct {
		current, latest string
		want            bool
	}{
		{"1.9.0", "v1.10.0", true},
		{"v1.10.0", "1.9.0", false},
		{"1.2.0", "v1.2.0", false},
		{"1.2", "1.2.1", true},
		{"2.0.0-rc1", "2.0.1", true},
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
