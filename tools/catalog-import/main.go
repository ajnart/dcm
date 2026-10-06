// Command catalog-import is a development tool that port the legacy JSON
// catalog (94 manifests, 81 recipes) into one deterministic facts table and a
// per-App traps digest. It is a dev tool and is never imported by the shipped
// binary.
package main

import (
	"encoding/json"
	"flag"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
)

// docApps lists the Apps whose docs/<id>.md contains a prose Traps section that
// is copied into the digest.
var docApps = []string{
	"homarr", "jellyfin", "prowlarr", "qbittorrent", "radarr", "seerr", "sonarr",
}

type envFact struct {
	Name  string `json:"name"`
	Kind  string `json:"kind"`
	Value string `json:"value,omitempty"`
}

type mountFact struct {
	Name   string `json:"name"`
	Target string `json:"target"`
	Kind   string `json:"kind"`
}

type onboardingFact struct {
	Kind              string `json:"kind"`
	Username          string `json:"username,omitempty"`
	SecretEnvironment string `json:"secret_environment,omitempty"`
	FileID            string `json:"file_id,omitempty"`
	OfficialURL       string `json:"official_url,omitempty"`
}

type acceptanceFact struct {
	ID          string `json:"id"`
	Description string `json:"description"`
}

type supportFact struct {
	Tier       string `json:"tier"`
	Automation string `json:"automation"`
}

type lifecycleFact struct {
	Status    string `json:"status"`
	CheckedAt string `json:"checked_at"`
	Note      string `json:"note"`
}

type appFact struct {
	ID               string           `json:"id"`
	Name             string           `json:"name"`
	Aliases          []string         `json:"aliases"`
	Roles            []string         `json:"roles"`
	Categories       []string         `json:"categories"`
	Lifecycle        lifecycleFact    `json:"lifecycle"`
	Image            string           `json:"image"`
	ContainerPort    *int             `json:"container_port,omitempty"`
	DefaultPublished *int             `json:"default_published_port,omitempty"`
	Environment      []envFact        `json:"environment"`
	Mounts           []mountFact      `json:"mounts"`
	Onboarding       onboardingFact   `json:"onboarding"`
	PrivateFiles     []string         `json:"private_files"`
	MultiService     bool             `json:"multi_service"`
	Services         []string         `json:"services"`
	Acceptance       []acceptanceFact `json:"acceptance"`
	Support          supportFact      `json:"support"`
	DocsURL          string           `json:"docs_url"`
	UpstreamURL      string           `json:"upstream_url"`
	Pitfalls         []string         `json:"pitfalls"`
	Security         []string         `json:"security"`
	HasRecipe        bool             `json:"has_recipe"`
}

// manifest is a tolerant decode of resources/catalog/apps/<id>/manifest.json.
type manifest struct {
	ID         string   `json:"id"`
	Name       string   `json:"name"`
	Aliases    []string `json:"aliases"`
	Roles      []string `json:"roles"`
	Categories []string `json:"categories"`
	Upstream   struct {
		URL  string  `json:"url"`
		Docs *string `json:"docs"`
	} `json:"upstream"`
	Image struct {
		Reference *string `json:"reference"`
	} `json:"image"`
	Support struct {
		Tier       string `json:"tier"`
		Automation string `json:"automation"`
	} `json:"support"`
	Lifecycle struct {
		Status    string `json:"status"`
		CheckedAt string `json:"checkedAt"`
		Note      string `json:"note"`
	} `json:"lifecycle"`
	Pitfalls []string `json:"pitfalls"`
	Security []string `json:"security"`
}

// recipe is a tolerant decode of resources/catalog/apps/<id>/recipe.json.
type recipe struct {
	AppID    string       `json:"appId"`
	Services []service    `json:"services"`
	Privates []privateFic `json:"privateFiles"`
	Onboard  onboarding   `json:"onboarding"`
	Defaults defaults     `json:"defaults"`
	Accept   []acceptance `json:"acceptance"`
}

type service struct {
	ID                string      `json:"id"`
	PublishTargetPort *int        `json:"publishTargetPort"`
	Environment       []env       `json:"environment"`
	HostEnvironment   []hostEnv   `json:"hostEnvironment"`
	FileEnvironment   []fileEnv   `json:"fileEnvironment"`
	SecretEnvironment []secretEnv `json:"secretEnvironment"`
	Mounts            []mount     `json:"mounts"`
}

