package project

import (
	"os"
	"strings"
	"testing"
)

func TestWriteFragmentRejectsOtherAppServiceBeforeOverwrite(t *testing.T) {
	p := testProject(t)
	if err := p.WriteFragment("one", "services:\n  shared-cache:\n    image: example/cache-one\n"); err != nil {
		t.Fatal(err)
	}
	if err := p.WriteFragment("two", "services:\n  own-cache:\n    image: example/cache-two\n"); err != nil {
		t.Fatal(err)
	}
	before, err := os.ReadFile(p.FragmentPath("two"))
	if err != nil {
		t.Fatal(err)
	}
	err = p.WriteFragment("two", "services:\n  shared-cache:\n    image: example/cache-two\n    environment:\n      PRIVATE: synthetic-private-value\n")
	if err == nil {
		t.Fatal("distinct Apps were allowed to define the same Compose service")
	}
	if !strings.Contains(err.Error(), "shared-cache") || !strings.Contains(err.Error(), "one") || !strings.Contains(err.Error(), "two") || strings.Contains(err.Error(), "synthetic-private-value") {
		t.Fatal("collision diagnosis must name only affected Apps and service")
	}
	after, err := os.ReadFile(p.FragmentPath("two"))
	if err != nil || string(after) != string(before) {
		t.Fatal("rejected fragment overwrote existing configuration")
	}
	if err := p.WriteFragment("one", "services:\n  shared-cache:\n    image: example/cache-one-updated\n"); err != nil {
		t.Fatal("same App could not rerender its owned service")
	}
}

func TestOwnershipValidationChecksPlannedUnionAndAllowsLegacyRepair(t *testing.T) {
	p := testProject(t)
	replacements := map[string]string{"one": "services:\n  one-cache:\n    image: example/one\n", "two": "services:\n  two-cache:\n    image: example/two\n"}
	if err := p.ValidateServiceOwnership(replacements); err != nil {
		t.Fatal("fresh planned restore was rejected")
	}
	for id, fragment := range replacements {
		if err := p.WriteFragment(id, fragment); err != nil {
			t.Fatal(err)
		}
	}
	if err := os.WriteFile(p.FragmentPath("two"), []byte(strings.ReplaceAll(replacements["two"], "two-cache", "one-cache")), 0o644); err != nil {
		t.Fatal(err)
	}
	if p.ValidateServiceOwnership(nil) == nil {
		t.Fatal("legacy collision was accepted")
	}
	if err := p.ValidateServiceOwnership(map[string]string{"two": replacements["two"]}); err != nil {
		t.Fatal("planned replacement could not repair legacy collision")
	}
	if err := p.WriteFragment("two", replacements["two"]); err != nil {
		t.Fatal(err)
	}
	if err := p.ValidateServiceOwnership(nil); err != nil {
		t.Fatal("repaired composition was rejected")
	}
}

func TestTheRootComposeFileIncludesTheEasyNamesCaddyWhenItExists(t *testing.T) {
	p := testProject(t)
	if err := p.WriteFragment("one", "services:\n  one:\n    image: example/one\n"); err != nil {
		t.Fatal(err)
	}
	if err := p.WriteNamesFragment("services:\n  access-caddy:\n    image: caddy\n"); err != nil {
		t.Fatal(err)
	}
	if err := p.WriteRoot(); err != nil {
		t.Fatal(err)
	}
	root, _ := os.ReadFile(p.Path("compose.yml"))
	want := "include:\n  - apps/one/compose.yml\n  - access/caddy/compose.yml\n"
	if !strings.Contains(string(root), want) {
		t.Fatalf("root:\n%s\nwant it to contain %q", root, want)
	}

	if err := p.RemoveNames(); err != nil {
		t.Fatal(err)
	}
	if err := p.WriteRoot(); err != nil {
		t.Fatal(err)
	}
	root, _ = os.ReadFile(p.Path("compose.yml"))
	if strings.Contains(string(root), "access") {
		t.Fatalf("root still includes it:\n%s", root)
	}
}

func TestTheRootComposeFileWithOnlyTheCaddyIncludesIt(t *testing.T) {
	p := testProject(t)
	if err := p.WriteNamesFragment("services:\n  access-caddy:\n    image: caddy\n"); err != nil {
		t.Fatal(err)
	}
	if err := p.WriteRoot(); err != nil {
		t.Fatal(err)
	}
	root, _ := os.ReadFile(p.Path("compose.yml"))
	if !strings.Contains(string(root), "include:\n  - access/caddy/compose.yml\n") || strings.Contains(string(root), "services: {}") {
		t.Fatalf("root:\n%s", root)
	}
}

func TestAppsCannotReuseTheManagedEasyNamesService(t *testing.T) {
	p := testProject(t)
	err := p.ValidateFragment("one", "services:\n  access-caddy:\n    image: example/one\n")
	if err == nil || !strings.Contains(err.Error(), "Easy names") {
		t.Fatalf("error %v", err)
	}
}
