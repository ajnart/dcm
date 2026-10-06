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