type env struct {
	Name  string `json:"name"`
	Value string `json:"value"`
}

type hostEnv struct {
	Name string `json:"name"`
}

type fileEnv struct {
	Name   string `json:"name"`
	FileID string `json:"fileId"`
}

type secretEnv struct {
	Name   string `json:"name"`
	FileID string `json:"fileId"`
}

type mount struct {
	Name   string `json:"name"`
	Target string `json:"target"`
	Kind   string `json:"kind"`
}

type privateFic struct {
	ID string `json:"id"`
}

type onboarding struct {
	Kind              string `json:"kind"`
	OfficialURL       string `json:"officialUrl"`
	Username          string `json:"username"`
	SecretEnvironment string `json:"secretEnvironment"`
	FileID            string `json:"fileId"`
}

type defaults struct {
	PublishedPort *int `json:"publishedPort"`
}

type acceptance struct {
	ID          string `json:"id"`
	Description string `json:"description"`
}

// buildFacts reads every App directory under catDir and returns one fact per
// App, sorted by id.
func buildFacts(catDir string) ([]appFact, error) {
	entries, err := os.ReadDir(filepath.Join(catDir, "apps"))
	if err != nil {
		return nil, err
	}
	facts := make([]appFact, 0, len(entries))
	for _, entry := range entries {
		if !entry.IsDir() {
			continue
		}
		id := entry.Name()
		appDir := filepath.Join(catDir, "apps", id)
		fact, err := readApp(appDir, id)
		if err != nil {
			return nil, fmt.Errorf("%s: %w", id, err)
		}
		facts = append(facts, fact)
	}
	sort.Slice(facts, func(i, j int) bool { return facts[i].ID < facts[j].ID })
	return facts, nil
}

func readApp(appDir, id string) (appFact, error) {
	raw, err := os.ReadFile(filepath.Join(appDir, "manifest.json"))
	if err != nil {
		return appFact{}, err
	}
	var man manifest
	if err := json.Unmarshal(raw, &man); err != nil {
		return appFact{}, fmt.Errorf("manifest: %w", err)
	}

	fact := appFact{
		ID:         firstNonEmpty(man.ID, id),
		Name:       man.Name,
		Aliases:    nonNilStrings(man.Aliases),
		Roles:      nonNilStrings(man.Roles),
		Categories: nonNilStrings(man.Categories),
		Lifecycle: lifecycleFact{
			Status:    man.Lifecycle.Status,
			CheckedAt: man.Lifecycle.CheckedAt,
			Note:      man.Lifecycle.Note,
		},
		Image:    derefString(man.Image.Reference),
		Pitfalls: nonNilStrings(man.Pitfalls),
		Security: nonNilStrings(man.Security),
		Support: supportFact{
			Tier:       man.Support.Tier,
			Automation: man.Support.Automation,
		},
		DocsURL:     derefString(man.Upstream.Docs),
		UpstreamURL: man.Upstream.URL,
	}

	recipePath := filepath.Join(appDir, "recipe.json")
	if _, err := os.Stat(recipePath); err != nil {
		if os.IsNotExist(err) {
			return finishEmpty(fact), nil
		}
		return appFact{}, err
	}
	raw, err = os.ReadFile(recipePath)
	if err != nil {
		return appFact{}, err
	}
	var rec recipe
	if err := json.Unmarshal(raw, &rec); err != nil {
		return appFact{}, fmt.Errorf("recipe: %w", err)
	}
	fact.HasRecipe = true
	fact.Onboarding = onboardingFact{
		Kind:              rec.Onboard.Kind,
		Username:          rec.Onboard.Username,
		SecretEnvironment: rec.Onboard.SecretEnvironment,
		FileID:            rec.Onboard.FileID,
		OfficialURL:       rec.Onboard.OfficialURL,
	}
	fact.DefaultPublished = rec.Defaults.PublishedPort
	for _, pf := range rec.Privates {
		fact.PrivateFiles = append(fact.PrivateFiles, pf.ID)
	}
	for _, ac := range rec.Accept {
		fact.Acceptance = append(fact.Acceptance, acceptanceFact{ID: ac.ID, Description: ac.Description})
	}
	for _, svc := range rec.Services {
		fact.Services = append(fact.Services, svc.ID)
		fact.ContainerPort = firstPort(fact.ContainerPort, svc.PublishTargetPort)
		fact.Environment = appendServiceEnv(fact.Environment, svc)
		fact.Mounts = appendMounts(fact.Mounts, svc.Mounts)
	}
	fact.MultiService = len(fact.Services) > 1
	return finishEmpty(fact), nil
}

