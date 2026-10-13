package navidrome

import (
	"context"
	"crypto/rand"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"time"

	"github.com/ajnart/self-host/internal/helpers"
)

const homarrRecovery = "Review Navidrome Users and restore the saved regular Homarr account and its default-library access through the Project secret boundary, then run self-host setup navidrome. Do not reset accounts, rotate credentials or delete data."

type loginAccount struct {
	ID       string `json:"id"`
	Username string `json:"username"`
	IsAdmin  *bool  `json:"isAdmin"`
	Token    string `json:"token"`
}

func login(ctx context.Context, h *helpers.H, user, password string) (*loginAccount, error) {
	ctx, cancel := context.WithTimeout(ctx, time.Minute)
	defer cancel()
	resp, err := h.RetryAfter(ctx, helpers.RateLimit{
		Headers: []string{"Retry-After"}, Default: 20 * time.Second, Bound: time.Minute,
	}, func(ctx context.Context) (helpers.Response, error) {
		return h.HTTP(ctx, helpers.Request{
			Method: http.MethodPost, Path: "/auth/login", NoRedirect: true,
			JSON: map[string]string{"username": user, "password": password},
		})
	})
	if err != nil {
		if ctx.Err() != nil {
			return nil, ctx.Err()
		}
		return nil, errors.New("Navidrome sign-in request failed; retry Setup")
	}
	if resp.Status == http.StatusUnauthorized {
		return nil, nil
	}
	if resp.Status != http.StatusOK {
		return nil, fmt.Errorf("Navidrome sign-in returned HTTP %d", resp.Status)
	}
	var account loginAccount
	if resp.Decode(&account) != nil {
		return nil, errors.New("Navidrome returned an invalid sign-in response")
	}
	h.Log.Secret(account.Token)
	return &account, nil
}

func nativeRequest(ctx context.Context, h *helpers.H, token, method, path string, body any) (helpers.Response, error) {
	resp, err := h.HTTP(ctx, helpers.Request{
		Method: method, Path: path, JSON: body, NoRedirect: true,
		Header: map[string]string{"X-ND-Authorization": "Bearer " + token},
	})
	if err != nil {
		if ctx.Err() != nil {
			return resp, ctx.Err()
		}
		return resp, errors.New("Navidrome account request failed; retry Setup")
	}
	return resp, nil
}

func regularAccount(ctx context.Context, h *helpers.H) (*loginAccount, error) {
	user, password := h.Secret(h.Key("homarr_username")), h.Secret(h.Key("homarr_password"))
	if user == "" || password == "" || user == h.AdminUser() {
		return nil, fmt.Errorf("%w: the regular Navidrome Homarr login is missing or selects the administrator", helpers.ErrManual)
	}
	account, err := login(ctx, h, user, password)
	if err != nil || account == nil {
		return account, err
	}
	if account.ID == "" || account.Username != user || account.IsAdmin == nil || *account.IsAdmin || account.Token == "" {
		return nil, fmt.Errorf("%w: Navidrome did not confirm the exact regular Homarr identity", helpers.ErrManual)
	}
	if saved := h.Secret(h.Key("homarr_user_id")); saved != "" && saved != account.ID {
		return nil, fmt.Errorf("%w: Navidrome Homarr account differs from its saved identity", helpers.ErrManual)
	}
	resp, err := nativeRequest(ctx, h, account.Token, http.MethodGet, "/api/user/"+url.PathEscape(account.ID), nil)
	if err != nil {
		return nil, err
	}
	var current struct {
		ID        string `json:"id"`
		Username  string `json:"userName"`
		IsAdmin   *bool  `json:"isAdmin"`
		Libraries []struct {
			ID int `json:"id"`
		} `json:"libraries"`
	}
	if resp.Status != http.StatusOK || resp.Decode(&current) != nil || current.ID != account.ID || current.Username != user || current.IsAdmin == nil || *current.IsAdmin || len(current.Libraries) == 0 {
		return nil, fmt.Errorf("%w: Navidrome did not verify the regular Homarr account and library access", helpers.ErrManual)
	}
	for _, library := range current.Libraries {
		if library.ID <= 0 {
			return nil, errors.New("Navidrome returned invalid Homarr library access")
		}
	}
	// This read is admin-only in the pinned API. Never probe a mutation here.
	resp, err = nativeRequest(ctx, h, account.Token, http.MethodGet, "/api/library", nil)
	if err != nil {
		return nil, err
	}
	if resp.Status != http.StatusForbidden {
		return nil, fmt.Errorf("%w: Navidrome did not deny Homarr administrative library access", helpers.ErrManual)
	}
	return account, nil
}

