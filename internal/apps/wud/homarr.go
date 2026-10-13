package wud

import (
	"context"
	"crypto/rand"
	"errors"
	"fmt"
	"net/http"

	"github.com/ajnart/self-host/internal/helpers"
)

const homarrUsername = "self-host-homarr"
const homarrHint = "Review the dedicated self-host-homarr local Read Only user in WUD Configuration > Users. Restore its saved credentials and ownership from a Backup if missing or rejected; no existing account, password or role is replaced. Retry self-host setup wud, then self-host setup homarr. An uncertain account creation remains Manual; inspect that account before recovery."

func homarrManual() error {
	return fmt.Errorf("%w: %s", helpers.ErrManual, homarrHint)
}

// VerifyHomarrReader uses only the selected dedicated credential, including a
// read-only request to an administrator-only API. It never probes a mutation.
func VerifyHomarrReader(ctx context.Context, h *helpers.H) error {
	username := h.Secret(h.Key("homarr_username"))
	password := h.Secret(h.Key("homarr_password"))
	id := h.Secret(h.Key("homarr_user_id"))
	if username == "" || password == "" || id == "" || username == h.AdminUser() {
		return homarrManual()
	}
	response, err := h.HTTP(ctx, helpers.Request{Path: "/auth/user", NoRedirect: true, User: username, Password: password})
	if err != nil {
		return errors.New("WUD reader identity request failed; retry self-host setup wud")
	}
	var current identity
	if response.Status != http.StatusOK || response.Decode(&current) != nil || current.ID != id || current.Username != username || current.Role != "ro" || current.Provider != "local" {
		return homarrManual()
	}
	response, err = h.HTTP(ctx, helpers.Request{Path: "/api/users", NoRedirect: true, User: username, Password: password})
	if err != nil {
		return errors.New("WUD reader permission verification failed; retry self-host setup wud")
	}
	if response.Status != http.StatusForbidden {
		return homarrManual()
	}
	return nil
}

func setupHomarrReader(ctx context.Context, h *helpers.H) error {
	return h.Step(ctx, "homarr-reader", "prepare a dedicated read-only WUD login for Homarr", helpers.StepSpec{
		Check: func(ctx context.Context) (bool, error) { err := VerifyHomarrReader(ctx, h); return err == nil, err },
		Do:    func(ctx context.Context) error { return createHomarrReader(ctx, h) },
		Hint:  homarrHint,
	})
}

func createHomarrReader(ctx context.Context, h *helpers.H) error {
	// Complete recorded credentials are reused; partial/uncertain records are
	// recovery boundaries, never permission to rotate or adopt a named account.
	for _, key := range []string{"homarr_username", "homarr_password", "homarr_user_id", "homarr_pending"} {
		if h.Secret(h.Key(key)) != "" {
			return VerifyHomarrReader(ctx, h)
		}
	}
	if ok, err := adminWorks(ctx, h); err != nil || !ok {
		return errors.New("WUD administrator verification failed; retry self-host setup wud")
	}
	response, err := h.HTTP(ctx, helpers.Request{Path: "/api/users", NoRedirect: true, User: h.AdminUser(), Password: h.AdminPassword()})
	if err != nil {
		return errors.New("WUD user discovery failed; retry self-host setup wud")
	}
	var users []identity
	if response.Status != http.StatusOK || response.Decode(&users) != nil || users == nil {
		return errors.New("WUD did not return its local user inventory; retry self-host setup wud")
	}
	for _, user := range users {
		if user.Username == homarrUsername {
			return homarrManual()
		}
	}
	password := rand.Text()
	// Persist the exact creation intent before the HTTP mutation. A failed or
	// ambiguous response cannot lead the next invocation to issue another POST.
	for _, entry := range []struct{ key, value string }{{"homarr_username", homarrUsername}, {"homarr_password", password}, {"homarr_pending", "true"}} {
		if err := h.SetSecret(h.Key(entry.key), entry.value); err != nil {
			return err
		}
	}
	response, err = h.HTTP(ctx, helpers.Request{Method: http.MethodPost, Path: "/api/users", NoRedirect: true, User: h.AdminUser(), Password: h.AdminPassword(), JSON: map[string]string{"username": homarrUsername, "password": password, "role": "ro"}})
	if err != nil {
		return homarrManual()
	}
	var created identity
	if response.Status != http.StatusCreated || response.Decode(&created) != nil || created.ID == "" || created.Username != homarrUsername || created.Role != "ro" || created.Provider != "local" {
		return homarrManual()
	}
	if err := h.SetSecret(h.Key("homarr_user_id"), created.ID); err != nil {
		return err
	}
	if err := h.SetSecret(h.Key("homarr_pending"), ""); err != nil {
		return err
	}
	return VerifyHomarrReader(ctx, h)
}
