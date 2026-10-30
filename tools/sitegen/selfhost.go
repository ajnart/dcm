package main

import (
	"bytes"
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"os"
	"path"
	"path/filepath"
	"regexp"
	"slices"
	"strings"

	"go.yaml.in/yaml/v3"

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
	// Global marks a variable Docker Compose Maker already provides in its own .env.
	Global bool `json:"global,omitempty"`
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

var globals = map[string]envJSON{
	"TZ":               {Default: "Etc/UTC", Description: "Time zone, for example Europe/Paris", Global: true},
	"PUID":             {Default: "1000", Description: "User ID the container runs as (run `id -u`)", Global: true},
	"PGID":             {Default: "1000", Description: "Group ID the container runs as (run `id -g`)", Global: true},
	"UMASK":            {Default: "022", Description: "Permission mask for files the App creates", Global: true},
	"CONFIG_PATH":      {Default: "/opt/appdata/config", Description: "Host folder that holds every App's configuration", Global: true},
	"DATA_PATH":        {Default: "/opt/appdata/data", Description: "Host folder that holds every App's data, media and downloads", Global: true},
	"CONTAINER_PREFIX": {Default: "", Description: "Prefix put in front of every container name", Global: true},
	"RESTART_POLICY":   {Default: "unless-stopped", Description: "Docker restart policy", Global: true},
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

const (
	firstVisitAdmin    = "After the first start, create the administrator on the first visit."
	firstVisitOwner    = "After the first start, create the first owner on the first visit."
	arrAuthentication  = "After the first start, turn on authentication in Settings > General (Forms, with a username and password)"
	inertComposeSuffix = "self-host only prepares its credentials and folders."
)

// extraNotes is what plain Compose leaves to the user because self-host does it after the
// App starts (its Setup) or before it (its Files). Each one comes from the App's package.
var extraNotes = map[string]string{
	"actual-budget":  "After the first start, open the web page and set the server password.",
	"adguard-home":   "After the first start, finish the install wizard in the browser: create the administrator and keep the admin port at 3000.",
	"audiobookshelf": "After the first start, create the root account on the first visit.",
	"bazarr":         "After the first start, turn on authentication in Settings > General > Authentication (Basic, with a username and password).",
	"beszel": "After the first start, create the administrator on the hub's first visit. self-host starts the agent only after its Setup has read the hub's key and token. " +
		"With plain Compose, start the hub, add a system in its web page, set BESZEL_AGENT_KEY and BESZEL_AGENT_TOKEN, then run docker compose up -d again.",
	"bookstack":   "BookStack starts with a seeded administrator account (admin@admin.com, password \"password\"); sign in and replace it.",
	"cleanuparr":  "After the first start, create the account on the first visit.",
	"deluge":      "The Web UI starts with the password \"deluge\"; change it on the first sign-in.",
	"dockge":      "After the first start, create the first administrator account on the first visit.",
	"docmost":     "After the first start, create the first workspace owner on the first visit.",
	"emby":        "After the first start, finish the first-run wizard and create the administrator.",
	"firefly-iii": "After the first start, register the first owner at /register.",
	"forgejo": "Installation and registration are locked, and self-host creates the first administrator after the first start. With plain Compose run: " +
		"docker exec -u git <container name> forgejo admin user create --admin --username admin --email admin@example.com --password <password>.",
	"freshrss":            "After the first start, finish the install page and create the administrator.",
	"frigate":             "Frigate generates the first administrator (admin) and prints its password once in the container logs; sign in with it and change it.",
	"home-assistant":      "After the first start, finish the onboarding page and create the owner.",
	"homarr":              "After the first start, finish the onboarding wizard and create the administrator.",
	"homebridge":          "After the first start, complete the setup wizard and create the administrator.",
	"immich":              firstVisitAdmin,
	"jellyfin":            "After the first start, finish the startup wizard: create the administrator and add your media library.",
	"lidarr":              arrAuthentication + ".",
	"linkwarden":          "After the first start, sign up the first account on the first visit.",
	"navidrome":           "After the first start, create the first administrator on the sign-in page.",
	"netbird":             firstVisitAdmin,
	"nginx-proxy-manager": firstVisitAdmin,
	"ntfy": "Access is deny-all and login is on, so create the administrator inside the container: " +
		"docker exec -it <container name> ntfy user add --role=admin <username>.",
	"pangolin":      "After the first start, create the first administrator on the setup page with the PANGOLIN_SETUP_TOKEN value.",
	"patchmon":      firstVisitAdmin,
	"plex":          "Create a claim token at https://www.plex.tv/claim (valid 4 minutes) and set PLEX_CLAIM_TOKEN before the first start, or the server stays unclaimed.",
	"prowlarr":      arrAuthentication + ".",
	"qbittorrent":   "The WebUI starts with a temporary administrator password printed in the container logs; sign in with it, set your own and set the default save path to the downloads folder.",
	"radarr":        arrAuthentication + " and add the root folder /media/movies.",
	"renovate":      "The container only runs renovate --version; replace the command with your own run. " + inertComposeSuffix,
	"restic":        "The container only runs restic version; run your backups against the repository yourself. " + inertComposeSuffix,
	"sabnzbd":       "After the first start, set the WebUI username and password in Config > General.",
	"scrypted":      "After the first start, create the first administrator on the login page.",
	"sonarr":        arrAuthentication + " and add the root folder /media/tv.",
	"stalwart-mail": "After the first start, finish the first-run setup in the admin UI to create the administrator.",
	"syncthing":     "After the first start, set the GUI administrator login in Actions > Settings > GUI.",
	"tdarr":         "After the first start, register the first administrator on the first-run page.",
	"tracearr":      firstVisitOwner,
	"umami":         "Umami starts with the seeded administrator admin and password \"umami\"; sign in and change the password right away.",
	"uptime-kuma":   firstVisitAdmin,
	"vaultwarden":   "Signups are closed. Open /admin with the VAULTWARDEN_ADMIN_TOKEN value and invite yourself to get an account.",
	"wud":           "WUD watches a remote Docker endpoint over TLS: set WUD_DOCKER_HOST and put its CA certificate at ${CONFIG_PATH}/wud/tls/ca.pem.",
}

const maxListedLinks = 3

// sharedFolders maps a per-App folder that self-host fills with the shared media library
// to the folder Docker Compose Maker keeps media in.
var sharedFolders = map[string]string{"media-library": "${DATA_PATH}/media"}

var (
	serviceLine = regexp.MustCompile(`^  ([A-Za-z0-9][A-Za-z0-9_.-]*):\s*$`)
	keyLine     = regexp.MustCompile(`^    ([A-Za-z0-9_.-]+):(?:\s+(.*))?$`)
	itemLine    = regexp.MustCompile(`^      - (.*)$`)
	envLine     = regexp.MustCompile(`^      ([A-Za-z_][A-Za-z0-9_]*): (.*)$`)
	varRef      = regexp.MustCompile(`\$\$|\$\{([A-Za-z_][A-Za-z0-9_]*)|\$([A-Za-z_][A-Za-z0-9_]*)`)
	soleVar     = regexp.MustCompile(`^\$\{([A-Za-z_][A-Za-z0-9_]*)\}$`)
)

func placeholder(name string) string { return "${" + name + "}" }

// inputVar names the variable standing in for a required input with no default.
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
			meta[key] = envJSON{Key: key, Default: in.Default, Description: describeInput(in)}
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

type fileSpec struct {
	path string
	// secret is the variable standing for the file's whole content, when it is exactly one.
	secret string
	empty  bool
}

func declaredFiles(ap app.App, rc app.RenderContext) []fileSpec {
	declarer, ok := ap.(app.FileDeclarer)
	if !ok {
		return nil
	}
	stand := newStandIns(ap)
	var specs []fileSpec
	for _, f := range declarer.Files(rc, stand.value) {
		content := strings.TrimSpace(f.Content)
		spec := fileSpec{path: path.Clean(f.Path), empty: content == "", secret: stand.variables[content]}
		if match := soleVar.FindStringSubmatch(content); match != nil {
			spec.secret = match[1]
		}
		specs = append(specs, spec)
	}
	return specs
}

const (
	standInAlphabet = "abcdefghijklmnopqrstuvwxyz0123456789"
	hexAlphabet     = "0123456789abcdef"
	adminUserLength = 12
	otherLength     = 24
)

// standIns hands an App's Files the same kind of value a real install would: valid for the
// secret's spec, but derived from the App and name so the output never changes. Files may
// decode or measure a secret, which a "${NAME}" placeholder would break.
type standIns struct {
	id    string
	specs map[string]app.SecretSpec
	// variables maps a value handed out to the variable it stands for.
	variables map[string]string
}

func newStandIns(ap app.App) *standIns {
	s := &standIns{id: ap.Info().ID, specs: map[string]app.SecretSpec{}, variables: map[string]string{}}
	if declarer, ok := ap.(app.SecretDeclarer); ok {
		for _, spec := range declarer.Secrets() {
			s.specs[spec.Name] = spec
		}
	}
	return s
}

func (s *standIns) value(name string) string {
	variable := service.SecretKey(s.id, name)
	length := otherLength
	hexDigits := false
	switch spec, declared := s.specs[name]; {
	case name == "ADMIN_USER":
		variable, length = name, adminUserLength
	case name == "ADMIN_PASSWORD":
		variable = name
	case declared && spec.Length > 0:
		length, hexDigits = spec.Length, spec.Hex
	}
	value := standInValue(s.id+"/"+variable, length, hexDigits)
	s.variables[value] = variable
	return value
}

func standInValue(seed string, length int, hexDigits bool) string {
	alphabet := standInAlphabet
	if hexDigits {
		alphabet = hexAlphabet
	}
	out := make([]byte, 0, length)
	for round := 0; len(out) < length; round++ {
		sum := sha256.Sum256(fmt.Appendf(nil, "%s/%d", seed, round))
		for _, b := range sum {
			if len(out) == length {
				break
			}
			out = append(out, alphabet[int(b)%len(alphabet)])
		}
	}
	return string(out)
}

type block struct {
	name  string
	lines []string
}

// converter turns one App's self-host Compose fragment into a Compose file a person can
// run without self-host, following Docker Compose Maker's conventions.
type converter struct {
	id    string
	files []fileSpec
	// refs maps a top-level Compose secret to the variable that feeds it.
	refs      map[string]string
	missing   []string
	converted []string
	dropped   []string
}

func (c *converter) split(raw string) ([]block, error) {
	c.refs = map[string]string{}
	var blocks []block
	var top, secret string
	for _, line := range strings.Split(strings.TrimRight(raw, "\n"), "\n") {
		switch {
		case strings.HasPrefix(line, "#"):
		case line != "" && !strings.HasPrefix(line, " "):
			switch strings.TrimSpace(line) {
			case "services:":
				top = "services"
			case "secrets:":
				top = "secrets"
			default:
				return nil, fmt.Errorf("%s: top-level key %q is not handled", c.id, line)
			}
		case top == "services":
			if match := serviceLine.FindStringSubmatch(line); match != nil {
				blocks = append(blocks, block{name: match[1]})
				continue
			}
			if len(blocks) == 0 {
				return nil, fmt.Errorf("%s: line %q is outside any service", c.id, line)
			}
			blocks[len(blocks)-1].lines = append(blocks[len(blocks)-1].lines, line)
		case top == "secrets":
			trimmed := strings.TrimSpace(line)
			switch {
			case trimmed == "":
			case strings.HasPrefix(line, "    "):
				value, found := strings.CutPrefix(trimmed, "environment:")
				if !found {
					return nil, fmt.Errorf("%s: secret %q has unsupported source %q", c.id, secret, trimmed)
				}
				c.refs[secret] = strings.TrimSpace(value)
			default:
				secret = strings.TrimSuffix(trimmed, ":")
			}
		}
	}
	return blocks, nil
}

// pureMounts finds the files a service reads from /run/secrets whose whole content is one
// variable, by the name the container sees them under.
func (c *converter) pureMounts(b block) map[string]string {
	mounts := map[string]string{}
	section := ""
	for _, line := range b.lines {
		if match := keyLine.FindStringSubmatch(line); match != nil {
			section = match[1]
			continue
		}
		match := itemLine.FindStringSubmatch(line)
		if section != "volumes" || match == nil {
			continue
		}
		src, rest, found := strings.Cut(match[1], ":")
		rel, relative := strings.CutPrefix(src, "./")
		dst, _, _ := strings.Cut(rest, ":")
		if !found || !relative || !strings.HasPrefix(dst, "/run/secrets/") {
			continue
		}
		for _, f := range c.files {
			if f.path == rel && f.secret != "" {
				mounts[path.Base(dst)] = f.secret
			}
		}
	}
	return mounts
}

func (c *converter) coverFiles(rel string) {
	for _, f := range c.files {
		if !f.empty && (f.path == rel || strings.HasPrefix(f.path, rel+"/")) && !slices.Contains(c.missing, f.path) {
			c.missing = append(c.missing, f.path)
		}
	}
}

func (c *converter) volume(line string, mounts map[string]string) (string, bool) {
	match := itemLine.FindStringSubmatch(line)
	if match == nil {
		return line, true
	}
	src, rest, found := strings.Cut(match[1], ":")
	rel, relative := strings.CutPrefix(src, "./")
	if !found || !relative {
		return line, true
	}
	dst, _, _ := strings.Cut(rest, ":")
	if _, pure := mounts[path.Base(dst)]; pure && strings.HasPrefix(dst, "/run/secrets/") {
		for _, f := range c.files {
			if f.path == rel && f.secret != "" {
				return "", false
			}
		}
	}
	if shared, isShared := sharedFolders[rel]; isShared {
		return "      - " + shared + ":" + rest, true
	}
	c.coverFiles(rel)
	return "      - ${CONFIG_PATH}/" + c.id + "/" + rel + ":" + rest, true
}

func (c *converter) environment(line string, mounts map[string]string) string {
	match := envLine.FindStringSubmatch(line)
	if match == nil {
		return line
	}
	key, value := match[1], strings.Trim(strings.TrimSpace(match[2]), `"'`)
	base, isFile := strings.CutSuffix(key, "_FILE")
	if !isFile {
		return line
	}
	name := strings.TrimPrefix(value, "/run/secrets/")
	variable, found := mounts[name]
	if !found {
		variable, found = c.refs[name]
	}
	if !found {
		return line
	}
	if !slices.Contains(c.converted, key) {
		c.converted = append(c.converted, key)
	}
	return "      " + base + ": " + placeholder(variable)
}

func (c *converter) command(line, value string, mounts map[string]string) (string, error) {
	if !strings.Contains(value, "/run/secrets/") {
		return line, nil
	}
	var args []string
	if !strings.HasPrefix(value, "[") || yaml.Unmarshal([]byte(value), &args) != nil {
		return "", fmt.Errorf("%s: command %q is not an inline list", c.id, value)
	}
	var kept []string
	for _, arg := range args {
		pure := false
		for name := range mounts {
			pure = pure || strings.Contains(arg, "/run/secrets/"+name)
		}
		if pure {
			c.dropped = append(c.dropped, arg)
			continue
		}
		kept = append(kept, arg)
	}
	var buf bytes.Buffer
	enc := json.NewEncoder(&buf)
	enc.SetEscapeHTML(false)
	parts := make([]string, len(kept))
	for i, arg := range kept {
		buf.Reset()
		if err := enc.Encode(arg); err != nil {
			return "", err
		}
		parts[i] = strings.TrimSpace(buf.String())
	}
	return "    command: [" + strings.Join(parts, ", ") + "]", nil
}

func (c *converter) rewrite(b block) ([]string, error) {
	mounts := c.pureMounts(b)
	out := []string{"  " + b.name + ":"}
	section := ""
	for _, line := range b.lines {
		if match := keyLine.FindStringSubmatch(line); match != nil {
			section = match[1]
			switch section {
			case "secrets":
				continue
			case "restart":
				if match[2] == "unless-stopped" || match[2] == "always" {
					line = "    restart: ${RESTART_POLICY}"
				}
			case "command":
				var err error
				if line, err = c.command(line, match[2], mounts); err != nil {
					return nil, err
				}
			}
			out = append(out, line)
			if section == "image" {
				out = append(out, "    container_name: ${CONTAINER_PREFIX}"+b.name)
			}
			continue
		}
		switch section {
		case "secrets":
			continue
		case "ports":
			line = strings.Replace(line, "${BIND_IP}:", "", 1)
		case "volumes":
			var keep bool
			if line, keep = c.volume(line, mounts); !keep {
				continue
			}
		case "environment":
			line = c.environment(line, mounts)
		}
		out = append(out, line)
	}
	for out[len(out)-1] == "" {
		out = out[:len(out)-1]
	}
	if !slices.Contains(out, "    container_name: ${CONTAINER_PREFIX}"+b.name) {
		return nil, fmt.Errorf("%s: service %s has no image", c.id, b.name)
	}
	return out, nil
}

func (c *converter) convert(raw string) (string, error) {
	blocks, err := c.split(raw)
	if err != nil {
		return "", err
	}
	lines := []string{"services:"}
	for i, b := range blocks {
		rewritten, err := c.rewrite(b)
		if err != nil {
			return "", err
		}
		if i > 0 {
			lines = append(lines, "")
		}
		lines = append(lines, rewritten...)
	}
	text := strings.Join(lines, "\n") + "\n"
	text = strings.ReplaceAll(text, "${MEDIA_ROOT}", "${DATA_PATH}/media")
	text = strings.ReplaceAll(text, "${DOWNLOADS_ROOT}", "${DATA_PATH}/downloads")
	return text, c.validate(text)
}

func (c *converter) validate(text string) error {
	var doc map[string]map[string]map[string]any
	if err := yaml.Unmarshal([]byte(text), &doc); err != nil {
		return fmt.Errorf("%s: converted Compose is not valid YAML: %w", c.id, err)
	}
	if len(doc) != 1 || len(doc["services"]) == 0 {
		return fmt.Errorf("%s: converted Compose must hold only a services map", c.id)
	}
	for name, svc := range doc["services"] {
		if svc["image"] == nil {
			return fmt.Errorf("%s: service %s has no image", c.id, name)
		}
	}
	for _, left := range []string{"${BIND_IP}", "${MEDIA_ROOT}", "${DOWNLOADS_ROOT}", "- ./", ":./"} {
		if strings.Contains(text, left) {
			return fmt.Errorf("%s: converted Compose still contains %s", c.id, left)
		}
	}
	for _, f := range c.files {
		if f.secret == "" || slices.Contains(c.missing, f.path) {
			continue
		}
		if strings.Contains(text, "/run/secrets/"+path.Base(f.path)) {
			return fmt.Errorf("%s: converted Compose still reads the dropped secret file %s", c.id, f.path)
		}
	}
	return nil
}

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
		env = append(env, entry)
	}
	slices.SortFunc(env, func(a, b envJSON) int { return strings.Compare(a.Key, b.Key) })
	return env, nil
}