// finishEmpty normalises nil slices to empty arrays so the JSON output is
// stable and never emits null for set-like arrays.
func finishEmpty(f appFact) appFact {
	if f.Aliases == nil {
		f.Aliases = []string{}
	}
	if f.Roles == nil {
		f.Roles = []string{}
	}
	if f.Categories == nil {
		f.Categories = []string{}
	}
	if f.Environment == nil {
		f.Environment = []envFact{}
	}
	if f.Mounts == nil {
		f.Mounts = []mountFact{}
	}
	if f.PrivateFiles == nil {
		f.PrivateFiles = []string{}
	}
	if f.Services == nil {
		f.Services = []string{}
	}
	if f.Acceptance == nil {
		f.Acceptance = []acceptanceFact{}
	}
	if f.Pitfalls == nil {
		f.Pitfalls = []string{}
	}
	if f.Security == nil {
		f.Security = []string{}
	}
	return f
}

// appendServiceEnv flattens the four environment markers into one ordered,
// de-duplicated list. Secrets never carry a value.
func appendServiceEnv(dst []envFact, svc service) []envFact {
	add := func(e envFact) []envFact {
		for _, existing := range dst {
			if existing.Name == e.Name && existing.Kind == e.Kind {
				return dst
			}
		}
		return append(dst, e)
	}
	for _, e := range svc.Environment {
		dst = add(envFact{Name: e.Name, Kind: "plain", Value: e.Value})
	}
	for _, e := range svc.HostEnvironment {
		dst = add(envFact{Name: e.Name, Kind: "host"})
	}
	for _, e := range svc.FileEnvironment {
		dst = add(envFact{Name: e.Name, Kind: "file"})
	}
	for _, e := range svc.SecretEnvironment {
		dst = add(envFact{Name: e.Name, Kind: "secret"})
	}
	return dst
}

func appendMounts(dst []mountFact, mounts []mount) []mountFact {
	for _, m := range mounts {
		seen := false
		for _, existing := range dst {
			if existing.Name == m.Name && existing.Target == m.Target {
				seen = true
				break
			}
		}
		if !seen {
			dst = append(dst, mountFact{Name: m.Name, Target: m.Target, Kind: m.Kind})
		}
	}
	return dst
}

func firstPort(current, candidate *int) *int {
	if current != nil {
		return current
	}
	if candidate != nil {
		return candidate
	}
	return nil
}

func firstNonEmpty(a, b string) string {
	if a != "" {
		return a
	}
	return b
}

func derefString(s *string) string {
	if s == nil {
		return ""
	}
	return *s
}

func nonNilStrings(s []string) []string {
	if s == nil {
		return []string{}
	}
	return s
}

func writeFacts(path string, facts []appFact) error {
	if dir := filepath.Dir(path); dir != "" {
		if err := os.MkdirAll(dir, 0o755); err != nil {
			return err
		}
	}
	data, err := json.MarshalIndent(facts, "", "  ")
	if err != nil {
		return err
	}
	data = append(data, '\n')
	return os.WriteFile(path, data, 0o644)
}

var headingRe = regexp.MustCompile(`^(#+)[ \t]+(.*[^ \t])[ \t]*$`)

func writeTraps(dir, docsDir string, facts []appFact) error {
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return err
	}
	docSet := map[string]bool{}
	for _, id := range docApps {
		docSet[id] = true
	}
	for _, f := range facts {
		var b strings.Builder
		fmt.Fprintf(&b, "# %s traps\n", f.Name)
		writeBullets(&b, "Pitfalls", f.Pitfalls)
		writeBullets(&b, "Security", f.Security)
		if docSet[f.ID] && docsDir != "" {
			section, ok, err := readTrapsSection(filepath.Join(docsDir, f.ID+".md"))
			if err != nil {
				return err
			}
			if ok {
				fmt.Fprintf(&b, "\n## From docs/%s.md\n\n### Traps\n%s\n", f.ID, section)
			}
		}
		out := filepath.Join(dir, f.ID+".md")
		if err := os.WriteFile(out, []byte(b.String()), 0o644); err != nil {
			return err
		}
	}
	return nil
}

