//go:build e2e

package e2e

import (
	"bufio"
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"syscall"
	"testing"
	"time"
)

const exitIncomplete = 2
const exitManual = 3

var e2eBinary string
var dockerAvailable bool
var binarySHA string
var codeHead string

func TestMain(m *testing.M) {
	if os.Getenv("SELFHOST_COMMAND_FIXTURE") == "1" {
		os.Exit(m.Run())
	}
	dockerAvailable = dockerOK()
	head := exec.Command("git", "rev-parse", "HEAD")
	if out, err := head.Output(); err == nil {
		codeHead = strings.TrimSpace(string(out))
	}
	if !dockerAvailable {
		os.Exit(m.Run())
	}
	root, err := moduleRoot()
	if err != nil {
		fmt.Fprintln(os.Stderr, "e2e:", err)
		os.Exit(1)
	}
	binDir, err := os.MkdirTemp("", "selfhost-e2e-bin-")
	if err != nil {
		fmt.Fprintln(os.Stderr, "e2e:", err)
		os.Exit(1)
	}
	e2eBinary = filepath.Join(binDir, "self-host")
	build := exec.Command("go", "build", "-buildvcs=false", "-o", e2eBinary, "./cmd/self-host")
	build.Dir = root
	build.Stdout = os.Stdout
	build.Stderr = os.Stderr
	if err := build.Run(); err != nil {
		fmt.Fprintln(os.Stderr, "e2e: building self-host:", err)
		os.RemoveAll(binDir)
		os.Exit(1)
	}
	data, err := os.ReadFile(e2eBinary)
	if err != nil {
		os.RemoveAll(binDir)
		os.Exit(1)
	}
	binarySHA = fmt.Sprintf("%x", sha256.Sum256(data))
	code := m.Run()
	os.RemoveAll(binDir)
	os.Exit(code)
}

func dockerOK() bool {
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, "docker", "info")
	return cmd.Run() == nil
}

func moduleRoot() (string, error) {
	dir, err := os.Getwd()
	if err != nil {
		return "", err
	}
	for {
		if _, err := os.Stat(filepath.Join(dir, "go.mod")); err == nil {
			return dir, nil
		}
		parent := filepath.Dir(dir)
		if parent == dir {
			return "", errors.New("go.mod not found above the working directory")
		}
		dir = parent
	}
}

type runner struct {
	fixtures               []fixtureEntry
	fixturePorts           map[string]int
	evidenceOwner          *runner
	minimumDiskBytes       uint64
	minimumExecutableBytes uint64
	commandCtx             context.Context
	teardownOK             bool
	composeCleanupFailed   bool
	restored               *runner
	t                      *testing.T
	root                   string
	storageRoot            string
	project                string
	name                   string
	target                 string
	env                    []string
	logDir                 string
	evidence               *targetEvidence
	spec                   targetSpec
	guard                  *sweepGuard
}

func newRunner(t *testing.T, guard *sweepGuard, logDirs ...string) *runner {
	t.Helper()
	minimumDiskBytes, err := minimumFreeBytes(os.Getenv("E2E_MIN_FREE_GB"))
	if err != nil {
		t.Fatal(err)
	}
	minimumExecutableBytes, err := minimumExecutableFreeBytes(os.Getenv("E2E_MIN_EXECUTABLE_FREE_GB"))
	if err != nil {
		t.Fatal(err)
	}
	root, err := os.MkdirTemp("", "selfhost-e2e-")
	if err != nil {
		t.Fatalf("temp dir: %v", err)
	}
	storageRoot := root
	if configured := os.Getenv("E2E_PROJECT_TMPDIR"); configured != "" {
		parent, validateErr := validateProjectStorageParent(configured)
		if validateErr != nil {
			os.RemoveAll(root)
			t.Fatal(validateErr)
		}
		storageRoot, err = os.MkdirTemp(parent, "selfhost-e2e-")
		if err != nil {
			os.RemoveAll(root)
			t.Fatalf("Project storage temp dir: %v", err)
		}
	}
	name := "selfhost-e2e-" + randomHex(8)
	r := &runner{
		minimumDiskBytes:       minimumDiskBytes,
		minimumExecutableBytes: minimumExecutableBytes,
		t:                      t,
		guard:                  guard,
		root:                   root,
		storageRoot:            storageRoot,
		project:                filepath.Join(storageRoot, "project"),
		name:                   name,
		target:                 "unnamed",
		logDir:                 os.Getenv("E2E_LOG_DIR"),
	}
	if len(logDirs) > 0 {
		r.logDir = logDirs[0]
	}
	guard.RegisterProject(r.project, r.name)
	commandCtx, cancelCommands := sweepCommandContext(t.Deadline())
	r.commandCtx = commandCtx
	t.Cleanup(cancelCommands)
	r.env = isolatedEnvironment(os.Environ())
	r.env = append(r.env,
		"SELF_HOST_HOME="+r.project,
		"SELF_HOST_COMPOSE_PROJECT="+name,
		"SELF_HOST_ALLOW_UNAVAILABLE=1",
	)
	if r.logDir != "" {
		os.MkdirAll(r.logDir, 0o700)
	}
	t.Cleanup(r.cleanup)
	return r
}

