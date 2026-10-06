package catalog

import (
	"github.com/ajnart/self-host/internal/app"
	"github.com/ajnart/self-host/internal/apps/ntfy"
)

// Default is the catalog shipped in the binary.
func Default() *Catalog {
	return New([]app.App{ntfy.App{}}, []Recipe{})
}
