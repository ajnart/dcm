package standalone

import (
	"bytes"
	"fmt"
	"path"
	"regexp"
	"slices"
	"strings"

	"go.yaml.in/yaml/v3"
)

const secretsDir = "/run/secrets/"

var (
	secretRead = regexp.MustCompile(`/run/secrets/([A-Za-z0-9._-]+)`)
	rootVars   = strings.NewReplacer("${MEDIA_ROOT}", "${DATA_PATH}/media", "${DOWNLOADS_ROOT}", "${DATA_PATH}/downloads")
	// fileKeys name files on the machine that plain Compose cannot supply.
	fileKeys = []string{"env_file", "build", "configs", "extends"}
)

// plainEnv maps each KEY_FILE an App points at a secret to the variable the image reads for
// the same value when the secret is passed in the environment. Most images read KEY, but the
// name is the image's own, so an entry is added after checking its documentation and a
// KEY_FILE missing here fails the build rather than export a variable the image ignores.
var plainEnv = map[string]string{
	"BORG_PASSPHRASE_FILE":           "BORG_PASSPHRASE",
	"DNS_SERVER_ADMIN_PASSWORD_FILE": "DNS_SERVER_ADMIN_PASSWORD",
	"GOTIFY_DEFAULTUSER_PASS_FILE":   "GOTIFY_DEFAULTUSER_PASS",
	"LLDAP_JWT_SECRET_FILE":          "LLDAP_JWT_SECRET",
	"LLDAP_KEY_SEED_FILE":            "LLDAP_KEY_SEED",
	"LLDAP_LDAP_USER_PASS_FILE":      "LLDAP_LDAP_USER_PASS",
	"MARIADB_PASSWORD_FILE":          "MARIADB_PASSWORD",
	"MARIADB_ROOT_PASSWORD_FILE":     "MARIADB_ROOT_PASSWORD",
	"MINIO_ROOT_PASSWORD_FILE":       "MINIO_ROOT_PASSWORD",
	"MYSQL_PASSWORD_FILE":            "MYSQL_PASSWORD",
	"NEXTCLOUD_ADMIN_PASSWORD_FILE":  "NEXTCLOUD_ADMIN_PASSWORD",
	"PAPERLESS_ADMIN_PASSWORD_FILE":  "PAPERLESS_ADMIN_PASSWORD",
	"PAPERLESS_DBPASS_FILE":          "PAPERLESS_DBPASS",
	"PAPERLESS_SECRET_KEY_FILE":      "PAPERLESS_SECRET_KEY",
	"PLEX_CLAIM_FILE":                "PLEX_CLAIM",
	"POSTGRES_PASSWORD_FILE":         "POSTGRES_PASSWORD",
	"RESTIC_PASSWORD_FILE":           "RESTIC_PASSWORD",
	"SERVER_SECRET_FILE":             "SERVER_SECRET",
	"WEBPASSWORD_FILE":               "FTLCONF_webserver_api_password",
}

type mount struct{ source, target string }

// facts are what the converted Compose reads and mounts, for the variable list and the guide check.
type facts struct {
	// keys are the variables it references and the environment keys it sets.
	keys   map[string]bool
	mounts []mount
	// bound holds the variables that are the whole source of a mount.
	bound map[string]bool
}

// converter rewrites the Compose tree: it keys on structure, so a spelling the App chooses
// (list or map environment, short or long volumes) cannot slip past a rule.
type converter struct {
	id    string
	files []fileSpec
	// refs maps a top-level Compose secret to the variable that feeds it.
	refs    map[string]string
	missing []string
	dropped []string
	facts   facts
}

func (c *converter) convert(raw string) (string, error) {
	var doc yaml.Node
	if err := yaml.Unmarshal([]byte(raw), &doc); err != nil {
		return "", fmt.Errorf("%s: compose is not valid YAML: %w", c.id, err)
	}
	if doc.Kind != yaml.DocumentNode || len(doc.Content) != 1 || doc.Content[0].Kind != yaml.MappingNode {
		return "", fmt.Errorf("%s: compose must be one mapping", c.id)
	}
	var aliased bool
	walk(&doc, func(n *yaml.Node) { aliased = aliased || n.Kind == yaml.AliasNode })
	if aliased {
		return "", fmt.Errorf("%s: compose uses a YAML alias, which is not handled", c.id)
	}
	c.refs = map[string]string{}
	var services *yaml.Node
	top := doc.Content[0]
	for i := 0; i < len(top.Content); i += 2 {
		key, value := top.Content[i], top.Content[i+1]
		switch key.Value {
		case "services":
			services = value
		case "secrets":
			if err := c.topSecrets(value); err != nil {
				return "", err
			}
		default:
			return "", fmt.Errorf("%s: top-level key %q is not handled", c.id, key.Value)
		}
	}
	if services == nil || services.Kind != yaml.MappingNode || len(services.Content) == 0 {
		return "", fmt.Errorf("%s: compose must hold a services map", c.id)
	}
	for i := 0; i < len(services.Content); i += 2 {
		if err := c.service(services.Content[i].Value, services.Content[i+1]); err != nil {
			return "", err
		}
	}
	walk(services, func(n *yaml.Node) {
		if n.Kind == yaml.ScalarNode {
			n.Value = rootVars.Replace(n.Value)
		}
	})
	text, err := encode(services)
	if err != nil {
		return "", fmt.Errorf("%s: %w", c.id, err)
	}
	if strings.Contains(text, "BIND_IP") {
		return "", fmt.Errorf("%s: converted Compose still reads BIND_IP", c.id)
	}
	c.collect(services, text)
	return text, nil
}

