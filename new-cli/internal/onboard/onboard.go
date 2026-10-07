// Package onboard holds Setup helpers shared by App kinds whose onboarding
// follows one pattern: Apps with no account at all, and Apps whose first
// administrator is created by a person in the web UI.
package onboard

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/ajnart/self-host/internal/helpers"
)

const (
	KindNoAccount        = "no-account"
	KindManualFirstAdmin = "manual-first-admin"
)

// Kinds lists the onboarding kinds that have a helper.
func Kinds() []string { return []string{KindManualFirstAdmin, KindNoAccount} }

// Probe proves an App answers on an HTTP path.
type Probe struct {
	Path     string
	Want     []int
	Contains string
	Timeout  time.Duration
}

func (p Probe) path() string {
	if p.Path == "" {
		return "/"
	}
	return p.Path
}

func (p Probe) timeout() time.Duration {
	if p.Timeout == 0 {
		return 2 * time.Minute
	}
	return p.Timeout
}

func (p Probe) wanted(status int) bool {
	if len(p.Want) == 0 {
		return status >= 200 && status < 300
	}
	for _, want := range p.Want {
		if status == want {
			return true
		}
	}
	return false
}

func (p Probe) attempt(ctx context.Context, h *helpers.H) (bool, error) {
	resp, err := h.HTTP(ctx, helpers.Request{Path: p.path()})
	if err != nil {
		return false, err
	}
	if !p.wanted(resp.Status) {
		return false, fmt.Errorf("HTTP %d", resp.Status)
	}
	if p.Contains != "" && !strings.Contains(string(resp.Body), p.Contains) {
		return false, fmt.Errorf("the response did not contain %q", p.Contains)
	}
	return true, nil
}

func (p Probe) step(ctx context.Context, h *helpers.H) error {
	path := p.path()
	return h.Step(ctx, "ready", "wait for "+h.App+" to answer on "+path, helpers.StepSpec{
		Check: func(ctx context.Context) (bool, error) { return p.attempt(ctx, h) },
		Do: func(ctx context.Context) error {
			return h.Poll(ctx, p.timeout(), func(ctx context.Context) (bool, error) {
				return p.attempt(ctx, h)
			})
		},
		Hint: h.App + " did not answer on " + path + "; read its logs with: self-host logs " + h.App,
	})
}

// NoAccount is the helper for Apps with no login: Setup only proves the App
// serves.
type NoAccount struct{ Probe Probe }

func (n NoAccount) Setup(ctx context.Context, h *helpers.H) error {
	return n.Probe.step(ctx, h)
}

func (n NoAccount) Check(ctx context.Context, h *helpers.H) error {
	ok, err := n.Probe.attempt(ctx, h)
	if err != nil {
		return err
	}
	if !ok {
		return fmt.Errorf("%s did not answer on %s", h.App, n.Probe.path())
	}
	return nil
}

// FirstAdmin is the helper for Apps that start with no administrator and
// where the first visitor normally creates one.
type FirstAdmin struct {
	Ready Probe
	// Username resolves an App-specific administrator name. Setup resolves it
	// after readiness; nil uses the shared Admin login username.
	Username func(context.Context, *helpers.H) (string, error)
	// Exists reports whether the App already has an administrator.
	Exists func(ctx context.Context, h *helpers.H) (bool, error)
	// Create makes the first administrator with the Admin login. Nil means the
	// App has no headless way to do it, and a person must use its web UI.
	Create func(ctx context.Context, h *helpers.H, user, password string) error
	// Login reports whether user/password can sign in.
	Login func(ctx context.Context, h *helpers.H, user, password string) (bool, error)
	// Valid rejects an Admin login the App would refuse (length, characters).
	Valid func(user, password string) error
	// Manual says what to do in the web UI, e.g. "open Settings › Users".
	Manual string
}

func (f FirstAdmin) Setup(ctx context.Context, h *helpers.H) error {
	if err := f.Ready.step(ctx, h); err != nil {
		return err
	}
	return f.admin(ctx, h)
}

func (f FirstAdmin) admin(ctx context.Context, h *helpers.H) error {
	user, err := f.username(ctx, h)
	if err != nil {
		return err
	}
	password := h.AdminPassword()
	return h.Step(ctx, "admin", "create the administrator "+user, helpers.StepSpec{
		Check: func(ctx context.Context) (bool, error) { return f.signIn(ctx, h, user, password) },
		Do: func(ctx context.Context) error {
			if f.Valid != nil {
				if err := f.Valid(user, password); err != nil {
					return err
				}
			}
			if f.Exists != nil {
				exists, err := f.Exists(ctx, h)
				if err != nil {
					return err
				}
				if exists {
					return errors.New("an administrator already exists and the Admin login does not sign in")
				}
			}
			if f.Create == nil {
				return errors.New("this App has no headless way to create its first administrator")
			}
			return f.Create(ctx, h, user, password)
		},
		Hint:       f.hint(h, user),
		Credential: "admin",
	})
}

func (f FirstAdmin) username(ctx context.Context, h *helpers.H) (string, error) {
	if f.Username != nil {
		return f.Username(ctx, h)
	}
	return h.AdminUser(), nil
}

func (f FirstAdmin) signIn(ctx context.Context, h *helpers.H, user, password string) (bool, error) {
	if f.Login == nil {
		return false, errors.New("this App has no headless way to verify its administrator login")
	}
	return f.Login(ctx, h, user, password)
}

func (f FirstAdmin) hint(h *helpers.H, user string) string {
	hint := "Open " + h.URL + ", create the administrator " + user +
		" with the password shown by `self-host credentials`"
	if f.Manual != "" {
		hint += "; " + f.Manual
	}
	return hint + ", then run: self-host setup " + h.App
}

func (f FirstAdmin) Check(ctx context.Context, h *helpers.H) error {
	user, err := f.username(ctx, h)
	if err != nil {
		return err
	}
	password := h.AdminPassword()
	ok, err := f.signIn(ctx, h, user, password)
	if err != nil {
		return fmt.Errorf("admin login failed: %w", err)
	}
	if !ok {
		return fmt.Errorf("the Admin login cannot sign in to %s", h.App)
	}
	return nil
}
