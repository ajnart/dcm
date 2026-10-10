// Command appgen generates the no-account Apps from the legacy catalog facts.
// It is a development tool and is not shipped with the binary.
package main

import (
	"encoding/json"
	"flag"
	"fmt"
	"go/format"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
)

const module = "github.com/ajnart/self-host"

// socketProxyException is the one service allowed to mount the Docker socket:
// Beszel's read-only socket proxy. Every other service is rejected. It repeats
// beszel.SocketProxyService, which main_test.go cross-checks.
const socketProxyException = "beszel-socket-proxy"

const dockerSocket = "/var/run/docker.sock"

const portPlaceholder = "__PORT__"

var scalarNeedsQuote = regexp.MustCompile(`^(?i:true|false|yes|no|on|off|null|~)$|^[-+]?(\d+(\.\d*)?|\.\d+)([eE][-+]?\d+)?$`)

type fact struct {
	ID                   string   `json:"id"`
	Name                 string   `json:"name"`
	Categories           []string `json:"categories"`
	DefaultPublishedPort int      `json:"default_published_port"`
	ContainerPort        int      `json:"container_port"`
	DocsURL              string   `json:"docs_url"`
	Image                string   `json:"image"`
	Onboarding           struct {
		Kind string `json:"kind"`
	} `json:"onboarding"`
	Environment []struct {
		Name  string `json:"name"`
		Kind  string `json:"kind"`
		Value string `json:"value"`
	} `json:"environment"`
	Mounts []struct {
		Name   string `json:"name"`
		Target string `json:"target"`
		Kind   string `json:"kind"`
	} `json:"mounts"`
}

type recipe struct {
	Services []struct {
		ID          string `json:"id"`
		Environment []struct {
			Name  string `json:"name"`
			Value string `json:"value"`
		} `json:"environment"`
		HostEnvironment []struct {
			Name   string `json:"name"`
			Source string `json:"source"`
		} `json:"hostEnvironment"`
		FileEnvironment []json.RawMessage `json:"fileEnvironment"`
		Mounts          []struct {
			Name   string `json:"name"`
			Target string `json:"target"`
			Kind   string `json:"kind"`
		} `json:"mounts"`
		Command           []string `json:"command"`
		Init              bool     `json:"init"`
		PublishTargetPort int      `json:"publishTargetPort"`
		User              string   `json:"user"`
		ReadOnly          bool     `json:"readOnly"`
		Restart           string   `json:"restart"`
		ImageTag          string   `json:"imageTag"`
	} `json:"services"`
}

type manifest struct {
	Image struct {
		Reference string `json:"reference"`
	} `json:"image"`
}

type override struct {
	Description string `json:"description"`
	Probe       string `json:"probe"`
	User        string `json:"user"`
}

type env struct {
	key   string
	value string
}

type mount struct {
	name     string
	target   string
	readOnly bool
}

type generated struct {
	id       string
	pkg      string
	file     string
	contents string
}