// topSecrets records the variable behind each top-level secret. Only environment sources
// can become a variable; a file source needs self-host.
func (c *converter) topSecrets(secrets *yaml.Node) error {
	if secrets.Kind != yaml.MappingNode {
		return fmt.Errorf("%s: secrets is not a mapping", c.id)
	}
	for i := 0; i < len(secrets.Content); i += 2 {
		name, spec := secrets.Content[i].Value, secrets.Content[i+1]
		source := lookup(spec, "environment")
		if source == nil || len(spec.Content) != 2 {
			return fmt.Errorf("%s: secret %q has unsupported source", c.id, name)
		}
		c.refs[name] = source.Value
	}
	return nil
}

func (c *converter) service(name string, svc *yaml.Node) error {
	if svc.Kind != yaml.MappingNode {
		return fmt.Errorf("%s: service %s is not a mapping", c.id, name)
	}
	for _, key := range fileKeys {
		if lookup(svc, key) != nil {
			return fmt.Errorf("%s: service %s uses %s, which names files plain Compose cannot supply", c.id, name, key)
		}
	}
	if err := c.containerName(name, svc); err != nil {
		return err
	}
	secretFiles, pure, err := c.pureMounts(svc)
	if err != nil {
		return err
	}
	remove(svc, "secrets")
	restart(lookup(svc, "restart"))
	ports(lookup(svc, "ports"))
	if err := c.volumes(svc, pure); err != nil {
		return err
	}
	if err := c.environment(lookup(svc, "environment"), secretFiles); err != nil {
		return err
	}
	c.command(lookup(svc, "command"), secretFiles)
	return c.checkSecretReads(name, svc)
}

func (c *converter) containerName(name string, svc *yaml.Node) error {
	if lookup(svc, "container_name") != nil {
		return fmt.Errorf("%s: service %s already names its container", c.id, name)
	}
	for i := 0; i < len(svc.Content); i += 2 {
		if svc.Content[i].Value != "image" {
			continue
		}
		key := &yaml.Node{Kind: yaml.ScalarNode, Tag: "!!str", Value: "container_name"}
		value := &yaml.Node{Kind: yaml.ScalarNode, Tag: "!!str", Value: "${CONTAINER_PREFIX}" + name}
		svc.Content = slices.Insert(svc.Content, i+2, key, value)
		return nil
	}
	return fmt.Errorf("%s: service %s has no image", c.id, name)
}

func restart(policy *yaml.Node) {
	if policy != nil && (policy.Value == "unless-stopped" || policy.Value == "always") {
		setPlain(policy, "${RESTART_POLICY}")
	}
}

// ports drops the interface self-host binds to: a Docker Compose Maker stack publishes on all of them.
func ports(list *yaml.Node) {
	for _, item := range items(list) {
		switch item.Kind {
		case yaml.ScalarNode:
			item.Value = strings.Replace(item.Value, "${BIND_IP}:", "", 1)
		case yaml.MappingNode:
			remove(item, "host_ip")
		}
	}
}

// volume is one volume entry in either spelling.
type volume struct {
	source, target string
	setSource      func(string)
}

func parseVolume(item *yaml.Node) (volume, error) {
	switch item.Kind {
	case yaml.ScalarNode:
		source, rest, _ := strings.Cut(item.Value, ":")
		target, _, _ := strings.Cut(rest, ":")
		return volume{source: source, target: target,
			setSource: func(s string) { item.Value = s + ":" + rest }}, nil
	case yaml.MappingNode:
		kind := lookup(item, "type")
		source, target := lookup(item, "source"), lookup(item, "target")
		bind := kind == nil || kind.Value == "bind"
		if target == nil || (bind && source == nil) {
			return volume{}, fmt.Errorf("long-form volume at line %d has no source or target", item.Line)
		}
		v := volume{target: target.Value}
		if source != nil {
			v.source = source.Value
			v.setSource = func(s string) { source.Value = s }
		}
		return v, nil
	}
	return volume{}, fmt.Errorf("volume at line %d is neither a string nor a mapping", item.Line)
}

