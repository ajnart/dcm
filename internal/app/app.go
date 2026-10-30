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
	// Image is the main service's image with its floating tag (`:latest`, or the upstream's floating stable tag). Only database engines pin a major.
	Image string
	Docs  string
	// Port is the default host port; ContainerPort is what it maps to.
	Port          int
	ContainerPort int
	// ContainerPortIsPort means the App listens on the host port it is given,
	// published as port:port, so the port inside the Project follows the
	// allocated host port and ContainerPort is only its default.
	ContainerPortIsPort bool
	// Service is the main Compose service, the one Setup talks to.
	Service string
	// Path is appended to the App URL when users open it (e.g. "/web").
	Path string
	// NoWebUI identifies a published protocol endpoint that is not a browser URL.
	NoWebUI bool
	// WebSockets and LongTimeouts say what a reverse proxy in front of the App
	// must allow: upgraded connections, and long uploads or streams. Unset
	// means not known, not no.
	WebSockets, LongTimeouts bool
	// UsesMedia means the App mounts ${MEDIA_ROOT} or ${DOWNLOADS_ROOT}.
	UsesMedia bool
}

// ContainerPortFor is the port other services in the Project reach the App on,
// given the host port it was allocated.
func (i Info) ContainerPortFor(port int) int {
	if i.ContainerPortIsPort && port > 0 {
		return port
	}
	return i.ContainerPort
}

type Input struct {
	Key          string
	Prompt       string
	Help         string
	Default      string
	Required     bool
	RecoveryOnly bool `json:",omitempty"`
	// Private inputs are stored in secrets.env, never in Project state.
	Private bool
	// HostPortProtocols declares a non-secret host port published by the App.
	// Install keeps an existing or explicitly selected value and otherwise
	// allocates the first available port from Default for every protocol.
	HostPortProtocols []string
	// Validate rejects an invalid public input before any apply operation.
	Validate func(string) error `json:"-"`
}

// RenderContext is what an App needs to render its Compose fragment.
type RenderContext struct {
	Port         int
	Inputs       map[string]string
	Settings     map[string]string
	DockerSocket string
	// Web lists the installed Apps with a web page, by ID, for an Access App
	// that fronts each of them.
	Web []WebTarget
}

// DockerSocketMounter identifies an App whose fragment mounts the active
// Docker daemon socket. The service resolves the host path at render time.
type DockerSocketMounter interface {
	DockerSocketTarget() string
}

// WebTarget is one installed App with a web page: the Compose service and
// container port an Access App forwards to, and the path the App opens at.
type WebTarget struct {
	ID            string
	Service       string
	ContainerPort int
	Path          string
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

// LegacyComposer is an optional interface for Apps whose Compose changed in
// more than image tags since a release that did not record a hash of it. Update
// treats a compose.yml equal to one of these renders as unmodified.
type LegacyComposer interface {
	LegacyComposes(RenderContext) []string
}

type AdminEmailProvider interface {
	AdminEmail(username string) string
}

// EphemeralFIFODeclarer identifies disposable runtime FIFOs recreated by the
// App. Only an exact FIFO at a canonical App-relative path may be omitted from
// backup; regular files, other special types and unsafe paths remain checked.
type EphemeralFIFODeclarer interface {
	EphemeralFIFOs() []string
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

// StandaloneGuide is an optional interface for Apps whose first start leaves
// the person a step that Setup does after the container runs, such as creating
// the first administrator. The standalone Compose export prints the sentence or
// sentences it returns. It may name only variables and folders that the App's
// Compose uses; the export fails when it names anything else.
type StandaloneGuide interface {
	StandaloneGuide() string
}

// DeferredStarter is implemented by an App with services that only its Setup
// may start, because they need settings Setup obtains from the running App.
// Every Compose up of the Project leaves them out while Deferred lists them.
type DeferredStarter interface {
	Deferred(*helpers.H) []string
}

// PreflightChecker validates an App's owned local prerequisites before rendering
// or starting containers. It must not mutate files or call the running App.
// Restore checks safely extracted files using their archived public inputs.
type PreflightChecker interface {
	Preflight(context.Context, *helpers.H) error
}

type AccessConfigurer interface {
	ConfigureAccess(context.Context, *helpers.H) error
}
