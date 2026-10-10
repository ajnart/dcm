// Package skill holds the agent guide embedded in the binary, so an agent
// always reads the guide that matches the commands it can run.
package skill

import (
	_ "embed"
	"strings"
)

//go:embed guide.md
var guide string

// Guide returns the agent guide for the given binary version.
func Guide(version string) string {
	return strings.ReplaceAll(guide, "{{version}}", strings.TrimPrefix(version, "v"))
}
