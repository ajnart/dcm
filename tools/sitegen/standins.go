package main

import (
	"crypto/sha256"
	"fmt"
	"path"
	"regexp"
	"strings"

	"github.com/ajnart/self-host/internal/app"
	"github.com/ajnart/self-host/internal/service"
)

const (
	standInAlphabet = "abcdefghijklmnopqrstuvwxyz0123456789"
	hexAlphabet     = "0123456789abcdef"
	adminUserLength = 12
	otherLength     = 24
)

// soleVar catches a Files value that is one placeholder an App's own Input supplied.
var soleVar = regexp.MustCompile(`^\$\{([A-Za-z_][A-Za-z0-9_]*)\}$`)

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
