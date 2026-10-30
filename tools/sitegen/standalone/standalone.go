// Package standalone projects an App into plain Docker Compose: the Compose
// fragment self-host would render, minus everything only self-host provides
// (host settings, secret files, generated config), with the variables it reads,
// whether it runs without self-host and the steps it leaves to the person.
//
// Project is the whole interface. Every mismatch between an App and what plain
// Compose can express is an error, so an App never reaches the export half
// converted.
package standalone

import (
	"fmt"
	"regexp"
	"slices"
	"strings"

	"github.com/ajnart/self-host/internal/app"
	"github.com/ajnart/self-host/internal/catalog"
	"github.com/ajnart/self-host/internal/service"
)

// Env is one variable the exported Compose reads.
type Env struct {
	Key         string `json:"key"`
	Default     string `json:"default"`
	Description string `json:"description"`
	Secret      bool   `json:"secret"`
}

// Link is a wiring self-host applies after both Apps run.
type Link struct {
	Target string `json:"target"`
	Title  string `json:"title"`
}

// Entry is an App projected into standalone Compose.
type Entry struct {
	Compose string
	Env     []Env
	// Links are the wirings plain Compose leaves out, for Apps offered to new installs.
	Links []Link
	// Standalone is false when the Compose mounts files only self-host generates.
	Standalone bool
	// Notes is what plain Compose leaves to the person, in order: files, required
	// inputs, converted secrets, the App's own guide, links.
	Notes string
}

// Project converts one App. The conversion is deterministic: the same App gives
// the same Entry, byte for byte.
func Project(ap app.App) (Entry, error) {
	info := ap.Info()
	rc := renderContext(ap)
	c := &converter{id: info.ID, files: declaredFiles(ap, rc)}
	compose, err := c.convert(ap.Compose(rc))
	if err != nil {
		return Entry{}, err
	}
	vars, err := variablesFor(info.ID, compose, c.facts, envMeta(ap))
	if err != nil {
		return Entry{}, err
	}
	links := []Link{}
	for _, link := range ap.Links() {
		if catalog.Unavailable(link.Target) == "" {
			links = append(links, Link{Target: link.Target, Title: link.Title})
		}
	}
	notes, err := notesFor(ap, c, vars, links)
	if err != nil {
		return Entry{}, err
	}
	env := make([]Env, len(vars))
	for i, v := range vars {
		env[i] = v.Env
	}
	return Entry{Compose: compose, Env: env, Links: links, Standalone: len(c.missing) == 0, Notes: notes}, nil
}

func renderContext(ap app.App) app.RenderContext {
	rc := app.RenderContext{Port: ap.Info().Port, Inputs: renderInputs(ap), Settings: map[string]string{}}
	if _, ok := ap.(app.DockerSocketMounter); ok {
		rc.DockerSocket = "/var/run/docker.sock"
	}
	return rc
}

// variable is a Compose variable with what the projection knows beyond what the export shows.
type variable struct {
	Env
	// required marks a required Input with no default, which the person must fill in.
	required bool
	prompt   string
}

// globals are the variables Docker Compose Maker's own .env already provides, plus the
// ones every App's login needs.
var globals = map[string]Env{
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

// extraEnv describes variables an App's Compose reads that self-host fills in after the
// App runs (its Setup), so no declared secret or input carries them.
var extraEnv = map[string]Env{
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

func envMeta(ap app.App) map[string]variable {
	info := ap.Info()
	meta := map[string]variable{}
	for key, value := range globals {
		value.Key = key
		meta[key] = variable{Env: value}
	}
	if declarer, ok := ap.(app.SecretDeclarer); ok {
		for _, spec := range declarer.Secrets() {
			key := service.SecretKey(info.ID, spec.Name)
			meta[key] = variable{Env: Env{Key: key, Secret: true,
				Description: fmt.Sprintf("%s secret: %s. Generate one with: openssl rand -hex %d", info.Name, strings.ReplaceAll(spec.Name, "_", " "), (spec.Length+1)/2)}}
		}
	}
	for _, in := range ap.Inputs() {
		switch {
		case in.RecoveryOnly:
		case in.Private:
			key := service.SecretKey(info.ID, in.Key)
			meta[key] = variable{Env: Env{Key: key, Secret: true, Description: describeInput(in)}}
		case in.Required && in.Default == "":
			key := inputVar(info.ID, in.Key)
			meta[key] = variable{Env: Env{Key: key, Default: in.Default, Description: describeInput(in)}, required: true, prompt: strings.TrimSpace(in.Prompt)}
		}
	}
	for key, value := range extraEnv {
		if _, found := meta[key]; !found {
			value.Key = key
			meta[key] = variable{Env: value}
		}
	}
	return meta
}

// variablesFor lists the variables the converted Compose reads, sorted by key.
func variablesFor(id, compose string, facts facts, meta map[string]variable) ([]variable, error) {
	seen := map[string]bool{}
	var vars []variable
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
		if entry.Default == "" && !entry.Secret && facts.bound[key] {
			// An empty source would not validate. Docker creates a folder at a path that is
			// missing, so the notes tell the person to replace this placeholder.
			entry.Default = "./" + strings.ToLower(strings.ReplaceAll(key, "_", "-"))
		}
		vars = append(vars, entry)
	}
	slices.SortFunc(vars, func(a, b variable) int { return strings.Compare(a.Key, b.Key) })
	return vars, nil
}
