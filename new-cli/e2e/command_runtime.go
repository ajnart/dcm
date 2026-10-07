package e2e

import (
	"bytes"
	"context"
	"errors"
	"os"
	"os/exec"
	"slices"
	"syscall"
	"time"
)

type commandTermination struct {
	Kind   string `json:"kind"`
	Reason string `json:"reason"`
}

// Two runners can clean up serially: each has 45s image observation, 2m
// Compose down, 1m privileged folder removal and optional 90s diagnostics.
// The remaining 90s covers bounded process waits, browser/TLS closure and IO.
const cleanupReserve = 12 * time.Minute

type result struct {
	code        int
	stdout      string
	stderr      string
	events      []event
	termination *commandTermination
}

// Captured output stays private. Context outcome takes precedence over the
// killed process's ExitError; only fixed metadata is eligible for evidence.
func executeOwnedCommand(ctx context.Context, cmd *exec.Cmd) result {
	var out, errb bytes.Buffer
	cmd.Stdout, cmd.Stderr = &out, &errb
	cmd.WaitDelay = time.Second
	cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
	cmd.Cancel = func() error {
		// The new child owns this group; kill its Docker descendants as well.
		err := syscall.Kill(-cmd.Process.Pid, syscall.SIGKILL)
		if errors.Is(err, syscall.ESRCH) {
			return os.ErrProcessDone
		}
		return err
	}
	err := cmd.Run()
	res := result{stdout: out.String(), stderr: errb.String()}
	if code, termination := commandContextOutcome(ctx.Err()); termination != nil {
		res.code, res.termination = code, termination
		return res
	}
	if err != nil {
		res.code = 1
		var exit *exec.ExitError
		if errors.As(err, &exit) && exit.ExitCode() > 0 {
			res.code = exit.ExitCode()
		}
	}
	return res
}

func commandContextOutcome(err error) (int, *commandTermination) {
	switch err {
	case context.DeadlineExceeded:
		return 124, &commandTermination{Kind: "timeout", Reason: "command deadline exceeded"}
	case context.Canceled:
		return 130, &commandTermination{Kind: "canceled", Reason: "command canceled"}
	}
	return 0, nil
}

func sweepCommandContext(deadline time.Time, hasDeadline bool) (context.Context, context.CancelFunc) {
	if hasDeadline {
		return context.WithDeadline(context.Background(), deadline.Add(-cleanupReserve))
	}
	return context.WithCancel(context.Background())
}

func sweepBudgetError(deadline time.Time, hasDeadline bool) error {
	if hasDeadline && time.Until(deadline) <= cleanupReserve {
		return errors.New("test deadline leaves no runtime budget after the 12-minute cleanup reserve; set go test -timeout 90m for catalog acceptance or -timeout 45m for Homarr functional acceptance")
	}
	return nil
}

func installCommandLimit(spec targetSpec) time.Duration {
	if slices.Contains(spec.Apps, "seafile") {
		return 15 * time.Minute
	}
	return 10 * time.Minute
}