func writeBullets(b *strings.Builder, heading string, items []string) {
	if len(items) == 0 {
		return
	}
	fmt.Fprintf(b, "\n## %s\n\n", heading)
	for _, item := range items {
		fmt.Fprintf(b, "- %s\n", item)
	}
}

// readTrapsSection extracts the "Traps" heading and its body through to the
// next heading of the same or a higher level.
func readTrapsSection(path string) (string, bool, error) {
	raw, err := os.ReadFile(path)
	if err != nil {
		if os.IsNotExist(err) {
			return "", false, nil
		}
		return "", false, err
	}
	lines := strings.Split(strings.ReplaceAll(string(raw), "\r\n", "\n"), "\n")
	start, level := -1, 0
	for i, line := range lines {
		if m := headingRe.FindStringSubmatch(line); m != nil {
			if strings.Contains(strings.ToLower(m[2]), "traps") {
				start, level = i, len(m[1])
				break
			}
		}
	}
	if start == -1 {
		return "", false, nil
	}
	end := len(lines)
	for i := start + 1; i < len(lines); i++ {
		if m := headingRe.FindStringSubmatch(lines[i]); m != nil {
			if len(m[1]) <= level {
				end = i
				break
			}
		}
	}
	body := strings.TrimRight(strings.Join(lines[start+1:end], "\n"), "\n")
	return body, true, nil
}

type count struct {
	Name string
	N    int
}

func printSummary(facts []appFact) {
	kinds := map[string]int{}
	categories := map[string]int{}
	var noRecipe []string
	for _, f := range facts {
		if f.Onboarding.Kind != "" {
			kinds[f.Onboarding.Kind]++
		}
		for _, c := range f.Categories {
			categories[c]++
		}
		if !f.HasRecipe {
			noRecipe = append(noRecipe, f.ID)
		}
	}
	fmt.Printf("apps: %d (with recipe: %d)\n", len(facts), len(facts)-len(noRecipe))
	fmt.Println("onboarding kinds:")
	for _, c := range sortedCounts(kinds) {
		fmt.Printf("  %s: %d\n", c.Name, c.N)
	}
	fmt.Println("categories:")
	for _, c := range sortedCounts(categories) {
		fmt.Printf("  %s: %d\n", c.Name, c.N)
	}
	fmt.Println("apps without recipe:")
	for _, id := range noRecipe {
		fmt.Printf("  %s\n", id)
	}
}

func sortedCounts(m map[string]int) []count {
	out := make([]count, 0, len(m))
	for k, v := range m {
		out = append(out, count{Name: k, N: v})
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].N != out[j].N {
			return out[i].N > out[j].N
		}
		return out[i].Name < out[j].Name
	})
	return out
}

func main() {
	cat := flag.String("cat", "", "catalog directory containing apps/ and schemas/ (required)")
	out := flag.String("out", "tools/catalog-import/facts.json", "output facts JSON file")
	traps := flag.String("traps", "", "when set, write the per-App traps digest to this directory")
	docs := flag.String("docs", "", "directory containing <id>.md prose")
	flag.Parse()

	if *cat == "" {
		fmt.Fprintln(os.Stderr, "catalog-import: -cat is required")
		os.Exit(2)
	}

	facts, err := buildFacts(*cat)
	if err != nil {
		fmt.Fprintf(os.Stderr, "catalog-import: %v\n", err)
		os.Exit(1)
	}
	if err := writeFacts(*out, facts); err != nil {
		fmt.Fprintf(os.Stderr, "catalog-import: %v\n", err)
		os.Exit(1)
	}
	if *traps != "" {
		if err := writeTraps(*traps, *docs, facts); err != nil {
			fmt.Fprintf(os.Stderr, "catalog-import: %v\n", err)
			os.Exit(1)
		}
	}
	printSummary(facts)
}
