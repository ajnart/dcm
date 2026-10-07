package main

import (
	"bytes"
	"encoding/json"
	"flag"
	"os"
	"path/filepath"
	"testing"
)

var update = flag.Bool("update", false, "rewrite testdata/facts.golden.json")

const realCatalog = "/Users/ajnart/Documents/GitHub/selfhost-skills/.agents/skills/self-host/workflows/selfhost/references/catalog"

func marshalFacts(t *testing.T, facts []appFact) []byte {
	t.Helper()
	data, err := json.MarshalIndent(facts, "", "  ")
	if err != nil {
		t.Fatalf("marshal facts: %v", err)
	}
	return append(data, '\n')
}

func TestGoldenFacts(t *testing.T) {
	facts, err := buildFacts(filepath.Join("testdata", "cat"))
	if err != nil {
		t.Fatalf("buildFacts: %v", err)
	}
	got := marshalFacts(t, facts)

	goldenPath := filepath.Join("testdata", "facts.golden.json")
	if *update {
		if err := os.WriteFile(goldenPath, got, 0o644); err != nil {
			t.Fatalf("write golden: %v", err)
		}
		return
	}

	want, err := os.ReadFile(goldenPath)
	if err != nil {
		t.Fatalf("read golden: %v", err)
	}
	if !bytes.Equal(got, want) {
		t.Fatalf("facts mismatch with %s\n--- got ---\n%s\n--- want ---\n%s", goldenPath, got, want)
	}
}

func TestRealCatalogCounts(t *testing.T) {
	if _, err := os.Stat(realCatalog); err != nil {
		t.Skipf("real catalog not available: %v", err)
	}
	facts, err := buildFacts(realCatalog)
	if err != nil {
		t.Fatalf("buildFacts: %v", err)
	}
	if len(facts) != 94 {
		t.Errorf("got %d apps, want 94", len(facts))
	}
	withRecipe := 0
	for _, f := range facts {
		if f.HasRecipe {
			withRecipe++
		}
	}
	if withRecipe != 81 {
		t.Errorf("got %d apps with recipe, want 81", withRecipe)
	}
}

func marshalLegacy(t *testing.T, catDir string) []byte {
	t.Helper()
	out, err := buildLegacy(catDir)
	if err != nil {
		t.Fatalf("buildLegacy: %v", err)
	}
	data, err := json.MarshalIndent(out, "", "  ")
	if err != nil {
		t.Fatalf("marshal legacy: %v", err)
	}
	return append(data, '\n')
}

func legacyCatalog(t *testing.T) string {
	t.Helper()
	if _, err := os.Stat(realCatalog); err == nil {
		return realCatalog
	}
	return filepath.Join("testdata", "cat")
}

func TestLegacyDeterministic(t *testing.T) {
	cat := legacyCatalog(t)
	first := marshalLegacy(t, cat)
	second := marshalLegacy(t, cat)
	if !bytes.Equal(first, second) {
		t.Fatalf("legacy output is not deterministic")
	}
	if len(first) == 0 || first[len(first)-1] != '\n' {
		t.Fatalf("legacy output must end with a trailing newline")
	}
}

func TestLegacyRealCatalog(t *testing.T) {
	if _, err := os.Stat(realCatalog); err != nil {
		t.Skipf("real catalog not available: %v", err)
	}
	out, err := buildLegacy(realCatalog)
	if err != nil {
		t.Fatalf("buildLegacy: %v", err)
	}
	if len(out.Apps) != 94 {
		t.Errorf("got %d apps, want 94", len(out.Apps))
	}
	if len(out.Recipes) != 19 {
		t.Errorf("got %d recipes, want 19", len(out.Recipes))
	}

	byID := map[string]legacyApp{}
	for _, a := range out.Apps {
		byID[a.ID] = a
	}
	immich := byID["immich"]
	if got := immich.CompositionServices; !equalStrings(got, []string{"database", "redis"}) {
		t.Errorf("immich compositionServices = %v, want [database redis]", got)
	}
	sonarr := byID["sonarr"]
	if !sonarr.HasLinks {
		t.Errorf("sonarr hasLinks = false, want true")
	}
	if !contains(sonarr.LinkTargets, "qbittorrent") {
		t.Errorf("sonarr linkTargets = %v, want qbittorrent", sonarr.LinkTargets)
	}
}

func equalStrings(a, b []string) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i] != b[i] {
			return false
		}
	}
	return true
}

func contains(haystack []string, needle string) bool {
	for _, s := range haystack {
		if s == needle {
			return true
		}
	}
	return false
}

func TestNoSecretValue(t *testing.T) {
	facts, err := buildFacts(filepath.Join("testdata", "cat"))
	if err != nil {
		t.Fatalf("buildFacts: %v", err)
	}
	for _, f := range facts {
		for _, e := range f.Environment {
			if e.Kind == "secret" && e.Value != "" {
				t.Errorf("%s: secret env %s carries value %q", f.ID, e.Name, e.Value)
			}
		}
	}
}
