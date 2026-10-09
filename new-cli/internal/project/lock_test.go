package project

import (
	"bufio"
	"context"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"strings"
	"syscall"
	"testing"
	"time"

	"github.com/ajnart/self-host/internal/system"
)

func TestLockRetainsProjectOwnerAcrossSudoTransition(t *testing.T) {
	if os.Geteuid() != 0 {
		t.Skip("requires root to exercise a real root-to-owner transition")
	}
	root, err := os.MkdirTemp("", "selfhost-lock-owner-")
	if err != nil {
		t.Fatal(err)
	}
	defer os.RemoveAll(root)
	owner := system.User{UID: 65534, GID: 65534}
	if err := os.Chown(root, owner.UID, owner.GID); err != nil {
		t.Fatal(err)
	}
	p := &Project{Root: root, Owner: owner}
	unlock, err := p.Lock(os.Getpid(), func(int) bool { return false })
	if err != nil {
		t.Fatal(err)
	}
	defer unlock()
	info, err := os.Stat(p.Path(".lock"))
	if err != nil {
		t.Fatal(err)
	}
	stat := info.Sys().(*syscall.Stat_t)
	if stat.Uid != uint32(owner.UID) || stat.Gid != uint32(owner.GID) || info.Mode().Perm() != 0o644 {
		t.Fatalf("sudo-created lock does not belong to the Project owner: uid=%d gid=%d mode=%v", stat.Uid, stat.Gid, info.Mode().Perm())
	}
	unlock()
	// Copy the test executable into the accessible disposable directory so
	// Go's own private build directory cannot interfere with this transition.
	binary, err := os.ReadFile(os.Args[0])
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(p.Path("lock-test"), binary, 0o755); err != nil {
		t.Fatal(err)
	}
	cmd := exec.Command(p.Path("lock-test"), "-test.run=^TestLockProcessHelper$")
	cmd.Env = append(os.Environ(), "SELFHOST_LOCK_TEST_ROOT="+root, "SELFHOST_LOCK_TEST_MODE=reject")
	cmd.SysProcAttr = &syscall.SysProcAttr{Credential: &syscall.Credential{Uid: uint32(owner.UID), Gid: uint32(owner.GID)}}
	output, err := cmd.CombinedOutput()
	if err != nil || !strings.Contains(string(output), "acquired\n") {
		t.Fatalf("ordinary owner cannot reacquire sudo-created lock: %s, %v", output, err)
	}
	after, err := os.Stat(p.Path(".lock"))
	if err != nil || !os.SameFile(info, after) {
		t.Fatalf("ownership transition replaced the lock inode: %v", err)
	}
}

func TestLockRejectsSymlinksWithoutChangingTargets(t *testing.T) {
	for _, targetName := range []string{"state.json", "outside"} {
		t.Run(targetName, func(t *testing.T) {
			p := testProject(t)
			target := p.Path("state.json")
			if targetName == "outside" {
				target = t.TempDir() + "/outside.json"
			}
			original := []byte(`{"version":1,"apps":{}}`)
			if err := os.WriteFile(target, original, 0o644); err != nil {
				t.Fatal(err)
			}
			if err := os.Symlink(target, p.Path(".lock")); err != nil {
				t.Fatal(err)
			}
			unlock, err := p.Lock(os.Getpid(), func(int) bool { return false })
			if err == nil {
				unlock()
				t.Error("Project lock accepted a symlink")
			}
			data, err := os.ReadFile(target)
			if err != nil || string(data) != string(original) {
				t.Fatalf("lock operation changed the symlink target: %q, %v", data, err)
			}
			info, err := os.Lstat(p.Path(".lock"))
			if err != nil || info.Mode()&os.ModeSymlink == 0 {
				t.Fatalf("lock operation changed the symlink: %v, %v", info, err)
			}
		})
	}
}

