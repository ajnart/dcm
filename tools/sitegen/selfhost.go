package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"slices"
	"strings"

	"github.com/ajnart/self-host/internal/app"
	"github.com/ajnart/self-host/internal/catalog"
	"github.com/ajnart/self-host/internal/service"
)

type linkJSON struct {
	Target string `json:"target"`
	Title  string `json:"title"`
}

type envJSON struct {
	Key         string `json:"key"`
	Default     string `json:"default"`
	Description string `json:"description"`
	Secret      bool   `json:"secret"`
	// required and prompt mark a required Input with no default, which the user must fill in.
	required bool
	prompt   string
}

type selfHostRecipe struct {
	ID          string   `json:"id"`
	Name        string   `json:"name"`
	Description string   `json:"description"`
	Apps        []string `json:"apps"`
}

type selfHostApp struct {
	ID          string     `json:"id"`
	Name        string     `json:"name"`
	Description string     `json:"description"`
	Category    string     `json:"category"`
	Icon        string     `json:"icon"`
	Image       string     `json:"image"`
	Port        int        `json:"port"`
	Docs        string     `json:"docs"`
	Links       []linkJSON `json:"links"`
	Compose     string     `json:"compose"`
	Env         []envJSON  `json:"env"`
	// Standalone is false when the compose mounts files only self-host generates.
	Standalone bool   `json:"standalone"`
	Notes      string `json:"notes,omitempty"`
}

// globals are the variables Docker Compose Maker's own .env already provides, plus the
// ones every App's login needs.
var globals = map[string]envJSON{
	"TZ":               {Default: "Etc/UTC", Description: "Time zone, for example Europe/Paris"},
	"PUID":             {Default: "1000", Description: "User ID the container runs as (run `id -u`)"},
	"PGID":             {Default: "1000", Description: "Group ID the container runs as (run `id -g`)"},
	"UMASK":            {Default: "022", Description: "Permission mask for files the App creates"},
	"CONFIG_PATH":      {Default: "/opt/appdata/config", Description: "Host folder that holds every App's configuration"},
	"DATA_PATH":        {Default: "/opt/appdata/data", Description: "Host folder that holds every App's data, media and downloads"},
	"CONTAINER_PREFIX": {Default: "", Description: "Prefix put in front of every container name"},
	"RESTART_POLICY":   {Default: "unless-stopped", Description: "Docker restart policy"},
	"LAN_IP": {Default: "localhost", Description: "Address you open this App at: this machine's IP on your network (for example 192.168.1.20) or a host name. " +
		"The App uses it to build links it hands out, so the default only works on this machine"},
	"ADMIN_USER": {Default: "admin", Description: "Username of the administrator account the App creates on its first start"},
	"ADMIN_PASSWORD": {Secret: true, Description: "Password of the administrator account the App creates on its first start. " +
		"Choose a strong one or generate it with: openssl rand -hex 16"},
}

// extraEnv describes variables an App's compose reads that self-host fills in after the
// App runs (its Setup), so no declared secret or input carries them.
var extraEnv = map[string]envJSON{
	"BESZEL_AGENT_KEY":             {Description: "Public key the Beszel hub shows when you add a system. Leave empty until you have added the system"},
	"BESZEL_AGENT_TOKEN":           {Secret: true, Description: "Agent token the Beszel hub shows when you add a system. Leave empty until you have added the system"},
	"STALWART_MAIL_RECOVERY_ADMIN": {Secret: true, Description: "Optional recovery administrator as username:password, used only while bootstrapping. Leave empty to skip it"},
}

var varRef = regexp.MustCompile(`\$\$|\$\{([A-Za-z_][A-Za-z0-9_]*)|\$([A-Za-z_][A-Za-z0-9_]*)`)

func placeholder(name string) string { return "${" + name + "}" }

func inputVar(id, key string) string {
	if key == strings.ToUpper(key) {
		return strings.ReplaceAll(key, "-", "_")
	}
	return service.SecretKey(id, key)
}

func describeInput(in app.Input) string {
	text := strings.TrimSpace(in.Prompt)
	if help := strings.TrimSpace(in.Help); help != "" {
		text += ". " + help
	}
	return text
}

func renderInputs(ap app.App) map[string]string {
	id := ap.Info().ID
	inputs := map[string]string{}
	for _, in := range ap.Inputs() {
		switch {
		case in.RecoveryOnly:
		case in.Private:
			inputs[in.Key] = placeholder(service.SecretKey(id, in.Key))
		case in.Required && in.Default == "":
			inputs[in.Key] = placeholder(inputVar(id, in.Key))
		default:
			inputs[in.Key] = in.Default
		}
	}
	return inputs
}