func notesFor(ap app.App, c *converter, links []linkJSON) string {
	id := ap.Info().ID
	var notes []string
	if len(c.missing) > 0 {
		notes = append(notes, fmt.Sprintf("Needs files that only self-host generates before the first start (%s), mounted from ${CONFIG_PATH}/%s/; without them it does not start. Use self-host install %s for the full setup.",
			strings.Join(c.missing, ", "), id, id))
	}
	if len(c.converted) > 0 {
		keys := make([]string, len(c.converted))
		for i, key := range c.converted {
			keys[i] = strings.TrimSuffix(key, "_FILE")
		}
		notes = append(notes, fmt.Sprintf("self-host hands secrets to the container as files (%s); this Compose passes them as plain environment variables (%s) instead.",
			strings.Join(c.converted, ", "), strings.Join(keys, ", ")))
	}
	if len(c.dropped) > 0 {
		notes = append(notes, fmt.Sprintf("self-host preseeds the administrator through a password file (%s); this Compose leaves it out, so create the administrator in the web page on the first visit.",
			strings.Join(c.dropped, " ")))
	}
	if extra := extraNotes[id]; extra != "" {
		notes = append(notes, extra)
	}
	switch {
	case len(links) > maxListedLinks:
		notes = append(notes, fmt.Sprintf("After its first start, self-host also wires it to %d other Apps; plain Compose leaves that to you.", len(links)))
	case len(links) > 0:
		titles := make([]string, len(links))
		for i, link := range links {
			titles[i] = link.Title
		}
		notes = append(notes, "After its first start, self-host also wires it to other Apps ("+strings.Join(titles, "; ")+"); plain Compose leaves that to you.")
	}
	return strings.Join(notes, " ")
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
	for _, link := range ap.Links() {
		if catalog.Unavailable(link.Target) == "" {
			links = append(links, linkJSON{Target: link.Target, Title: link.Title})
		}
	}
	return selfHostApp{ID: info.ID, Name: info.Name, Description: info.Description, Category: info.Category, Icon: icon(info.ID),
		Image: info.Image, Port: info.Port, Docs: info.Docs, Links: links, Compose: compose, Env: env,
		Standalone: len(c.missing) == 0, Notes: notesFor(ap, c, links)}, nil
}

func writeSelfHost() error {
	cat := catalog.Default()
	apps := []selfHostApp{}
	for _, ap := range cat.Apps() {
		entry, err := selfHostEntry(ap)
		if err != nil {
			return err
		}
		apps = append(apps, entry)
	}
	for id := range extraNotes {
		if _, found := cat.App(id); !found {
			return fmt.Errorf("extraNotes names %q, which is not in the Catalog", id)
		}
	}
	recipes := []selfHostRecipe{}
	for _, r := range cat.Recipes() {
		offered := []string{}
		for _, id := range r.Apps {
			if catalog.Unavailable(id) == "" {
				offered = append(offered, id)
			}
		}
		recipes = append(recipes, selfHostRecipe{ID: r.ID, Name: r.Name, Description: r.Description, Apps: offered})
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
