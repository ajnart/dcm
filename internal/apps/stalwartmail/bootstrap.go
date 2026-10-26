package stalwartmail

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"time"

	"github.com/ajnart/self-host/internal/helpers"
)

const recoveryUser = "admin"

var jmapUsing = []string{"urn:ietf:params:jmap:core", "urn:stalwart:jmap"}

// login reports whether Stalwart accepts the credentials on its JMAP session.
func login(ctx context.Context, h *helpers.H, user, password string) (bool, error) {
	resp, err := h.HTTP(ctx, helpers.Request{Path: "/jmap/session", User: user, Password: password})
	if err != nil {
		return false, err
	}
	switch {
	case resp.Status == http.StatusOK:
		return true, nil
	case resp.Status == http.StatusUnauthorized || resp.Status == http.StatusForbidden:
		return false, nil
	}
	return false, fmt.Errorf("GET /jmap/session returned HTTP %d", resp.Status)
}

func jmap(ctx context.Context, h *helpers.H, user, password, method string, args map[string]any, out any) error {
	resp, err := h.Expect(ctx, helpers.Request{
		Method: http.MethodPost, Path: "/jmap", User: user, Password: password,
		JSON: map[string]any{"using": jmapUsing, "methodCalls": [][]any{{method, args, "c1"}}},
	})
	if err != nil {
		return err
	}
	var body struct {
		MethodResponses [][]json.RawMessage `json:"methodResponses"`
	}
	if err := resp.Decode(&body); err != nil {
		return err
	}
	if len(body.MethodResponses) != 1 || len(body.MethodResponses[0]) < 2 {
		return errors.New("Stalwart returned an unexpected JMAP response")
	}
	var name string
	if err := json.Unmarshal(body.MethodResponses[0][0], &name); err != nil || name == "error" {
		return fmt.Errorf("Stalwart rejected %s", method)
	}
	return json.Unmarshal(body.MethodResponses[0][1], out)
}

func waitLogin(ctx context.Context, h *helpers.H, user, password string, timeout time.Duration) error {
	return h.Poll(ctx, timeout, func(ctx context.Context) (bool, error) { return login(ctx, h, user, password) })
}

// bootstrap runs the first-run wizard headlessly. A recovery administrator is
// pinned only for this work, the generated permanent administrator is given
// the Admin login password, and the recovery credential is removed again.
func bootstrap(ctx context.Context, h *helpers.H, user, password string) error {
	if h.Config.Exec == nil {
		return fmt.Errorf("%w: this App has no headless way to create its first administrator without a container runtime", helpers.ErrManual)
	}
	recovery := h.Secret(h.Key("recovery_password"))
	if recovery == "" {
		return errors.New("the Stalwart recovery password is missing from secrets.env; reinstall the App to generate it")
	}
	tempUserKey, tempSecretKey, pinKey := h.Key("bootstrap_login"), h.Key("bootstrap_secret"), h.Key("recovery_admin")
	if h.Secret(tempSecretKey) == "" {
		if _, err := os.Stat(filepath.Join(h.Dir, "configuration", "config.json")); err == nil {
			return fmt.Errorf("%w: Stalwart's setup wizard was already completed by a person, whose administrator password is kept as it is", helpers.ErrManual)
		}
		if err := h.SetSecret(pinKey, recoveryUser+":"+recovery); err != nil {
			return err
		}
		if err := h.Up(ctx, h.Service); err != nil {
			return err
		}
		if err := waitLogin(ctx, h, recoveryUser, recovery, 2*time.Minute); err != nil {
			return fmt.Errorf("the Stalwart recovery administrator did not sign in: %w", err)
		}
		var created struct {
			Updated map[string]struct {
				Username string `json:"username"`
				Secret   string `json:"secret"`
			} `json:"updated"`
			NotUpdated map[string]struct {
				Description string `json:"description"`
			} `json:"notUpdated"`
		}
		err := jmap(ctx, h, recoveryUser, recovery, "x:Bootstrap/set", map[string]any{"update": map[string]any{"singleton": map[string]any{
			"serverHostname": h.Inputs["STALWART_HOSTNAME"], "defaultDomain": h.Inputs["STALWART_DOMAIN"],
			"requestTlsCertificate": false, "generateDkimKeys": false,
		}}}, &created)
		if err != nil {
			return err
		}
		result, ok := created.Updated["singleton"]
		if !ok || result.Secret == "" {
			return fmt.Errorf("Stalwart did not complete its setup wizard: %s", created.NotUpdated["singleton"].Description)
		}
		if err := h.SetSecret(tempSecretKey, result.Secret); err != nil {
			return err
		}
		if err := h.SetSecret(tempUserKey, result.Username); err != nil {
			return err
		}
		if err := h.Restart(ctx); err != nil {
			return err
		}
	}
	tempUser, tempSecret := h.Secret(tempUserKey), h.Secret(tempSecretKey)
	if err := waitLogin(ctx, h, tempUser, tempSecret, 2*time.Minute); err != nil {
		return fmt.Errorf("the generated Stalwart administrator did not sign in: %w", err)
	}
	if err := jmap(ctx, h, tempUser, tempSecret, "x:AccountPassword/set", map[string]any{"update": map[string]any{"singleton": map[string]any{
		"secret": password, "currentSecret": tempSecret,
	}}}, &struct{}{}); err != nil {
		return err
	}
	for _, key := range []string{pinKey, tempSecretKey, tempUserKey} {
		if err := h.SetSecret(key, ""); err != nil {
			return err
		}
	}
	if err := h.Up(ctx, h.Service); err != nil {
		return err
	}
	return waitLogin(ctx, h, user, password, 2*time.Minute)
}
