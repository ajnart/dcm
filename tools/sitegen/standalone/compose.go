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
	refs      map[string]string
	missing   []string
	converted []string
	dropped   []string
	facts     facts
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
	if err := c.command(lookup(svc, "command"), secretFiles); err != nil {
		return err
	}
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
	// hostPath is false for named volumes and tmpfs, which carry no folder of the person's.
	hostPath  bool
	setSource func(string)
}

func parseVolume(item *yaml.Node) (volume, error) {
	switch item.Kind {
	case yaml.ScalarNode:
		source, rest, found := strings.Cut(item.Value, ":")
		target, _, _ := strings.Cut(rest, ":")
		return volume{source: source, target: target, hostPath: found,
			setSource: func(s string) { item.Value = s + ":" + rest }}, nil
	case yaml.MappingNode:
		kind := lookup(item, "type")
		source, target := lookup(item, "source"), lookup(item, "target")
		hostPath := kind == nil || kind.Value == "bind"
		if target == nil || (hostPath && source == nil) {
			return volume{}, fmt.Errorf("long-form volume at line %d has no source or target", item.Line)
		}
		v := volume{target: target.Value, hostPath: hostPath}
		if source != nil {
			v.source = source.Value
			v.setSource = func(s string) { source.Value = s }
		}
		return v, nil
	}
	return volume{}, fmt.Errorf("volume at line %d is neither a string nor a mapping", item.Line)
}

// relative reports the path below the App's own folder that a source such as ./config names.
func relative(v volume) (string, bool, error) {
	if !v.hostPath {
		return "", false, nil
	}
	rel, found := strings.CutPrefix(v.source, "./")
	climbs := v.source == "." || v.source == ".." || strings.HasPrefix(v.source, "../") || slices.Contains(strings.Split(rel, "/"), "..")
	if climbs || (found && path.Clean(rel) == ".") {
		return "", false, fmt.Errorf("volume source %q does not name a folder below the App's own", v.source)
	}
	return rel, found, nil
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
// the variable that holds the name's content.
func (c *converter) secretFile(key, value string, secretFiles map[string]string) (string, string, bool) {
	base, isFile := strings.CutSuffix(key, "_FILE")
	if !isFile {
		return "", "", false
	}
	name := strings.TrimPrefix(strings.TrimSpace(value), secretsDir)
	variable, found := secretFiles[name]
	if !found {
		variable, found = c.refs[name]
	}
	return base, variable, found
}

func (c *converter) environment(env *yaml.Node, secretFiles map[string]string) error {
	if env == nil {
		return nil
	}
	switch env.Kind {
	case yaml.MappingNode:
		for i := 0; i < len(env.Content); i += 2 {
			key, value := env.Content[i], env.Content[i+1]
			base, variable, ok := c.secretFile(key.Value, value.Value, secretFiles)
			if !ok {
				continue
			}
			c.converted = appendOnce(c.converted, key.Value)
			key.Value = base
			setPlain(value, placeholder(variable))
		}
	case yaml.SequenceNode:
		for _, item := range env.Content {
			key, value, _ := strings.Cut(item.Value, "=")
			if base, variable, ok := c.secretFile(key, value, secretFiles); ok {
				c.converted = appendOnce(c.converted, key)
				item.Value = base + "=" + placeholder(variable)
				continue
			}
			if strings.Contains(item.Value, secretsDir) {
				return fmt.Errorf("%s: list-form environment entry %q reads a secret file and is not handled", c.id, item.Value)
			}
		}
	}
	return nil
}

func (c *converter) command(cmd *yaml.Node, secretFiles map[string]string) error {
	if cmd == nil {
		return nil
	}
	switch cmd.Kind {
	case yaml.ScalarNode:
		if strings.Contains(cmd.Value, secretsDir) {
			return fmt.Errorf("%s: command %q is a string, so its secret files cannot be dropped", c.id, cmd.Value)
		}
	case yaml.SequenceNode:
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
	return nil
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

func appendOnce(list []string, value string) []string {
	if slices.Contains(list, value) {
		return list
	}
	return append(list, value)
}
