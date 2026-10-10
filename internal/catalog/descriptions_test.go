package catalog

import (
	"regexp"
	"strings"
	"testing"
	"unicode/utf8"
)

const maxDescriptionLength = 100

var jargon = regexp.MustCompile(`(?i)\b(container|reverse proxy|self-hosted|docker|compose|indexer|daemon|endpoint)s?\b(\s*\([^)]+\))?`)

func unexplainedJargon(description string) []string {
	var found []string
	for _, m := range jargon.FindAllStringSubmatch(description, -1) {
		if m[2] == "" {
			found = append(found, strings.ToLower(strings.TrimSpace(m[0])))
		}
	}
	return found
}

func descriptionProblems(description string) []string {
	var problems []string
	if strings.TrimSpace(description) == "" {
		return []string{"is empty"}
	}
	if n := utf8.RuneCountInString(description); n > maxDescriptionLength {
		problems = append(problems, "is longer than 100 characters")
	}
	for _, word := range unexplainedJargon(description) {
		problems = append(problems, "uses unexplained jargon: "+word)
	}
	return problems
}

func TestDescriptionRulesFlagTheirViolations(t *testing.T) {
	cases := []struct {
		name        string
		description string
		want        []string
	}{
		{"empty", "", []string{"is empty"}},
		{"blank", "   ", []string{"is empty"}},
		{"plain", "Stream your movies and shows to every screen in the house", nil},
		{"exactly the limit", strings.Repeat("a", 100), nil},
		{"one over the limit", strings.Repeat("a", 101), []string{"is longer than 100 characters"}},
		{"banned word", "Runs a Docker thing", []string{"uses unexplained jargon: docker"}},
		{"plural", "Manages your containers", []string{"uses unexplained jargon: containers"}},
		{"two words", "A reverse proxy and an indexer", []string{"uses unexplained jargon: reverse proxy", "uses unexplained jargon: indexer"}},
		{"explained in the same sentence", "Finds shows through an indexer (a search site for downloads)", nil},
		{"substring is fine", "Keeps a decomposed list of tasks", nil},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := descriptionProblems(tc.description)
			if strings.Join(got, "|") != strings.Join(tc.want, "|") {
				t.Fatalf("descriptionProblems(%q) = %q, want %q", tc.description, got, tc.want)
			}
		})
	}
}

func TestEveryAppDescriptionIsPlain(t *testing.T) {
	apps := Default().Apps()
	if len(apps) == 0 {
		t.Fatal("the default catalog has no Apps")
	}
	for _, a := range apps {
		info := a.Info()
		for _, problem := range descriptionProblems(info.Description) {
			t.Errorf("App %s %s: %q", info.ID, problem, info.Description)
		}
	}
}

func TestEveryRecipeDescriptionIsPlain(t *testing.T) {
	recipes := Default().Recipes()
	if len(recipes) == 0 {
		t.Fatal("the default catalog has no Recipes")
	}
	for _, r := range recipes {
		for _, problem := range descriptionProblems(r.Description) {
			t.Errorf("Recipe %s %s: %q", r.ID, problem, r.Description)
		}
	}
}
