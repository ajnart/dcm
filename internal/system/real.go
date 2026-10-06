package system

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"os/exec"
	"os/user"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"syscall"
	"time"
)

type execRunner struct{}

func (execRunner) Run(ctx context.Context, cmd Cmd) (Result, error) {
	c := command(ctx, cmd)
	var stdout, stderr bytes.Buffer
	c.Stdout, c.Stderr = &stdout, &stderr
	err := c.Run()
	result := Result{Stdout: stdout.Bytes(), Stderr: stderr.Bytes()}
	var exitErr *exec.ExitError
	if errors.As(err, &exitErr) {
		result.ExitCode = exitErr.ExitCode()
		return result, nil
	}
	return result, err
}

func (execRunner) Stream(ctx context.Context, cmd Cmd, w io.Writer) error {
	c := command(ctx, cmd)
	c.Stdout, c.Stderr = w, w
	return c.Run()
}

func command(ctx context.Context, cmd Cmd) *exec.Cmd {
	c := exec.CommandContext(ctx, cmd.Name, cmd.Args...)
	c.Dir = cmd.Dir
	if len(cmd.Env) > 0 {
		c.Env = append(os.Environ(), cmd.Env...)
	}
	if cmd.Stdin != nil {
		c.Stdin = bytes.NewReader(cmd.Stdin)
	}
	return c
}

// Real returns production dependencies.
func Real(version string) *Deps {
	return &Deps{
		Version:      version,
		GOOS:         runtime.GOOS,
		GOARCH:       runtime.GOARCH,
		Runner:       execRunner{},
		HTTP:         &http.Client{Timeout: 30 * time.Second},
		LookPath:     exec.LookPath,
		Executable:   os.Executable,
		Getenv:       os.Getenv,
		CurrentUser:  currentUser,
		LookupUser:   lookupUser,
		Now:          time.Now,
		LANIP:        lanIP,
		TimeZone:     timeZone,
		PortFree:     portFree,
		ProcessAlive: processAlive,
		PID:          os.Getpid(),
		In:           os.Stdin,
		Out:          os.Stdout,
		Err:          os.Stderr,
		Interactive:  isTerminal(os.Stdin) && isTerminal(os.Stdout),
	}
}

func toUser(u *user.User) (User, error) {
	uid, err := strconv.Atoi(u.Uid)
	if err != nil {
		return User{}, fmt.Errorf("user %s has non-numeric uid %q", u.Username, u.Uid)
	}
	gid, err := strconv.Atoi(u.Gid)
	if err != nil {
		return User{}, fmt.Errorf("user %s has non-numeric gid %q", u.Username, u.Gid)
	}
	return User{Name: u.Username, Home: u.HomeDir, UID: uid, GID: gid}, nil
}

func currentUser() (User, error) {
	u, err := user.Current()
	if err != nil {
		return User{}, err
	}
	return toUser(u)
}

func lookupUser(name string) (User, error) {
	u, err := user.Lookup(name)
	if err != nil {
		return User{}, err
	}
	return toUser(u)
}

// lanIP uses a UDP "connection" to learn which local address the default
// route would use. No packet is sent.
func lanIP() (string, error) {
	conn, err := net.Dial("udp", "192.0.2.1:9")
	if err != nil {
		return "", err
	}
	defer conn.Close()
	return conn.LocalAddr().(*net.UDPAddr).IP.String(), nil
}

func timeZone() string {
	if tz := os.Getenv("TZ"); tz != "" {
		return tz
	}
	if target, err := os.Readlink("/etc/localtime"); err == nil {
		if _, zone, found := strings.Cut(target, "zoneinfo/"); found {
			return zone
		}
	}
	if data, err := os.ReadFile("/etc/timezone"); err == nil {
		if zone := strings.TrimSpace(string(data)); zone != "" {
			return zone
		}
	}
	return "UTC"
}

func portFree(port int) bool {
	listener, err := net.Listen("tcp", ":"+strconv.Itoa(port))
	if err != nil {
		return false
	}
	listener.Close()
	return true
}

func processAlive(pid int) bool {
	process, err := os.FindProcess(pid)
	if err != nil {
		return false
	}
	err = process.Signal(syscall.Signal(0))
	return err == nil || errors.Is(err, syscall.EPERM)
}

func isTerminal(f *os.File) bool {
	info, err := f.Stat()
	return err == nil && info.Mode()&os.ModeCharDevice != 0
}

// ExpandHome resolves a leading ~ against home.
func ExpandHome(path, home string) string {
	if path == "~" {
		return home
	}
	if strings.HasPrefix(path, "~/") {
		return filepath.Join(home, path[2:])
	}
	return path
}
