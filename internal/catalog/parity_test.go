package catalog

import (
	"encoding/json"
	"fmt"
	"os"
	"slices"
	"strconv"
	"strings"
	"testing"

	"github.com/ajnart/self-host/internal/app"
	"go.yaml.in/yaml/v3"
)

// The legacy catalog is the source of truth: testdata/legacy-facts.json is
// exported from it by tools/catalog-import -legacy, and every App and Recipe
// in it must exist here with the same facts.

type legacyFacts struct {
	Apps    []legacyApp    `json:"apps"`
	Recipes []legacyRecipe `json:"recipes"`
}

type legacyApp struct {
	ID            string `json:"id"`
	Name          string `json:"name"`
	Image         string `json:"image"`
	ContainerPort int    `json:"containerPort"`
	PublishedPort int    `json:"publishedPort"`
	Env           []struct {
		Name string `json:"name"`
		Kind string `json:"kind"`
	} `json:"env"`
	Mounts []struct {
		Name   string `json:"name"`
		Target string `json:"target"`
	} `json:"mounts"`
	Services            []string `json:"services"`
	OnboardingKind      string   `json:"onboardingKind"`
	Category            string   `json:"category"`
	DocsURL             string   `json:"docsURL"`
	HasRecipe           bool     `json:"hasRecipe"`
	HasLinks            bool     `json:"hasLinks"`
	LinkTargets         []string `json:"linkTargets"`
	HasComposition      bool     `json:"hasComposition"`
	CompositionServices []string `json:"compositionServices"`
}

type legacyRecipe struct {
	ID    string `json:"id"`
	Name  string `json:"name"`
	Roles []struct {
		Role string   `json:"role"`
		Apps []string `json:"apps"`
	} `json:"roles"`
}

// deviations are differences from the legacy facts made on purpose; each
// names the fact and why.
var deviations = map[string]map[string]string{
	"ntfy": {"publishedPort": "2586 is ntfy's documented port; 8080 clashes with many Apps"},
}

func loadLegacyFacts(t *testing.T) legacyFacts {
	t.Helper()
	data, err := os.ReadFile("testdata/legacy-facts.json")
	if err != nil {
		t.Fatalf("read legacy facts (go run ./tools/catalog-import -legacy internal/catalog/testdata/legacy-facts.json): %v", err)
	}
	var facts legacyFacts
	if err := json.Unmarshal(data, &facts); err != nil {
		t.Fatal(err)
	}
	return facts
}

// repository drops the tag and digest: Apps may float a tag the legacy
// catalog pinned.
func repository(image string) string {
	image, _, _ = strings.Cut(image, "@")
	if i := strings.LastIndex(image, ":"); i > strings.LastIndex(image, "/") {
		image = image[:i]
	}
	return image
}

// categoryName turns a taxonomy slug into the Info.Category label:
// "remote-access" → "Remote access".
func categoryName(slug string) string {
	if slug == "" {
		return ""
	}
	label := strings.ReplaceAll(slug, "-", " ")
	return strings.ToUpper(label[:1]) + label[1:]
}

func render(a app.App) string {
	inputs := map[string]string{}
	for _, in := range a.Inputs() {
		inputs[in.Key] = in.Default
		if inputs[in.Key] == "" {
			inputs[in.Key] = "example"
		}
	}
	return a.Compose(app.RenderContext{Port: a.Info().Port, Inputs: inputs})
}

func composeServices(compose string) (map[string]any, error) {
	var doc struct {
		Services map[string]any `yaml:"services"`
	}
	err := yaml.Unmarshal([]byte(compose), &doc)
	return doc.Services, err
}

// linked reports whether a Link joins id and target, in either direction:
// Sonarr declares the Link to qBittorrent that qBittorrent's links.ts held.
func linked(cat *Catalog, id, target string) bool {
	for _, pair := range [][2]string{{id, target}, {target, id}} {
		a, found := cat.App(pair[0])
		if !found {
			continue
		}
		if slices.ContainsFunc(a.Links(), func(l app.Link) bool { return l.Target == pair[1] }) {
			return true
		}
	}
	return false
}

