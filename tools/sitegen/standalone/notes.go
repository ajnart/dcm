package standalone

import (
	"fmt"
	"regexp"
	"strings"

	"github.com/ajnart/self-host/internal/app"
)

const (
	maxListedLinks   = 3
	minNoteKeyLength = 6
)

var (
	noteKey  = regexp.MustCompile(`\b[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)*\b`)
	notePath = regexp.MustCompile(`(?:^|[\s("'])((?:\$\{[A-Z_]+\})?(?:/[A-Za-z0-9._-]+){2,})`)
)

// notesFor tells the person what plain Compose leaves to them, in the order they meet it:
// what is missing before the first start, what changed in the Compose, what to do after it,
// what self-host wires up later. The conversion derives all of it except the App's own guide.
func notesFor(ap app.App, c *converter, vars []variable, links []Link) (string, error) {
	id := ap.Info().ID
	var notes []string
	if len(c.missing) > 0 {
		notes = append(notes, fmt.Sprintf("Needs files that only self-host generates before the first start (%s), mounted from ${CONFIG_PATH}/%s/; without them it does not start. Use self-host install %s for the full setup.",
			strings.Join(c.missing, ", "), id, id))
	}
	for _, v := range vars {
		if v.required && c.facts.bound[v.Key] {
			notes = append(notes, fmt.Sprintf("Set %s before the first start (%s); the default %s is only a placeholder, and without a file there the container does not start.",
				v.Key, v.prompt, v.Default))
		}
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
	if guider, ok := ap.(app.StandaloneGuide); ok {
		guide := strings.TrimSpace(guider.StandaloneGuide())
		if err := checkGuide(id, guide, c.facts); err != nil {
			return "", err
		}
		if guide != "" {
			notes = append(notes, guide)
		}
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
	return strings.Join(notes, " "), nil
}

// checkGuide keeps an App's guide honest: it may only name variables the converted Compose
// reads and folders it mounts, so a rename in the App cannot leave the guide stale.
func checkGuide(id, guide string, f facts) error {
	for _, token := range noteKey.FindAllString(guide, -1) {
		if _, global := globals[token]; len(token) >= minNoteKeyLength && !f.keys[token] && !global {
			return fmt.Errorf("%s: guide names %s, which its compose does not read", id, token)
		}
	}
	for _, match := range notePath.FindAllStringSubmatch(guide, -1) {
		target := strings.TrimRight(match[1], ".")
		if !coveredBy(target, f.mounts) {
			return fmt.Errorf("%s: guide names %s, which its compose does not mount", id, target)
		}
	}
	return nil
}

func coveredBy(p string, mounts []mount) bool {
	for _, m := range mounts {
		if within(p, m.source) || within(p, m.target) {
			return true
		}
	}
	return false
}

func within(p, root string) bool {
	root = strings.TrimSuffix(root, "/")
	return root != "" && (p == root || strings.HasPrefix(p, root+"/"))
}