func validateProjectStorageParent(path string) (string, error) {
	if !filepath.IsAbs(path) || filepath.Clean(path) != path {
		return "", errors.New("E2E_PROJECT_TMPDIR must be an absolute clean path")
	}
	resolved, err := filepath.EvalSymlinks(path)
	if err != nil || resolved != path {
		return "", errors.New("E2E_PROJECT_TMPDIR must exist without symlinks")
	}
	info, err := os.Lstat(path)
	if err != nil || !info.IsDir() {
		return "", errors.New("E2E_PROJECT_TMPDIR must be an existing directory")
	}
	stat, ok := info.Sys().(*syscall.Stat_t)
	if !ok || int(stat.Uid) != os.Geteuid() {
		return "", errors.New("E2E_PROJECT_TMPDIR must be owned by the current user")
	}
	if info.Mode().Perm()&0o022 != 0 {
		return "", errors.New("E2E_PROJECT_TMPDIR must not be writable by group or others")
	}
	return path, nil
}

func randomHex(n int) string {
	b := make([]byte, (n+1)/2)
	if _, err := rand.Read(b); err != nil {
		panic(err)
	}
	return hex.EncodeToString(b)[:n]
}

func (r *runner) run(args ...string) result {
	return r.runWithTimeout(10*time.Minute, args...)
}

func (r *runner) runWithTimeout(timeout time.Duration, args ...string) result {
	if diskMutatingCommand(args) {
		r.requireLocalResources()
	}
	parent := r.commandCtx
	if parent == nil {
		parent = context.Background()
	}
	ctx, cancel := context.WithTimeout(parent, timeout)
	defer cancel()
	cmd := exec.CommandContext(ctx, e2eBinary, args...)
	cmd.Dir = r.root
	cmd.Env = r.env
	res := executeOwnedCommand(ctx, cmd)
	res.events = decodeEvents(res.stdout)
	return res
}

func decodeEvents(s string) []event {
	var out []event
	sc := bufio.NewScanner(strings.NewReader(s))
	sc.Buffer(make([]byte, 0, 64*1024), 1024*1024)
	for sc.Scan() {
		line := strings.TrimSpace(sc.Text())
		if line == "" {
			continue
		}
		var e event
		if err := json.Unmarshal([]byte(line), &e); err != nil {
			continue
		}
		if e.Event == "" {
			continue
		}
		out = append(out, e)
	}
	return out
}

func (r *runner) cleanup() {
	r.closeFixtures(true)
	defer r.closeFixtures(false)
	if r.t.Failed() {
		r.dumpDiagnostics()
	}
	cleanupErr, publicationErr := cleanupObservedOwned(func() {
		if r.evidence != nil {
			r.recordImages()
		}
	}, r.composeDownObserved, r.removeRoot, r.guard, r.project, func(cleanupErr error) error {
		r.teardownOK = cleanupErr == nil
		if r.evidence == nil {
			return nil
		}
		if cleanupErr != nil {
			r.evidence.Cleanup = "failed"
			r.recordRetainedRoots(r)
		}
		if r.restored != nil && !r.restored.teardownOK {
			r.evidence.Cleanup = "failed"
			r.recordRetainedRoots(r.restored)
		}
		if r.evidence.Cleanup != "failed" {
			r.evidence.Cleanup = "pass"
		}
		if r.t.Failed() || r.evidence.Cleanup == "failed" {
			r.evidence.Outcome = "failed"
		}
		now := time.Now().UTC()
		r.evidence.Finished = &now
		return r.writeEvidence()
	})
	if cleanupErr != nil {
		r.t.Error("owned cleanup failed; Project recovery paths retained and sweep stopped")
	}
	if publicationErr != nil {
		r.t.Error("cleanup completed; sanitized evidence publication failed")
	}
}

func (r *runner) recordRetainedRoots(source *runner) {
	for _, retained := range source.remainingOwnedRoots() {
		found := false
		for _, existing := range r.evidence.RetainedOwnedRoots {
			if existing == retained {
				found = true
				break
			}
		}
		if !found {
			r.evidence.RetainedOwnedRoots = append(r.evidence.RetainedOwnedRoots, retained)
		}
	}
	if _, err := os.Lstat(source.project); err == nil || !os.IsNotExist(err) {
		selector := ownedProjectEvidence{Project: source.project}
		if source.composeCleanupFailed {
			selector.ComposeProject = source.name
		}
		found := false
		for _, existing := range r.evidence.RetainedProjects {
			if existing == selector {
				found = true
				break
			}
		}
		if !found {
			r.evidence.RetainedProjects = append(r.evidence.RetainedProjects, selector)
		}
		if r.evidence.RetainedProject == "" {
			r.evidence.RetainedProject = source.project
			r.evidence.RetainedComposeProject = selector.ComposeProject
		}
	}
}

func (r *runner) composeDir() string {
	if _, err := os.Stat(r.project); err == nil {
		return r.project
	}
	return r.root
}