func appProblems(cat *Catalog, a app.App, f legacyApp) []string {
	var problems []string
	info := a.Info()
	skip := deviations[f.ID]
	check := func(fact string, ok bool, format string, args ...any) {
		if _, deliberate := skip[fact]; !deliberate && !ok {
			problems = append(problems, fact+": "+fmt.Sprintf(format, args...))
		}
	}
	check("image", f.Image == "" || repository(info.Image) == repository(f.Image), "Info().Image %q, legacy %q", info.Image, f.Image)
	check("containerPort", f.ContainerPort == 0 || info.ContainerPort == f.ContainerPort, "Info().ContainerPort %d, legacy %d", info.ContainerPort, f.ContainerPort)
	check("publishedPort", f.PublishedPort == 0 || info.Port == f.PublishedPort, "Info().Port %d, legacy %d", info.Port, f.PublishedPort)
	check("category", info.Category == categoryName(f.Category), "Info().Category %q, want %q", info.Category, categoryName(f.Category))
	check("docs", f.DocsURL == "" || info.Docs == f.DocsURL, "Info().Docs %q, legacy %q", info.Docs, f.DocsURL)

	compose := render(a)
	services, err := composeServices(compose)
	check("compose", err == nil && len(services) > 0, "Compose() is not a YAML file with services: %v", err)
	if f.Image != "" {
		check("compose", strings.Contains(compose, repository(f.Image)), "Compose() lacks the image %s", repository(f.Image))
	}
	if info.ContainerPort != 0 {
		check("compose", strings.Contains(compose, ":"+strconv.Itoa(info.ContainerPort)), "Compose() does not publish container port %d", info.ContainerPort)
	}
	for _, m := range f.Mounts {
		check("mounts", strings.Contains(compose, ":"+m.Target), "Compose() lacks the mount target %s (%s)", m.Target, m.Name)
	}
	for _, e := range f.Env {
		if e.Kind != "file" {
			check("env", strings.Contains(compose, e.Name), "Compose() lacks the %s variable %s", e.Kind, e.Name)
		}
	}
	check("services", len(services) >= len(f.Services), "Compose() has %d services, legacy had %d (%s)", len(services), len(f.Services), strings.Join(f.Services, ", "))
	for _, target := range f.LinkTargets {
		check("links", linked(cat, f.ID, target), "no Link between %s and %s (legacy links.ts)", f.ID, target)
	}
	for _, dep := range f.CompositionServices {
		_, embedded := services[dep]
		check("composition", embedded, "Compose() lacks the %s service the legacy composition.json declared", dep)
	}
	return problems
}

// TestEveryLegacyAppIsPorted is the porting work queue: every legacy App
// must be in Default() with the legacy facts. It reports every gap at once.
func TestEveryLegacyAppIsPorted(t *testing.T) {
	facts := loadLegacyFacts(t)
	cat := Default()
	var missing []string
	mismatched := 0
	for _, f := range facts.Apps {
		a, found := cat.App(f.ID)
		if !found {
			missing = append(missing, f.ID)
			continue
		}
		problems := appProblems(cat, a, f)
		for _, p := range problems {
			t.Errorf("%s: %s", f.ID, p)
		}
		if len(problems) > 0 {
			mismatched++
		}
	}
	if len(missing) > 0 {
		t.Errorf("not ported (%d): %s", len(missing), strings.Join(missing, " "))
	}
	if len(missing) > 0 || mismatched > 0 {
		t.Errorf("summary: %d/%d legacy Apps ported, %d missing, %d ported with mismatches",
			len(facts.Apps)-len(missing), len(facts.Apps), len(missing), mismatched)
	}
}

// TestEveryLegacyRecipeIsPorted wants each legacy goal as a Recipe with
// the same ID that fills every role with one of the role's candidates.
func TestEveryLegacyRecipeIsPorted(t *testing.T) {
	facts := loadLegacyFacts(t)
	cat := Default()
	var missing []string
	for _, f := range facts.Recipes {
		r, found := cat.Recipe(f.ID)
		if !found {
			missing = append(missing, f.ID)
			continue
		}
		for _, role := range f.Roles {
			if len(role.Apps) > 0 && !slices.ContainsFunc(role.Apps, func(id string) bool { return slices.Contains(r.Apps, id) }) {
				t.Errorf("recipe %s: role %s has none of %s", f.ID, role.Role, strings.Join(role.Apps, ", "))
			}
		}
	}
	if len(missing) > 0 {
		t.Errorf("summary: %d/%d legacy Recipes ported; missing: %s",
			len(facts.Recipes)-len(missing), len(facts.Recipes), strings.Join(missing, " "))
	}
}

// TestEveryCatalogAppRenders renders every App's Compose file: valid YAML,
// an image per service, ports bound to ${BIND_IP}, and only Host settings
// or the App's own secrets interpolated.
func TestEveryCatalogAppRenders(t *testing.T) {
	for _, a := range Default().Apps() {
		info := a.Info()
		compose := render(a)
		services, err := composeServices(compose)
		if err != nil || len(services) == 0 {
			t.Errorf("%s: Compose() is not a YAML file with services: %v", info.ID, err)
			continue
		}
		if _, found := services[info.Service]; !found {
			t.Errorf("%s: no service named %q", info.ID, info.Service)
		}
		for name, svc := range services {
			if m, _ := svc.(map[string]any); m["image"] == nil {
				t.Errorf("%s: service %s has no image", info.ID, name)
			}
		}
		if strings.Contains(compose, "ports:") && !strings.Contains(compose, "${BIND_IP}:") {
			t.Errorf("%s: published ports must bind ${BIND_IP}", info.ID)
		}
		prefix := strings.ToUpper(strings.ReplaceAll(info.ID, "-", "_")) + "_"
		for _, ref := range composeRef.FindAllStringSubmatch(compose, -1) {
			name, _, _ := strings.Cut(ref[1], ":")
			if !hostSettings[name] && !strings.HasPrefix(name, prefix) {
				t.Errorf("%s: Compose() interpolates ${%s}, which is neither a Host setting nor an %s* secret", info.ID, name, prefix)
			}
		}
	}
}
