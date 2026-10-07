// Package app defines the contract every catalog App implements.
package app

import (
	"context"

	"github.com/ajnart/self-host/internal/helpers"
)

type Info struct {
	ID          string
	Name        string
	Description string
	Category    string
	// Image is the main service's image with its floating tag.
	Image string
	Docs  string
	// Port is the default host port; ContainerPort is what it maps to.
	Port          int
	ContainerPort int
	// Service is the main Compose service, the one Setup talks to.
	Service string
	// Path is appended to the App URL when users open it (e.g. "/web").
	Path string
	// UsesMedia means the App mounts ${MEDIA_ROOT} or ${DOWNLOADS_ROOT}.
	UsesMedia bool
}

type Input struct {
	Key      string
	Prompt   string
	Help     string
	Default  string
	Required bool
}

// RenderContext is what an App needs to render its Compose fragment.
type RenderContext struct {
	Port   int
	Inputs map[string]string
}

type App interface {
	Info() Info
	Inputs() []Input
	// Compose returns apps/<id>/compose.yml. It refers to Host settings as
	// ${TZ}, ${PUID}, ${PGID}, ${UMASK}, ${BIND_IP}, ${MEDIA_ROOT},
	// ${DOWNLOADS_ROOT} and to secrets by their secrets.env names.
	Compose(rc RenderContext) string
	// Setup configures the running App headlessly through idempotent steps.
	Setup(ctx context.Context, h *helpers.H) error
	// Check verifies the App works as configured.
	Check(ctx context.Context, h *helpers.H) error
	Links() []Link
}

// SecretSpec is a secret an App needs before its container first starts.
type SecretSpec struct {
	// Name is namespaced with the App ID: "admin_token" for vaultwarden is
	// VAULTWARDEN_ADMIN_TOKEN in secrets.env.
	Name string
	// Length is the size of the generated random value.
	Length int
	// Hex makes it Length hexadecimal digits (e.g. a 256-bit key as 64)
	// instead of letters and digits.
	Hex bool
}

// SecretDeclarer is an optional interface for Apps whose Compose fragment
// refers to a secret by name, e.g. ${VAULTWARDEN_ADMIN_TOKEN}. Install
// generates each missing secret and saves it to secrets.env before it renders
// the fragment, so Compose can interpolate it on the first start. Existing
// values are kept: rerunning Install never rotates a secret.
type SecretDeclarer interface {
	Secrets() []SecretSpec
}

// Link wires the App that declares it to Target. Apply runs only once both
// Apps finished Setup; Remove runs when Target is removed.
type Link struct {
	ID     string
	Target string
	Title  string
	Apply  func(ctx context.Context, from, to *helpers.H) error
	Remove func(ctx context.Context, from, to *helpers.H) error
}

// File is a configuration file an App needs before its container first
// starts, written to apps/<id>/<Path> (Path is relative to the App folder).
type File struct {
	Path    string
	Content string
	// Mode defaults to 0644; use 0600 when Content holds a secret.
	Mode uint32
	// Keep leaves an existing file alone, e.g. one the App rewrites itself.
	Keep bool
}

// FileDeclarer is an optional interface for Apps that need generated config
// files (a Caddyfile, a gatus config.yaml). Install writes them after the
// App's secrets exist and before the container starts; secret returns one of
// the App's declared secrets by its short name, or the Admin login for
// "ADMIN_USER" and "ADMIN_PASSWORD".
type FileDeclarer interface {
	Files(rc RenderContext, secret func(name string) string) []File
}