func main() {
	factsPath := flag.String("facts", "tools/catalog-import/facts.json", "path to facts.json")
	catalogPath := flag.String("catalog", "", "path to the legacy catalog references (removed in #192; check one out from git history)")
	overridesPath := flag.String("overrides", "tools/appgen/overrides.json", "path to overrides.json")
	appsDir := flag.String("apps", "internal/apps", "directory for generated App packages")
	catalogFile := flag.String("catalog-file", "internal/catalog/generated.go", "path for the generated catalog registration")
	flag.Parse()
	if *catalogPath == "" {
		fmt.Fprintln(os.Stderr, "appgen: -catalog is required; the legacy catalog was removed in #192 (git show e979269a:.agents/skills/self-host/workflows/selfhost/references/catalog)")
		os.Exit(2)
	}

	facts := readFacts(*factsPath)
	overrides := readOverrides(*overridesPath)

	var apps []generated
	var skipped []string
	for _, f := range facts {
		if f.Onboarding.Kind != "no-account" {
			continue
		}
		id := f.ID
		rec, err := readRecipe(filepath.Join(*catalogPath, "apps", id, "recipe.json"))
		if err != nil {
			skipped = append(skipped, fmt.Sprintf("%s: %v", id, err))
			continue
		}
		man, err := readManifest(filepath.Join(*catalogPath, "apps", id, "manifest.json"))
		if err != nil {
			skipped = append(skipped, fmt.Sprintf("%s: %v", id, err))
			continue
		}
		if reason := fileReason(rec); reason != "" {
			skipped = append(skipped, id+": "+reason)
			continue
		}
		if reason := mountReason(rec); reason != "" {
			skipped = append(skipped, id+": "+reason)
			continue
		}
		ov, ok := overrides[id]
		if !ok || ov.Probe == "" {
			skipped = append(skipped, id+": answers no HTTP path")
			continue
		}
		pkg := strings.ReplaceAll(id, "-", "")
		g := build(f, rec, man, ov, pkg)
		g.file = filepath.Join(*appsDir, pkg, pkg+".go")
		apps = append(apps, g)
	}

	sort.Slice(apps, func(i, j int) bool { return apps[i].id < apps[j].id })
	for _, g := range apps {
		if err := os.MkdirAll(filepath.Dir(g.file), 0o755); err != nil {
			fatal(err)
		}
		if err := os.WriteFile(g.file, []byte(g.contents), 0o644); err != nil {
			fatal(err)
		}
	}
	if err := os.WriteFile(*catalogFile, []byte(catalogSource(apps)), 0o644); err != nil {
		fatal(err)
	}

	for _, g := range apps {
		fmt.Printf("generated %-18s %s\n", g.id, g.file)
	}
	sort.Strings(skipped)
	for _, s := range skipped {
		fmt.Printf("skipped   %s\n", s)
	}
}