// VerifyHomarrUser checks the saved native identity and real regular-user role.
// Navidrome has no per-endpoint read-only role; personal mutations remain possible.
func VerifyHomarrUser(ctx context.Context, h *helpers.H) error {
	ctx, cancel := context.WithTimeout(ctx, time.Minute)
	defer cancel()
	if h.Secret(h.Key("homarr_user_id")) == "" {
		return fmt.Errorf("%w: Navidrome Homarr identity is missing; run self-host setup navidrome", helpers.ErrManual)
	}
	account, err := regularAccount(ctx, h)
	if err != nil {
		return err
	}
	if account == nil {
		return fmt.Errorf("%w: Navidrome rejected the saved Homarr login; restore it without rotating credentials", helpers.ErrManual)
	}
	return nil
}

func createHomarrUser(ctx context.Context, h *helpers.H) error {
	ctx, cancel := context.WithTimeout(ctx, time.Minute)
	defer cancel()
	if h.Secret(h.Key("homarr_user_id")) != "" {
		return VerifyHomarrUser(ctx, h)
	}
	user, password := h.Secret(h.Key("homarr_username")), h.Secret(h.Key("homarr_password"))
	if user != "" && password == "" {
		return fmt.Errorf("%w: Navidrome Homarr password is lost; restore it without changing accounts", helpers.ErrManual)
	}
	// Persist before creation so an interrupted response can be recovered by login.
	if password == "" {
		password = rand.Text()
		if err := h.SetSecret(h.Key("homarr_password"), password); err != nil {
			return err
		}
	}
	if user == "" {
		user = "self-host-homarr"
		if err := h.SetSecret(h.Key("homarr_username"), user); err != nil {
			return err
		}
	}
	account, err := regularAccount(ctx, h)
	if err != nil {
		return err
	}
	if account == nil {
		admin, err := login(ctx, h, h.AdminUser(), h.AdminPassword())
		if err != nil {
			return err
		}
		if admin == nil || admin.Username != h.AdminUser() || admin.IsAdmin == nil || !*admin.IsAdmin || admin.Token == "" {
			return errors.New("Navidrome did not verify the administrator for Homarr account creation")
		}
		resp, err := nativeRequest(ctx, h, admin.Token, http.MethodPost, "/api/user", map[string]any{
			"userName": user, "name": "self-host Homarr", "password": password, "isAdmin": false,
		})
		if err != nil {
			return err
		}
		if !resp.OK() {
			return fmt.Errorf("%w: Navidrome could not create its regular Homarr account (HTTP %d); preserve existing users and restore the saved credential", helpers.ErrManual, resp.Status)
		}
		var created struct {
			ID       string `json:"id"`
			Username string `json:"userName"`
			IsAdmin  *bool  `json:"isAdmin"`
		}
		if resp.Decode(&created) != nil || created.ID == "" || created.Username != user || created.IsAdmin == nil || *created.IsAdmin {
			return errors.New("Navidrome did not confirm creation of the regular Homarr account; retry Setup without changing accounts")
		}
		account, err = regularAccount(ctx, h)
		if err != nil {
			return err
		}
		if account == nil || account.ID != created.ID {
			return errors.New("Navidrome did not verify its created Homarr login")
		}
	}
	return h.SetSecret(h.Key("homarr_user_id"), account.ID)
}