func envMeta(ap app.App) map[string]envJSON {
	info := ap.Info()
	meta := map[string]envJSON{}
	for key, value := range globals {
		value.Key = key
		meta[key] = value
	}
	if declarer, ok := ap.(app.SecretDeclarer); ok {
		for _, spec := range declarer.Secrets() {
			key := service.SecretKey(info.ID, spec.Name)
			meta[key] = envJSON{Key: key, Secret: true,
				Description: fmt.Sprintf("%s secret: %s. Generate one with: openssl rand -hex %d", info.Name, strings.ReplaceAll(spec.Name, "_", " "), (spec.Length+1)/2)}
		}
	}
	for _, in := range ap.Inputs() {
		switch {
		case in.RecoveryOnly:
		case in.Private:
			key := service.SecretKey(info.ID, in.Key)
			meta[key] = envJSON{Key: key, Secret: true, Description: describeInput(in)}
		case in.Required && in.Default == "":
			key := inputVar(info.ID, in.Key)
			meta[key] = envJSON{Key: key, Default: in.Default, Description: describeInput(in), required: true, prompt: strings.TrimSpace(in.Prompt)}
		}
	}
	for key, value := range extraEnv {
		if _, found := meta[key]; !found {
			value.Key = key
			meta[key] = value
		}
	}
	return meta
}

// boundVar reports whether the compose bind-mounts the variable's value as a host path.
func boundVar(compose, key string) bool { return strings.Contains(compose, "- ${"+key+"}:") }

func envFor(id, compose string, meta map[string]envJSON) ([]envJSON, error) {
	seen := map[string]bool{}
	var env []envJSON
	for _, match := range varRef.FindAllStringSubmatch(compose, -1) {
		key := match[1] + match[2]
		if key == "" || seen[key] {
			continue
		}
		seen[key] = true
		entry, found := meta[key]
		if !found {
			return nil, fmt.Errorf("%s: ${%s} has no description; declare it or add it to extraEnv", id, key)
		}
		if entry.Default == "" && !entry.Secret && boundVar(compose, key) {
			// An empty source would not validate. Docker creates a folder at a path that is
			// missing, so the notes tell the user to replace this placeholder.
			entry.Default = "./" + strings.ToLower(strings.ReplaceAll(key, "_", "-"))
		}
		env = append(env, entry)
	}
	slices.SortFunc(env, func(a, b envJSON) int { return strings.Compare(a.Key, b.Key) })
	return env, nil
}

func selfHostEntry(ap app.App) (selfHostApp, error) {
	info := ap.Info()
	rc := app.RenderContext{Port: info.Port, Inputs: renderInputs(ap), Settings: map[string]string{}}
	if _, ok := ap.(app.DockerSocketMounter); ok {
		rc.DockerSocket = "/var/run/docker.sock"
	}
	c := &converter{id: info.ID, files: declaredFiles(ap, rc)}
	compose, err := c.convert(ap.Compose(rc))
	if err != nil {
		return selfHostApp{}, err
	}
	env, err := envFor(info.ID, compose, envMeta(ap))
	if err != nil {
		return selfHostApp{}, err
	}
	links := []linkJSON{}
	for _, link := range availableLinks(ap) {
		links = append(links, linkJSON{Target: link.Target, Title: link.Title})
	}
	notes, err := notesFor(ap, c, compose, env, links)
	if err != nil {
		return selfHostApp{}, err
	}
	iconPath, err := icon(info.ID)
	if err != nil {
		return selfHostApp{}, err
	}
	return selfHostApp{ID: info.ID, Name: info.Name, Description: info.Description, Category: info.Category, Icon: iconPath,
		Image: info.Image, Port: info.Port, Docs: info.Docs, Links: links, Compose: compose, Env: env,
		Standalone: len(c.missing) == 0, Notes: notes}, nil
}

func writeSelfHost() error {
	cat := catalog.Default()
	if err := checkExtraNotes(cat); err != nil {
		return err
	}
	apps := []selfHostApp{}
	for _, ap := range cat.Apps() {
		entry, err := selfHostEntry(ap)
		if err != nil {
			return err
		}
		apps = append(apps, entry)
	}
	recipes := []selfHostRecipe{}
	for _, r := range cat.Recipes() {
		recipes = append(recipes, selfHostRecipe{ID: r.ID, Name: r.Name, Description: r.Description, Apps: offeredApps(r)})
	}
	var buf bytes.Buffer
	enc := json.NewEncoder(&buf)
	enc.SetEscapeHTML(false)
	enc.SetIndent("", " ")
	if err := enc.Encode(struct {
		Apps    []selfHostApp    `json:"apps"`
		Recipes []selfHostRecipe `json:"recipes"`
	}{apps, recipes}); err != nil {
		return err
	}
	dir := filepath.Join("dcm", "src", "data")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return err
	}
	file := filepath.Join(dir, "selfhost.json")
	if err := os.WriteFile(file, buf.Bytes(), 0o644); err != nil {
		return err
	}
	fmt.Println(file)
	return nil
}
