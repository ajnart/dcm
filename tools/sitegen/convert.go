package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"path"
	"regexp"
	"slices"
	"strings"

	"go.yaml.in/yaml/v3"
)

var (
	serviceLine = regexp.MustCompile(`^  ([A-Za-z0-9][A-Za-z0-9_.-]*):\s*$`)
	keyLine     = regexp.MustCompile(`^    ([A-Za-z0-9_.-]+):(?:\s+(.*))?$`)
	itemLine    = regexp.MustCompile(`^      - (.*)$`)
	envLine     = regexp.MustCompile(`^      ([A-Za-z_][A-Za-z0-9_]*): (.*)$`)
	secretRead  = regexp.MustCompile(`/run/secrets/([A-Za-z0-9._-]+)`)
)

type block struct {
	name  string
	lines []string
}

// converter rewrites text, not a parsed document, so every line self-host did not touch
// stays byte for byte what the App wrote.
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

// pureMounts maps the name a container sees a file under in /run/secrets to the variable
// that is its whole content; such a file becomes an environment variable instead.
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

func (c *converter) volume(line string, mounts map[string]string) (string, bool, error) {
	if strings.TrimSpace(line) == "" || strings.HasPrefix(strings.TrimSpace(line), "#") {
		return line, true, nil
	}
	match := itemLine.FindStringSubmatch(line)
	if match == nil || strings.Contains(match[1], ": ") {
		return "", false, fmt.Errorf("%s: long-form volume %q is not handled", c.id, strings.TrimSpace(line))
	}
	src, rest, found := strings.Cut(match[1], ":")
	rel, relative := strings.CutPrefix(src, "./")
	if !found || !relative {
		return line, true, nil
	}
	dst, _, _ := strings.Cut(rest, ":")
	if _, pure := mounts[path.Base(dst)]; pure && strings.HasPrefix(dst, "/run/secrets/") {
		for _, f := range c.files {
			if f.path == rel && f.secret != "" {
				return "", false, nil
			}
		}
	}
	if rel == "media-library" {
		// self-host fills this folder with the shared media library, which DCM keeps in one place.
		return "      - ${DATA_PATH}/media:" + rest, true, nil
	}
	c.coverFiles(rel)
	return "      - ${CONFIG_PATH}/" + c.id + "/" + rel + ":" + rest, true, nil
}

func (c *converter) environment(line string, mounts map[string]string) (string, error) {
	if match := itemLine.FindStringSubmatch(line); match != nil && strings.Contains(match[1], "/run/secrets/") {
		return "", fmt.Errorf("%s: list-form environment entry %q reads a secret file and is not handled", c.id, match[1])
	}
	match := envLine.FindStringSubmatch(line)
	if match == nil {
		return line, nil
	}
	key, value := match[1], strings.Trim(strings.TrimSpace(match[2]), `"'`)
	base, isFile := strings.CutSuffix(key, "_FILE")
	if !isFile {
		return line, nil
	}
	name := strings.TrimPrefix(value, "/run/secrets/")
	variable, found := mounts[name]
	if !found {
		variable, found = c.refs[name]
	}
	if !found {
		return line, nil
	}
	if !slices.Contains(c.converted, key) {
		c.converted = append(c.converted, key)
	}
	return "      " + base + ": " + placeholder(variable), nil
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
			case "volumes":
				if match[2] != "" {
					return nil, fmt.Errorf("%s: inline volumes %q are not handled", c.id, match[2])
				}
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
		var err error
		switch section {
		case "secrets":
			continue
		case "ports":
			line = strings.Replace(line, "${BIND_IP}:", "", 1)
		case "volumes":
			var keep bool
			if line, keep, err = c.volume(line, mounts); err != nil {
				return nil, err
			}
			if !keep {
				continue
			}
		case "environment":
			if line, err = c.environment(line, mounts); err != nil {
				return nil, err
			}
		}
		out = append(out, line)
	}
	for out[len(out)-1] == "" {
		out = out[:len(out)-1]
	}
	if !slices.Contains(out, "    container_name: ${CONTAINER_PREFIX}"+b.name) {
		return nil, fmt.Errorf("%s: service %s has no image", c.id, b.name)
	}
	return out, c.checkSecretReads(b.name, out)
}

// checkSecretReads fails when a service still reads /run/secrets/<name> that none of its
// volumes provides: without self-host there is no secrets directory to read it from.
func (c *converter) checkSecretReads(service string, lines []string) error {
	mounted := map[string]bool{}
	var reads []string
	section := ""
	for _, line := range lines[1:] {
		if match := keyLine.FindStringSubmatch(line); match != nil {
			section = match[1]
		}
		if match := itemLine.FindStringSubmatch(line); section == "volumes" && match != nil {
			_, rest, _ := strings.Cut(match[1], ":")
			target, _, _ := strings.Cut(rest, ":")
			mounted[target] = true
			continue
		}
		reads = append(reads, secretRead.FindAllString(line, -1)...)
	}
	for _, read := range reads {
		if !mounted[read] {
			return fmt.Errorf("%s: service %s reads %s, which none of its volumes provides", c.id, service, read)
		}
	}
	return nil
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
	for _, left := range []string{"${BIND_IP}", "${MEDIA_ROOT}", "${DOWNLOADS_ROOT}", "- ./", ":./", "source: ./", "[./"} {
		if strings.Contains(text, left) {
			return fmt.Errorf("%s: converted Compose still contains %s", c.id, left)
		}
	}
	return nil
}