func TestLockNamesThePathAndFixWhenUnopenable(t *testing.T) {
	if os.Geteuid() == 0 {
		t.Skip("root can open a lock regardless of its mode")
	}
	p := testProject(t)
	p.Owner.Name = "alice"
	if err := os.WriteFile(p.Path(".lock"), []byte("flock:1"), 0o000); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { os.Chmod(p.Path(".lock"), 0o600) })

	_, err := p.Lock(os.Getpid(), func(int) bool { return false })

	if err == nil {
		t.Fatal("a lock the owner cannot open must not be taken")
	}
	msg := err.Error()
	path := p.Path(".lock")
	if !strings.Contains(msg, path) {
		t.Fatalf("error does not name the lock file: %v", err)
	}
	if !strings.Contains(msg, "sudo chown alice "+path) {
		t.Fatalf("error does not give the ownership fix: %v", err)
	}
	if !strings.Contains(msg, "remove "+path+" if no self-host is running") {
		t.Fatalf("error does not say when removal is safe: %v", err)
	}
}

func TestLockRejectsNonregularFilesPromptly(t *testing.T) {
	for _, kind := range []string{"directory", "fifo"} {
		t.Run(kind, func(t *testing.T) {
			p := testProject(t)
			var err error
			if kind == "directory" {
				err = os.Mkdir(p.Path(".lock"), 0o755)
			} else {
				err = syscall.Mkfifo(p.Path(".lock"), 0o600)
			}
			if err != nil {
				t.Fatal(err)
			}
			before, err := os.Lstat(p.Path(".lock"))
			if err != nil {
				t.Fatal(err)
			}
			cmd, _, output := startLockProcess(t, p, "reject")
			result := make(chan string, 1)
			go func() {
				line, _ := output.ReadString('\n')
				result <- line
			}()
			select {
			case line := <-result:
				if line != "rejected\n" {
					t.Fatalf("nonregular lock was accepted: %q", line)
				}
			case <-time.After(time.Second):
				t.Fatal("lock blocked on a nonregular file")
			}
			if err := cmd.Wait(); err != nil {
				t.Fatal(err)
			}
			after, err := os.Lstat(p.Path(".lock"))
			if err != nil || !os.SameFile(before, after) {
				t.Fatalf("rejected lock file was replaced or removed: %v", err)
			}
		})
	}
}