func build(f fact, rec recipe, man manifest, ov override, pkg string) generated {
	svc := rec.Services[0]
	if ov.User != "" {
		svc.User = ov.User
	}
	restart := svc.Restart
	if restart == "" {
		restart = "unless-stopped"
	}
	image := man.Image.Reference
	if image == "" {
		image = f.Image
	}

	envs, secretNames := buildEnv(f)
	mounts := buildMounts(rec)

	var b strings.Builder
	fmt.Fprintf(&b, "services:\n  %s:\n", f.ID)
	fmt.Fprintf(&b, "    image: %s\n", image)
	if len(svc.Command) > 0 {
		quoted := make([]string, len(svc.Command))
		for i, arg := range svc.Command {
			quoted[i] = strconv.Quote(arg)
		}
		fmt.Fprintf(&b, "    command: [%s]\n", strings.Join(quoted, ", "))
	}
	fmt.Fprintf(&b, "    restart: %s\n", restart)
	if svc.Init {
		b.WriteString("    init: true\n")
	}
	if svc.ReadOnly {
		b.WriteString("    read_only: true\n")
	}
	// The legacy "image-default" user is the image's own user, so no user
	// line is emitted; only a concrete recipe user would add one.
	if svc.User != "" && svc.User != "image-default" {
		fmt.Fprintf(&b, "    user: %s\n", svc.User)
	}
	if len(envs) > 0 {
		b.WriteString("    environment:\n")
		for _, e := range envs {
			fmt.Fprintf(&b, "      %s: %s\n", e.key, yamlScalar(e.value))
		}
	}
	if len(mounts) > 0 {
		b.WriteString("    volumes:\n")
		for _, m := range mounts {
			ro := ""
			if m.readOnly {
				ro = ":ro"
			}
			fmt.Fprintf(&b, "      - ./%s:%s%s\n", m.name, m.target, ro)
		}
	}
	fmt.Fprintf(&b, "    ports:\n      - ${BIND_IP}:%s:%d\n", portPlaceholder, f.ContainerPort)

	var src strings.Builder
	src.WriteString("// Code generated by tools/appgen; DO NOT EDIT.\n\n")
	fmt.Fprintf(&src, "package %s\n\n", pkg)
	src.WriteString("import (\n\t\"context\"\n\t\"strconv\"\n\n")
	fmt.Fprintf(&src, "\t%q\n", module+"/internal/app")
	fmt.Fprintf(&src, "\t%q\n", module+"/internal/helpers")
	fmt.Fprintf(&src, "\t%q\n", module+"/internal/onboard")
	src.WriteString(")\n\n")
	fmt.Fprintf(&src, "// App is %s. Traps: docs/catalog/traps/%s.md.\n", f.Name, f.ID)
	src.WriteString("type App struct{}\n\n")
	src.WriteString("func (App) Info() app.Info {\n\treturn app.Info{\n")
	fmt.Fprintf(&src, "\t\tID: %s, Name: %s, Category: %s,\n", strconv.Quote(f.ID), strconv.Quote(f.Name), strconv.Quote(category(f)))
	fmt.Fprintf(&src, "\t\tDescription:   %s,\n", strconv.Quote(ov.Description))
	fmt.Fprintf(&src, "\t\tImage:         %s,\n", strconv.Quote(image))
	fmt.Fprintf(&src, "\t\tDocs:          %s,\n", strconv.Quote(f.DocsURL))
	fmt.Fprintf(&src, "\t\tPort:          %d,\n", f.DefaultPublishedPort)
	fmt.Fprintf(&src, "\t\tContainerPort: %d,\n", f.ContainerPort)
	fmt.Fprintf(&src, "\t\tService:       %s,\n", strconv.Quote(f.ID))
	src.WriteString("\t}\n}\n\n")
	src.WriteString("func (App) Inputs() []app.Input { return nil }\n\n")

	parts := strings.Split(b.String(), portPlaceholder)
	if len(parts) != 2 {
		fatal(fmt.Errorf("%s: compose template has %d port placeholders", f.ID, len(parts)))
	}
	src.WriteString("func (App) Compose(rc app.RenderContext) string {\n")
	src.WriteString("\tport := strconv.Itoa(rc.Port)\n")
	fmt.Fprintf(&src, "\treturn `%s` + port + `%s`\n", parts[0], parts[1])
	src.WriteString("}\n\n")

	if len(secretNames) > 0 {
		src.WriteString("func (App) Secrets() []app.SecretSpec {\n\treturn []app.SecretSpec{\n")
		for _, name := range secretNames {
			fmt.Fprintf(&src, "\t\t{Name: %s, Length: 32},\n", strconv.Quote(name))
		}
		src.WriteString("\t}\n}\n\n")
	}

	probe := strconv.Quote(ov.Probe)
	src.WriteString("func (App) Setup(ctx context.Context, h *helpers.H) error {\n")
	fmt.Fprintf(&src, "\treturn onboard.NoAccount{Probe: onboard.Probe{Path: %s}}.Setup(ctx, h)\n}\n\n", probe)
	src.WriteString("func (App) Check(ctx context.Context, h *helpers.H) error {\n")
	fmt.Fprintf(&src, "\treturn onboard.NoAccount{Probe: onboard.Probe{Path: %s}}.Check(ctx, h)\n}\n\n", probe)
	src.WriteString("func (App) Links() []app.Link { return nil }\n")

	formatted, err := format.Source([]byte(src.String()))
	if err != nil {
		fatal(fmt.Errorf("%s: %w", f.ID, err))
	}
	return generated{id: f.ID, pkg: pkg, contents: string(formatted)}
}

func buildEnv(f fact) ([]env, []string) {
	var envs []env
	var secrets []string
	for _, e := range f.Environment {
		switch e.Kind {
		case "host":
			envs = append(envs, env{key: e.Name, value: "${" + hostRef(e.Name) + "}"})
		case "secret":
			ref, name := secretRefs(f.ID, e.Name)
			envs = append(envs, env{key: e.Name, value: "${" + ref + "}"})
			secrets = append(secrets, name)
		default:
			envs = append(envs, env{key: e.Name, value: e.Value})
		}
	}
	return envs, secrets
}

func buildMounts(rec recipe) []mount {
	var mounts []mount
	for _, m := range rec.Services[0].Mounts {
		if m.Kind != "volume" && m.Kind != "bind" {
			continue
		}
		mounts = append(mounts, mount{name: m.Name, target: m.Target})
	}
	return mounts
}