func (r *runner) composeDown() error {
	if _, err := os.Stat(filepath.Join(r.project, "compose.yml")); err != nil {
		if os.IsNotExist(err) {
			return nil
		}
		return errors.New("owned Compose path unavailable")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()
	cmd := exec.CommandContext(ctx, "docker", r.dockerArgs("compose", "-p", r.name, "down", "--volumes", "--remove-orphans")...)
	cmd.Dir = r.composeDir()
	cmd.Env = r.env
	if res := executeOwnedCommand(ctx, cmd); res.code != 0 {
		return errors.New("owned Compose cleanup failed")
	}
	return nil
}

func (r *runner) composeDownObserved() error {
	err := r.composeDown()
	r.composeCleanupFailed = err != nil
	return err
}

func (r *runner) removeRoot() error {
	roots := []string{r.storageRoot}
	if r.root != r.storageRoot {
		roots = append(roots, r.root)
	}
	var cleanupErr error
	for _, root := range roots {
		cleanupErr = errors.Join(cleanupErr, r.removeOwnedRoot(root))
	}
	return cleanupErr
}

func (r *runner) remainingOwnedRoots() []ownedRootEvidence {
	return r.remainingOwnedRootsWithStat(func(path string) error {
		_, err := os.Lstat(path)
		return err
	})
}

func (r *runner) remainingOwnedRootsWithStat(stat func(string) error) []ownedRootEvidence {
	roots := []ownedRootEvidence{{Purpose: "project-storage", Path: r.storageRoot}}
	if r.root == r.storageRoot {
		roots[0].Purpose = "project-storage-and-executable-staging"
	} else {
		roots = append(roots, ownedRootEvidence{Purpose: "executable-staging", Path: r.root})
	}
	remaining := roots[:0]
	for _, root := range roots {
		if err := stat(root.Path); err == nil || !os.IsNotExist(err) {
			remaining = append(remaining, root)
		}
	}
	return remaining
}

func (r *runner) removeOwnedRoot(root string) error {
	if info, err := os.Lstat(root); err == nil && info.Mode()&os.ModeSymlink != 0 {
		return errors.New("owned folder became a symlink; retained for recovery")
	}
	if err := os.RemoveAll(root); err == nil {
		return nil
	}
	ctx, cancel := context.WithTimeout(context.Background(), time.Minute)
	defer cancel()
	cmd := exec.CommandContext(ctx, "docker", "run", "--rm", "-v", root+":/x", "alpine", "sh", "-c", "rm -rf /x/* /x/.[!.]*")
	if res := executeOwnedCommand(ctx, cmd); res.code != 0 {
		return errors.New("owned folder cleanup failed")
	}
	if err := os.RemoveAll(root); err != nil {
		return errors.New("owned folder cleanup remained incomplete")
	}
	return nil
}

func (r *runner) dumpDiagnostics() {
	if r.logDir == "" || os.Getenv("E2E_PRIVATE_DIAGNOSTICS") != "1" {
		return
	}
	private := filepath.Join(r.logDir, "private")
	if os.MkdirAll(private, 0o700) != nil {
		return
	}
	prefix := filepath.Join(private, r.target)
	ps := r.dockerOutput(30*time.Second, "compose", "-p", r.name, "ps", "-a")
	logs := r.dockerOutput(60*time.Second, "compose", "-p", r.name, "logs", "--no-color", "--tail", "200")
	os.WriteFile(prefix+".ps.txt", []byte(ps), 0o600)
	os.WriteFile(prefix+".logs.txt", []byte(logs), 0o600)
}

func (r *runner) saveEvidence() {
	if err := r.writeEvidence(); err != nil {
		r.t.Fatal(err)
	}
}

func (r *runner) writeEvidence() error {
	if r.evidence == nil {
		return nil
	}
	r.evidence.ComposeProject = r.name
	r.evidence.Platform = runtime.GOOS + "/" + runtime.GOARCH
	data, err := json.MarshalIndent(r.evidence, "", "  ")
	if err != nil {
		return errors.New("encode evidence")
	}
	path := filepath.Join(r.logDir, evidenceName(r.spec)+".json")
	if err := os.WriteFile(path+".partial", append(data, '\n'), 0o600); err != nil {
		return errors.New("write evidence")
	}
	if err := os.Rename(path+".partial", path); err != nil {
		return errors.New("publish evidence")
	}

	return nil
}

func (r *runner) dockerOutput(timeout time.Duration, args ...string) string {
	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()
	cmd := exec.CommandContext(ctx, "docker", r.dockerArgs(args...)...)
	cmd.Dir = r.composeDir()
	cmd.Env = r.env
	res := executeOwnedCommand(ctx, cmd)
	if res.code != 0 {
		return res.stdout + res.stderr + "\n[error] owned Docker observation failed"
	}
	return res.stdout + res.stderr
}

func (r *runner) dockerArgs(args ...string) []string {
	if len(args) == 0 || args[0] != "compose" {
		return args
	}
	prefix := []string{"compose", "--project-directory", r.project, "--env-file", filepath.Join(r.project, ".env"), "--env-file", filepath.Join(r.project, "secrets.env")}
	prefix = r.fixtureOverrides(prefix)
	return append(prefix, args[1:]...)
}