func TestLockContextCancelsWaitingMutation(t *testing.T) {
	p := testProject(t)
	unlock, err := p.Lock(os.Getpid(), func(int) bool { return true })
	if err != nil {
		t.Fatal(err)
	}
	defer unlock()
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	done := make(chan error, 1)
	go func() {
		unlock, err := p.LockContext(ctx, os.Getpid(), func(int) bool { return true })
		if err == nil {
			unlock()
		}
		done <- err
	}()
	cancel()
	select {
	case err := <-done:
		if !errors.Is(err, context.Canceled) {
			t.Fatalf("want canceled waiting mutation, got %v", err)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("canceled waiter is blocked behind the current owner")
	}
}

// A subprocess holds a claim before writing its PID. Pipes make this window
// deterministic rather than relying on scheduler timing.
func TestLockNeverStealsPartialClaim(t *testing.T) {
	p := testProject(t)
	cmd, stdin, _ := startLockProcess(t, p, "partial")
	defer stdin.Close()
	unlock, err := p.Lock(os.Getpid(), func(int) bool { return false })
	if err == nil {
		unlock()
		t.Fatal("acquired a claim still owned by another process before its PID write")
	}
	var locked LockedError
	if !errors.As(err, &locked) {
		t.Fatalf("want a competing owner error, got %v", err)
	}
	stdin.Close()
	if err := cmd.Wait(); err != nil {
		t.Fatal(err)
	}
	unlock, err = p.Lock(os.Getpid(), func(int) bool { return false })
	if err != nil {
		t.Fatalf("released partial claim must be recoverable: %v", err)
	}
	unlock()
}

func TestLockRecoversDeadOwnerWithOneContendingProcess(t *testing.T) {
	p := testProject(t)
	owner, _, _ := startLockProcess(t, p, "owner")
	if err := owner.Process.Kill(); err != nil {
		t.Fatal(err)
	}
	owner.Wait()

	first, firstInput, firstOutput := startLockProcess(t, p, "contender")
	second, secondInput, secondOutput := startLockProcess(t, p, "contender")
	for _, input := range []io.WriteCloser{firstInput, secondInput} {
		if _, err := io.WriteString(input, "go\n"); err != nil {
			t.Fatal(err)
		}
	}
	acquired := 0
	for _, output := range []*bufio.Reader{firstOutput, secondOutput} {
		line, err := output.ReadString('\n')
		if err != nil {
			t.Fatal(err)
		}
		switch line {
		case "acquired\n":
			acquired++
		case "locked\n":
		default:
			t.Fatalf("unexpected contender result: %q", line)
		}
	}
	if acquired != 1 {
		t.Fatalf("stale recovery gave ownership to %d competing processes, want one", acquired)
	}
	firstInput.Close()
	secondInput.Close()
	for _, cmd := range []*exec.Cmd{first, second} {
		if err := cmd.Wait(); err != nil {
			t.Fatal(err)
		}
	}
}

func TestUnlockNeverReleasesReplacementClaim(t *testing.T) {
	p := testProject(t)
	unlock, err := p.Lock(os.Getpid(), func(int) bool { return false })
	if err != nil {
		t.Fatal(err)
	}
	defer unlock()
	// Simulate an external replacement; releasing the old claim must affect
	// only that owner, never the replacement process's claim.
	if err := os.Rename(p.Path(".lock"), p.Path(".old-lock")); err != nil {
		t.Fatal(err)
	}
	_, stdin, _ := startLockProcess(t, p, "owner")
	defer stdin.Close()
	unlock()
	unlockAgain, err := p.Lock(os.Getpid(), func(int) bool { return false })
	if err == nil {
		unlockAgain()
		t.Fatal("old owner's unlock released the replacement process's claim")
	}
}

func startLockProcess(t *testing.T, p *Project, mode string) (*exec.Cmd, io.WriteCloser, *bufio.Reader) {
	t.Helper()
	cmd := exec.Command(os.Args[0], "-test.run=^TestLockProcessHelper$")
	cmd.Env = append(os.Environ(), "SELFHOST_LOCK_TEST_ROOT="+p.Root, "SELFHOST_LOCK_TEST_MODE="+mode)
	stdin, err := cmd.StdinPipe()
	if err != nil {
		t.Fatal(err)
	}
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		t.Fatal(err)
	}
	cmd.Stderr = os.Stderr
	if err := cmd.Start(); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		stdin.Close()
		if cmd.ProcessState == nil {
			cmd.Process.Kill()
			cmd.Wait()
		}
	})
	reader := bufio.NewReader(stdout)
	line, err := reader.ReadString('\n')
	if err != nil || line != "ready\n" {
		t.Fatalf("lock subprocess not ready: %q, %v", line, err)
	}
	return cmd, stdin, reader
}

func TestLockProcessHelper(t *testing.T) {
	root := os.Getenv("SELFHOST_LOCK_TEST_ROOT")
	if root == "" {
		return
	}
	p := &Project{Root: root}
	switch os.Getenv("SELFHOST_LOCK_TEST_MODE") {
	case "reject":
		fmt.Println("ready")
		unlock, err := p.Lock(os.Getpid(), func(int) bool { return false })
		if err == nil {
			unlock()
			fmt.Println("acquired")
		} else {
			fmt.Println("rejected")
		}
		return
	case "partial":
		f, err := os.OpenFile(p.Path(".lock"), os.O_CREATE|os.O_RDWR, 0o644)
		if err != nil {
			t.Fatal(err)
		}
		defer f.Close()
		if err := syscall.Flock(int(f.Fd()), syscall.LOCK_EX); err != nil {
			t.Fatal(err)
		}
	case "owner":
		unlock, err := p.Lock(os.Getpid(), func(int) bool { return false })
		if err != nil {
			t.Fatal(err)
		}
		defer unlock()
	case "contender":
		fmt.Println("ready")
		input := bufio.NewReader(os.Stdin)
		if _, err := input.ReadString('\n'); err != nil {
			t.Fatal(err)
		}
		// A PID may have been reused after the killed owner exited; process
		// liveness must not override the released kernel claim.
		unlock, err := p.Lock(os.Getpid(), func(int) bool { return true })
		if err != nil {
			var locked LockedError
			if !errors.As(err, &locked) {
				t.Fatal(err)
			}
			fmt.Println("locked")
			return
		}
		defer unlock()
		fmt.Println("acquired")
		io.Copy(io.Discard, input)
		return
	default:
		t.Fatal("unknown subprocess mode")
	}
	fmt.Println("ready")
	io.Copy(io.Discard, os.Stdin)
}