// relative reports the cleaned path below the App's own folder that a source such as ./config
// names, and whether the source is such a path at all (a named volume or an absolute path is not).
func relative(v volume) (string, bool, error) {
	rel, found := strings.CutPrefix(v.source, "./")
	clean := path.Clean(rel)
	if v.source == "." || clean == ".." || strings.HasPrefix(clean, "../") || (found && clean == ".") {
		return "", false, fmt.Errorf("volume source %q does not name a folder below the App's own", v.source)
	}
	return clean, found, nil
}

// pureMounts maps the name a container sees a file under in /run/secrets to the variable
// that is its whole content; such a file becomes an environment variable instead.
func (c *converter) pureMounts(svc *yaml.Node) (map[string]string, map[*yaml.Node]bool, error) {
	names := map[string]string{}
	pure := map[*yaml.Node]bool{}
	for _, item := range items(lookup(svc, "volumes")) {
		v, err := parseVolume(item)
		if err != nil {
			return nil, nil, fmt.Errorf("%s: %w", c.id, err)
		}
		rel, isRelative, err := relative(v)
		if err != nil {
			return nil, nil, fmt.Errorf("%s: %w", c.id, err)
		}
		if !isRelative || !strings.HasPrefix(v.target, secretsDir) {
			continue
		}
		for _, f := range c.files {
			if f.path == rel && f.secret != "" {
				names[path.Base(v.target)] = f.secret
				pure[item] = true
			}
		}
	}
	return names, pure, nil
}

func (c *converter) coverFiles(rel string) {
	for _, f := range c.files {
		if !f.empty && (f.path == rel || strings.HasPrefix(f.path, rel+"/")) && !slices.Contains(c.missing, f.path) {
			c.missing = append(c.missing, f.path)
		}
	}
}

func (c *converter) volumes(svc *yaml.Node, pure map[*yaml.Node]bool) error {
	list := lookup(svc, "volumes")
	if list == nil {
		return nil
	}
	if list.Kind != yaml.SequenceNode {
		return fmt.Errorf("%s: volumes is not a list", c.id)
	}
	var kept []*yaml.Node
	for _, item := range list.Content {
		if pure[item] {
			continue
		}
		v, err := parseVolume(item)
		if err != nil {
			return fmt.Errorf("%s: %w", c.id, err)
		}
		rel, isRelative, err := relative(v)
		if err != nil {
			return fmt.Errorf("%s: %w", c.id, err)
		}
		switch {
		case !isRelative:
		case rel == "media-library":
			// self-host fills this folder with the shared media library, which DCM keeps in one place.
			v.setSource("${DATA_PATH}/media")
		default:
			c.coverFiles(rel)
			v.setSource("${CONFIG_PATH}/" + c.id + "/" + rel)
		}
		kept = append(kept, item)
	}
	if len(kept) == 0 {
		remove(svc, "volumes")
		return nil
	}
	list.Content = kept
	return nil
}

// secretFile resolves KEY_FILE=/run/secrets/name, or KEY_FILE=name as Pi-hole reads it, to
// the variable the image reads in KEY_FILE's place and the variable that holds the name's content.
func (c *converter) secretFile(key, value string, secretFiles map[string]string) (plain, variable string, ok bool, err error) {
	if !strings.HasSuffix(key, "_FILE") {
		return "", "", false, nil
	}
	name := strings.TrimPrefix(strings.TrimSpace(value), secretsDir)
	variable, found := secretFiles[name]
	if !found {
		variable, found = c.refs[name]
	}
	if !found {
		return "", "", false, nil
	}
	plain, known := plainEnv[key]
	if !known {
		return "", "", false, fmt.Errorf("%s: %s points at a secret, and plainEnv does not say which variable the image reads for it", c.id, key)
	}
	return plain, variable, true, nil
}

func (c *converter) environment(env *yaml.Node, secretFiles map[string]string) error {
	if env == nil {
		return nil
	}
	switch env.Kind {
	case yaml.MappingNode:
		for i := 0; i < len(env.Content); i += 2 {
			key, value := env.Content[i], env.Content[i+1]
			plain, variable, ok, err := c.secretFile(key.Value, value.Value, secretFiles)
			if err != nil {
				return err
			}
			if ok {
				key.Value = plain
				setPlain(value, placeholder(variable))
			}
		}
	case yaml.SequenceNode:
		for _, item := range env.Content {
			key, value, _ := strings.Cut(item.Value, "=")
			plain, variable, ok, err := c.secretFile(key, value, secretFiles)
			if err != nil {
				return err
			}
			if ok {
				item.Value = plain + "=" + placeholder(variable)
			}
		}
	}
	return nil
}

