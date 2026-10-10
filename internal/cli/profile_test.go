package cli_test

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/ajnart/self-host/internal/systemtest"
)

func TestProfileSetExperienceThenShowItWithoutAProject(t *testing.T) {
	deps := systemtest.NewDeps(t)

	code, out := runWith(t, deps, testCatalog(&echoApp{id: "one"}), "profile", "set", "experience", "advanced")
	if code != 0 {
		t.Fatalf("set: exit %d\n%s", code, out)
	}

	code, out = runWith(t, deps, testCatalog(&echoApp{id: "one"}), "profile", "--json")
	if want := "{\n  \"experience\": \"advanced\"\n}\n"; code != 0 || out != want {
		t.Fatalf("profile --json: exit %d\ngot %q\nwant %q", code, out, want)
	}
	if _, err := os.Stat(filepath.Join(projectRoot(t, deps), ".env")); !os.IsNotExist(err) {
		t.Fatal("saving the Profile must not create a Project")
	}
}

func TestAHomeFolderHoldingOnlyTheProfileIsNotAProject(t *testing.T) {
	deps := systemtest.NewDeps(t)
	cat := testCatalog(&echoApp{id: "one"})
	runWith(t, deps, cat, "profile", "set", "experience", "new")

	code, out := runWith(t, deps, cat, "status", "--json")

	if want := "error: no Project yet; run: self-host install <app|recipe>\n"; code != 1 || out != want {
		t.Fatalf("status: exit %d\ngot %q\nwant %q", code, out, want)
	}
}

func TestProfileSetRejectsAnUnknownExperienceLevel(t *testing.T) {
	deps := systemtest.NewDeps(t)
	cat := testCatalog(&echoApp{id: "one"})

	code, out := runWith(t, deps, cat, "profile", "set", "experience", "expert")

	if want := "error: experience must be new or advanced, got \"expert\"\n"; code != 1 || out != want {
		t.Fatalf("exit %d\ngot %q\nwant %q", code, out, want)
	}
	if _, err := os.Stat(filepath.Join(projectRoot(t, deps), "profile.json")); !os.IsNotExist(err) {
		t.Fatal("a rejected level must not write the Profile")
	}
}

func TestProfileShowsItInPlainText(t *testing.T) {
	deps := systemtest.NewDeps(t)
	cat := testCatalog(&echoApp{id: "one"})

	_, unset := runWith(t, deps, cat, "profile")
	runWith(t, deps, cat, "profile", "set", "experience", "advanced")
	_, set := runWith(t, deps, cat, "profile")

	if want := "Experience  not set (treated as new)\n"; unset != want {
		t.Fatalf("unset: got %q, want %q", unset, want)
	}
	if want := "Experience  advanced\n"; set != want {
		t.Fatalf("set: got %q, want %q", set, want)
	}
}
