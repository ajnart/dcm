// Package system holds every dependency on the outside world, so the rest of
// the binary can be driven by fakes in tests.
package system

import (
	"context"
	"errors"
	"io"
	"net/http"
	"time"
)

var ErrNotFound = errors.New("executable not found")

// Cmd is one external process invocation.
type Cmd struct {
	Name  string
	Args  []string
	Dir   string
	Env   []string
	Stdin []byte
}

// Result is the captured outcome of a Cmd. A non-zero ExitCode is not an error.
type Result struct {
	Stdout   []byte
	Stderr   []byte
	ExitCode int
}

type Runner interface {
	Run(ctx context.Context, cmd Cmd) (Result, error)
	// Stream runs cmd and writes its combined output to w until it exits or ctx ends.
	Stream(ctx context.Context, cmd Cmd, w io.Writer) error
}

// User is the account that owns the Project. Under sudo it is the invoking user.
type User struct {
	Name string
	Home string
	UID  int
	GID  int
}

type Deps struct {
	Version     string
	GOOS        string
	Runner      Runner
	HTTP        *http.Client
	LookPath    func(name string) (string, error)
	Getenv      func(key string) string
	CurrentUser func() (User, error)
	LookupUser  func(name string) (User, error)
	Now         func() time.Time
	// LANIP returns the address of the interface on the default route.
	LANIP func() (string, error)
	// TimeZone returns the host's IANA time zone.
	TimeZone func() string
	// PortFree reports whether a TCP port can be bound on the host.
	PortFree func(port int) bool
	// ProcessAlive reports whether a PID belongs to a running process.
	ProcessAlive func(pid int) bool
	PID          int
	Out          io.Writer
	Err          io.Writer
	// Interactive is true when stdin and stdout are terminals.
	Interactive bool
}
