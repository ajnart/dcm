package project

import (
	"os"
	"path/filepath"
	"testing"
)

func TestProfileRoundTripsBeforeTheProjectExists(t *testing.T) {
	p := testProject(t)
	p.Root = filepath.Join(p.Root, ".self-host")

	got, err := p.LoadProfile()
	if err != nil || got != (Profile{}) {
		t.Fatalf("no answer yet should read as the zero Profile, got %+v, %v", got, err)
	}
	if err := p.SaveProfile(Profile{Experience: "advanced"}); err != nil {
		t.Fatal(err)
	}

	got, err = p.LoadProfile()
	if err != nil || got != (Profile{Experience: "advanced"}) {
		t.Fatalf("round trip = %+v, %v", got, err)
	}
	data, err := os.ReadFile(p.Path("profile.json"))
	if err != nil || string(data) != "{\n  \"experience\": \"advanced\"\n}\n" {
		t.Fatalf("profile.json = %q, %v", data, err)
	}
	if p.Exists() {
		t.Fatal("a Profile alone is not a Project")
	}
}
