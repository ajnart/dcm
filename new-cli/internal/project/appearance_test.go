package project

import (
	"os"
	"path/filepath"
	"testing"
)

func TestAppearanceRoundTripsBesideTheHostSettings(t *testing.T) {
	p := testProject(t)
	if err := p.SaveSettings(map[string]string{"TZ": "Europe/Paris", "EXPOSURE": "lan"}); err != nil {
		t.Fatal(err)
	}
	settings, _ := os.ReadFile(p.Path(".env"))

	got, err := p.LoadAppearance()
	if err != nil || got != (Appearance{}) {
		t.Fatalf("no choice yet should read as the zero Appearance, got %+v, %v", got, err)
	}
	if err := p.SaveAppearance(Appearance{Glyphs: "nerd-font"}); err != nil {
		t.Fatal(err)
	}
	got, err = p.LoadAppearance()
	if err != nil || got != (Appearance{Glyphs: "nerd-font"}) {
		t.Fatalf("round trip = %+v, %v", got, err)
	}

	data, err := os.ReadFile(p.Path("appearance.json"))
	if err != nil || string(data) != "{\n  \"glyphs\": \"nerd-font\"\n}\n" {
		t.Fatalf("appearance.json = %q, %v", data, err)
	}
	if after, _ := os.ReadFile(p.Path(".env")); string(after) != string(settings) {
		t.Fatalf("the Host settings changed:\n%s", after)
	}
	if _, err := os.Stat(p.Path("secrets.env")); !os.IsNotExist(err) {
		t.Fatal("saving the appearance must not touch the secrets")
	}
}

// Onboarding may save the choice while the install that creates the
// Project is still starting.
func TestAppearanceSavesBeforeTheProjectFolderExists(t *testing.T) {
	p := testProject(t)
	p.Root = filepath.Join(p.Root, "self-host")

	if err := p.SaveAppearance(Appearance{Glyphs: "simple"}); err != nil {
		t.Fatal(err)
	}

	if got, err := p.LoadAppearance(); err != nil || got.Glyphs != "simple" {
		t.Fatalf("got %+v, %v", got, err)
	}
	if p.Exists() {
		t.Fatal("an appearance alone is not a Project")
	}
}