func fileReason(rec recipe) string {
	svc := rec.Services[0]
	if len(svc.FileEnvironment) > 0 {
		return "needs a generated private file (environment)"
	}
	for _, m := range svc.Mounts {
		if m.Kind == "generated-file" {
			return "needs a generated private file (" + m.Name + ")"
		}
	}
	return ""
}

func mountReason(rec recipe) string {
	for _, svc := range rec.Services {
		for _, m := range svc.Mounts {
			if m.Kind != "bind" {
				continue
			}
			target := m.Target
			if svc.ID == socketProxyException && target == dockerSocket {
				continue
			}
			if strings.Contains(target, "docker.sock") || target == "/proc" || strings.HasPrefix(target, "/proc/") ||
				target == "/sys" || strings.HasPrefix(target, "/sys/") || target == "/var/run" || strings.HasPrefix(target, "/var/run/") {
				return "needs a host path outside the App folder (" + target + ")"
			}
		}
	}
	return ""
}

func hostRef(name string) string {
	switch name {
	case "USERMAP_UID":
		return "PUID"
	case "USERMAP_GID":
		return "PGID"
	default:
		return name
	}
}

func secretRefs(id, name string) (string, string) {
	prefix := strings.ToUpper(strings.ReplaceAll(id, "-", "_")) + "_"
	upper := strings.ToUpper(name)
	if strings.HasPrefix(upper, prefix) {
		return upper, strings.ToLower(strings.TrimPrefix(upper, prefix))
	}
	return prefix + upper, strings.ToLower(name)
}

func yamlScalar(value string) string {
	if scalarNeedsQuote.MatchString(value) {
		return strconv.Quote(value)
	}
	return value
}

// category matches the parity test's label: "remote-access" → "Remote
// access", "local-ai" → "Local AI".
func category(f fact) string {
	if len(f.Categories) == 0 {
		return ""
	}
	words := strings.Split(f.Categories[0], "-")
	for i, w := range words {
		switch {
		case w == "ai" || w == "dns":
			words[i] = strings.ToUpper(w)
		case i == 0 && w != "":
			words[i] = strings.ToUpper(w[:1]) + w[1:]
		}
	}
	return strings.Join(words, " ")
}

func catalogSource(apps []generated) string {
	var src strings.Builder
	src.WriteString("// Code generated by tools/appgen; DO NOT EDIT.\n\n")
	src.WriteString("package catalog\n\n")
	src.WriteString("import (\n")
	fmt.Fprintf(&src, "\t%q\n", module+"/internal/app")
	for _, g := range apps {
		fmt.Fprintf(&src, "\t%q\n", module+"/internal/apps/"+g.pkg)
	}
	src.WriteString(")\n\n")
	src.WriteString("func generatedApps() []app.App {\n\treturn []app.App{\n")
	for _, g := range apps {
		fmt.Fprintf(&src, "\t\t%s.App{},\n", g.pkg)
	}
	src.WriteString("\t}\n}\n")
	formatted, err := format.Source([]byte(src.String()))
	if err != nil {
		fatal(err)
	}
	return string(formatted)
}

func readFacts(path string) []fact {
	var facts []fact
	readJSON(path, &facts)
	return facts
}

func readOverrides(path string) map[string]override {
	overrides := map[string]override{}
	readJSON(path, &overrides)
	return overrides
}

func readRecipe(path string) (recipe, error) {
	var rec recipe
	if err := readJSONErr(path, &rec); err != nil {
		return rec, err
	}
	if len(rec.Services) == 0 {
		return rec, fmt.Errorf("recipe has no services")
	}
	return rec, nil
}

func readManifest(path string) (manifest, error) {
	var man manifest
	err := readJSONErr(path, &man)
	return man, err
}

func readJSON(path string, v any) {
	if err := readJSONErr(path, v); err != nil {
		fatal(err)
	}
}

func readJSONErr(path string, v any) error {
	data, err := os.ReadFile(path)
	if err != nil {
		return err
	}
	return json.Unmarshal(data, v)
}

func fatal(err error) {
	fmt.Fprintln(os.Stderr, "appgen:", err)
	os.Exit(1)
}
