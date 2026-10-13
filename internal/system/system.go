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

type DiskUsage struct {
	AvailableBytes uint64
}

type MachineResources struct {
	MemoryBytes  uint64
	MemorySource string
	CPUs         int
}

type FileLimits struct {
	InotifyWatches uint64
	OpenFiles      uint64
}

type FileSystem struct {
	Type          string
	CaseSensitive bool
}

// Resolver looks names up for the Easy names check.
type Resolver interface {
	// LookupHost asks this computer's own resolver, as a browser here would.
	LookupHost(ctx context.Context, name string) ([]string, error)
	// LookupHostVia asks one DNS server directly, such as "1.1.1.1:53",
	// bypassing the router's resolver.
	LookupHostVia(ctx context.Context, server, name string) ([]string, error)
}

type Runner interface {
	Run(ctx context.Context, cmd Cmd) (Result, error)
	// Stream runs cmd and writes its combined output to w until it exits or ctx ends.
	Stream(ctx context.Context, cmd Cmd, w io.Writer) error
}

// StreamIORunner is an optional Runner capability for binary streams. Stdout
// and diagnostics stay separate; nonnil stdin replaces Cmd.Stdin.
type StreamIORunner interface {
	StreamIO(ctx context.Context, cmd Cmd, stdin io.Reader, stdout, stderr io.Writer) error
}

// User is the account that owns the Project. Under sudo it is the invoking user.
type User struct {
	Name string
	Home string
	UID  int
	GID  int
}

type Deps struct {
	Version  string
	GOOS     string
	GOARCH   string
	Runner   Runner
	HTTP     *http.Client
	LookPath func(name string) (string, error)
	// Executable returns the path of the running binary.
	Executable func() (string, error)
	// Exec replaces this process with path run as argv. It returns only on
	// failure; tests replace it so nothing is exec'd.
	Exec func(path string, argv []string) error
	// CacheDir is the per-user cache directory (os.UserCacheDir).
	CacheDir    func() (string, error)
	ConfigDir   func() (string, error)
	ConfigFiles ConfigFiles
	Getenv      func(key string) string
	CurrentUser func() (User, error)
	LookupUser  func(name string) (User, error)
	Now         func() time.Time
	// Sleep waits d or until ctx ends; tests replace it with a fake clock.
	Sleep func(ctx context.Context, d time.Duration) error
	// LANIP returns the address of the interface on the default route.
	LANIP func() (string, error)
	// HostIPs returns the IPv4 addresses of this machine's active network
	// interfaces, without loopback and container bridges.
	HostIPs     func() ([]string, error)
	HomeNetwork func(ip string) bool
	// TimeZone returns the host's IANA time zone.
	TimeZone func() string
	// PortFree reports whether a TCP port can be bound on the host, tested with
	// a real bind.
	PortFree func(port int) bool
	// BindTCP tries one TCP bind and closes it immediately. Callers classify the
	// returned operating-system error without keeping the port reserved.
	BindTCP func(network, address string) error
	// BindUDP tries one UDP bind and closes it immediately.
	BindUDP          func(network, address string) error
	DiskUsage        func(path string) (DiskUsage, error)
	PathExists       func(path string) bool
	MachineResources func() (MachineResources, error)
	FileLimits       func() (FileLimits, error)
	FileSystem       func(path string) (FileSystem, error)
	// DiskFree reports the bytes available to the current user on the
	// filesystem containing path. The path itself does not need to exist.
	DiskFree func(path string) (uint64, error)
	Resolver Resolver
	// ListFolders returns the names of the folders inside dir.
	ListFolders func(dir string) ([]string, error)
	// ProcessAlive reports whether a PID belongs to a running process.
	ProcessAlive func(pid int) bool
	PID          int
	In           io.Reader
	Out          io.Writer
	Err          io.Writer
	// Interactive is true when stdin and stdout are terminals.
	Interactive bool
}