func (c *converter) command(cmd *yaml.Node, secretFiles map[string]string) {
	if cmd == nil || cmd.Kind != yaml.SequenceNode {
		return
	}
	var kept []*yaml.Node
	for _, arg := range cmd.Content {
		if readsAny(arg.Value, secretFiles) {
			c.dropped = append(c.dropped, arg.Value)
			continue
		}
		kept = append(kept, arg)
	}
	cmd.Content = kept
}

func readsAny(value string, secretFiles map[string]string) bool {
	for name := range secretFiles {
		if strings.Contains(value, secretsDir+name) {
			return true
		}
	}
	return false
}

// checkSecretReads fails when a service still reads /run/secrets/<name> that none of its
// volumes provides: without self-host there is no secrets directory to read it from.
func (c *converter) checkSecretReads(name string, svc *yaml.Node) error {
	mounted := map[string]bool{}
	for _, item := range items(lookup(svc, "volumes")) {
		if v, err := parseVolume(item); err == nil {
			mounted[v.target] = true
		}
	}
	var reads []string
	for i := 0; i < len(svc.Content); i += 2 {
		if svc.Content[i].Value == "volumes" {
			continue
		}
		for _, n := range svc.Content[i : i+2] {
			walk(n, func(n *yaml.Node) {
				if n.Kind == yaml.ScalarNode {
					reads = append(reads, secretRead.FindAllString(n.Value, -1)...)
				}
			})
		}
	}
	for _, read := range reads {
		if !mounted[read] {
			return fmt.Errorf("%s: service %s reads %s, which none of its volumes provides", c.id, name, read)
		}
	}
	return nil
}

// collect records what the converted Compose reads and mounts.
func (c *converter) collect(services *yaml.Node, text string) {
	c.facts = facts{keys: map[string]bool{}, bound: map[string]bool{}}
	for _, match := range varRef.FindAllStringSubmatch(text, -1) {
		c.facts.keys[match[1]+match[2]] = true
	}
	for i := 1; i < len(services.Content); i += 2 {
		svc := services.Content[i]
		env := lookup(svc, "environment")
		if env != nil && env.Kind == yaml.MappingNode {
			for j := 0; j < len(env.Content); j += 2 {
				c.facts.keys[env.Content[j].Value] = true
			}
		}
		for _, item := range items(env) {
			key, _, _ := strings.Cut(item.Value, "=")
			c.facts.keys[key] = true
		}
		for _, item := range items(lookup(svc, "volumes")) {
			v, err := parseVolume(item)
			if err != nil {
				continue
			}
			c.facts.mounts = append(c.facts.mounts, mount{source: v.source, target: v.target})
			if match := soleVar.FindStringSubmatch(v.source); match != nil {
				c.facts.bound[match[1]] = true
			}
		}
	}
}

// encode writes each service on its own, so Services keep a blank line between them.
func encode(services *yaml.Node) (string, error) {
	var parts []string
	for i := 0; i < len(services.Content); i += 2 {
		root := &yaml.Node{Kind: yaml.MappingNode, Tag: "!!map", Content: []*yaml.Node{
			{Kind: yaml.ScalarNode, Tag: "!!str", Value: "services"},
			{Kind: yaml.MappingNode, Tag: "!!map", Content: services.Content[i : i+2]},
		}}
		var buf bytes.Buffer
		enc := yaml.NewEncoder(&buf)
		enc.SetIndent(2)
		if err := enc.Encode(root); err != nil {
			return "", fmt.Errorf("converted Compose cannot be written: %w", err)
		}
		if err := enc.Close(); err != nil {
			return "", err
		}
		text := buf.String()
		if i > 0 {
			text = strings.TrimPrefix(text, "services:\n")
		}
		parts = append(parts, text)
	}
	return strings.Join(parts, "\n"), nil
}

func lookup(m *yaml.Node, key string) *yaml.Node {
	if m == nil || m.Kind != yaml.MappingNode {
		return nil
	}
	for i := 0; i < len(m.Content); i += 2 {
		if m.Content[i].Value == key {
			return m.Content[i+1]
		}
	}
	return nil
}

func remove(m *yaml.Node, key string) {
	for i := 0; i < len(m.Content); i += 2 {
		if m.Content[i].Value == key {
			m.Content = slices.Delete(m.Content, i, i+2)
			return
		}
	}
}

func items(n *yaml.Node) []*yaml.Node {
	if n == nil || n.Kind != yaml.SequenceNode {
		return nil
	}
	return n.Content
}

func walk(n *yaml.Node, visit func(*yaml.Node)) {
	visit(n)
	for _, child := range n.Content {
		walk(child, visit)
	}
}

func setPlain(n *yaml.Node, value string) {
	n.Value, n.Tag, n.Style = value, "!!str", 0
}
