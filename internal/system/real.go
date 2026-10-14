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
	"slices"
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

func (execRunner) StreamIO(ctx context.Context, cmd Cmd, stdin io.Reader, stdout, stderr io.Writer) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	c := command(ctx, cmd)
	if stdin != nil {
		c.Stdin = stdin
	}
	c.Stdout, c.Stderr = stdout, stderr
	err := c.Run()
	if ctx.Err() != nil {
		return ctx.Err()
	}
	return err
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
	dirs := userDirs{goos: runtime.GOOS, getenv: os.Getenv, current: currentUser, lookup: lookupUser}
	return &Deps{
		Version:          version,
		GOOS:             runtime.GOOS,
		GOARCH:           runtime.GOARCH,
		Runner:           execRunner{},
		HTTP:             &http.Client{Timeout: 30 * time.Second},
		LookPath:         exec.LookPath,
		Executable:       os.Executable,
		Exec:             func(path string, argv []string) error { return syscall.Exec(path, argv, os.Environ()) },
		CacheDir:         dirs.cache,
		ConfigDir:        dirs.config,
		ChownOwned:       dirs.chown,
		Getenv:           os.Getenv,
		CurrentUser:      currentUser,
		LookupUser:       lookupUser,
		Now:              time.Now,
		Sleep:            sleep,
		LANIP:            lanIP,
		HostIPs:          hostIPs,
		HomeNetwork:      homeNetwork,
		TimeZone:         timeZone,
		BindTCP:          bindTCP,
		BindUDP:          bindUDP,
		DiskUsage:        diskUsage,
		PathExists:       pathExists,
		MachineResources: machineResources,
		FileLimits:       fileLimits,
		FileSystem:       fileSystem,
		Resolver:         newResolver(),
		ListFolders:      ListFolders,
		ProcessAlive:     processAlive,
		PID:              os.Getpid(),
		In:               os.Stdin,
		Out:              os.Stdout,
		Err:              os.Stderr,
		Interactive:      isTerminal(os.Stdin) && isTerminal(os.Stdout),
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

// Container runtimes add bridges whose addresses other devices cannot reach.
var bridgePrefixes = []string{"docker", "br-", "veth", "virbr", "cni", "flannel", "cali", "podman", "lxc"}

func hostIPs() ([]string, error) {
	ifaces, err := net.Interfaces()
	if err != nil {
		return nil, err
	}
	var ips []string
	for _, iface := range ifaces {
		if iface.Flags&net.FlagUp == 0 || iface.Flags&net.FlagLoopback != 0 || slices.ContainsFunc(bridgePrefixes, func(p string) bool {
			return strings.HasPrefix(iface.Name, p)
		}) {
			continue
		}
		addrs, err := iface.Addrs()
		if err != nil {
			continue
		}
		for _, addr := range addrs {
			if ipNet, ok := addr.(*net.IPNet); ok && ipNet.IP.To4() != nil && !ipNet.IP.IsLinkLocalUnicast() {
				ips = append(ips, ipNet.IP.String())
			}
		}
	}
	return ips, nil
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

func homeNetwork(ip string) bool {
	ifaces, err := net.Interfaces()
	if err != nil {
		return false
	}
	for _, iface := range ifaces {
		if iface.Flags&net.FlagUp == 0 || iface.Flags&net.FlagBroadcast == 0 || iface.Flags&(net.FlagLoopback|net.FlagPointToPoint) != 0 || slices.ContainsFunc(bridgePrefixes, func(prefix string) bool { return strings.HasPrefix(iface.Name, prefix) }) {
			continue
		}
		addresses, err := iface.Addrs()
		if err != nil {
			continue
		}
		for _, address := range addresses {
			if network, ok := address.(*net.IPNet); ok && network.IP.String() == ip {
				ones, bits := network.Mask.Size()
				return bits == 32 && ones > 0 && ones < 32
			}
		}
	}
	return false
}

func bindTCP(network, address string) error {
	listener, err := net.Listen(network, address)
	if err != nil {
		return err
	}
	return listener.Close()
}

func bindUDP(network, address string) error {
	listener, err := net.ListenPacket(network, address)
	if err != nil {
		return err
	}
	return listener.Close()
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

func sleep(ctx context.Context, d time.Duration) error {
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-time.After(d):
		return nil
	}
}
