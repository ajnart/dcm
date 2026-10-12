package immich

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"slices"

	"github.com/ajnart/self-host/internal/helpers"
)

const homarrKeyName = "self-host Homarr statistics"

func homarrPermissions() []string { return []string{"user.read", "server.statistics"} }

type apiKey struct {
	ID          string   `json:"id"`
	Name        string   `json:"name"`
	Permissions []string `json:"permissions"`
}

func homarrKeyWorks(ctx context.Context, h *helpers.H) (bool, error) {
	key := h.Secret(h.Key("homarr_api_key"))
	if key == "" {
		return false, nil
	}
	resp, err := h.HTTP(ctx, helpers.Request{Path: "/api/api-keys/me", NoRedirect: true, Header: map[string]string{"x-api-key": key}})
	if err != nil {
		return false, err
	}
	if resp.Status == http.StatusUnauthorized || resp.Status == http.StatusForbidden {
		return false, nil
	}
	if resp.Status != http.StatusOK {
		return false, fmt.Errorf("Immich key verification returned HTTP %d", resp.Status)
	}
	var current apiKey
	if err := resp.Decode(&current); err != nil {
		return false, err
	}
	permissions := homarrPermissions()
	if current.ID == "" || len(current.Permissions) != len(permissions) {
		return false, errors.New("Immich Homarr key must grant only user.read and server.statistics")
	}
	for _, permission := range permissions {
		if !slices.Contains(current.Permissions, permission) {
			return false, errors.New("Immich Homarr key is missing its read-only statistics permissions")
		}
	}
	if err := VerifyHomarr(ctx, h); err != nil {
		return false, err
	}
	return true, nil
}

func VerifyHomarr(ctx context.Context, h *helpers.H) error {
	key := h.Secret(h.Key("homarr_api_key"))
	if key == "" {
		return errors.New("Immich Homarr credential is missing; run self-host setup immich")
	}
	header := map[string]string{"x-api-key": key}
	resp, err := h.HTTP(ctx, helpers.Request{Path: "/api/users/me", NoRedirect: true, Header: header})
	if err != nil {
		return err
	}
	if resp.Status != http.StatusOK {
		return fmt.Errorf("Immich Homarr credential returned HTTP %d; run self-host setup immich", resp.Status)
	}
	var user struct {
		Email   string `json:"email"`
		IsAdmin bool   `json:"isAdmin"`
	}
	if err := resp.Decode(&user); err != nil {
		return err
	}
	if user.Email != email || !user.IsAdmin {
		return errors.New("Immich Homarr credential does not belong to the Project administrator")
	}
	resp, err = h.HTTP(ctx, helpers.Request{Path: "/api/server/statistics", NoRedirect: true, Header: header})
	if err != nil {
		return err
	}
	if resp.Status != http.StatusOK {
		return fmt.Errorf("Immich statistics returned HTTP %d; run self-host setup immich", resp.Status)
	}
	var statistics struct {
		Photos *int64 `json:"photos"`
		Videos *int64 `json:"videos"`
		Usage  *int64 `json:"usage"`
	}
	if resp.Decode(&statistics) != nil || statistics.Photos == nil || statistics.Videos == nil || statistics.Usage == nil || *statistics.Photos < 0 || *statistics.Videos < 0 || *statistics.Usage < 0 {
		return errors.New("Immich returned incomplete server statistics")
	}
	resp, err = h.HTTP(ctx, helpers.Request{Path: "/api/users", NoRedirect: true, Header: header})
	if err != nil {
		return err
	}
	if resp.Status != http.StatusOK {
		return fmt.Errorf("Immich users returned HTTP %d", resp.Status)
	}
	var users []struct{ ID string }
	if resp.Decode(&users) != nil || len(users) == 0 {
		return errors.New("Immich did not return its administrator in the statistics user list")
	}
	return nil
}

func createHomarrKey(ctx context.Context, h *helpers.H) error {
	if ok, err := homarrKeyWorks(ctx, h); err != nil || ok {
		return err
	}
	resp, err := h.HTTP(ctx, helpers.Request{
		Method: http.MethodPost, Path: "/api/auth/login", NoRedirect: true,
		JSON: map[string]string{"email": email, "password": h.AdminPassword()},
	})
	if err != nil {
		return err
	}
	var login struct {
		AccessToken string `json:"accessToken"`
		UserEmail   string `json:"userEmail"`
		IsAdmin     bool   `json:"isAdmin"`
	}
	if !resp.OK() || resp.Decode(&login) != nil || login.AccessToken == "" || login.UserEmail != email || !login.IsAdmin {
		return errors.New("cannot sign in to Immich to prepare its Homarr key")
	}
	h.Log.Secret(login.AccessToken)
	header := map[string]string{"Authorization": "Bearer " + login.AccessToken}
	resp, err = h.HTTP(ctx, helpers.Request{Path: "/api/api-keys", NoRedirect: true, Header: header})
	if err != nil {
		return err
	}
	if resp.Status != http.StatusOK {
		return fmt.Errorf("Immich API-key discovery returned HTTP %d", resp.Status)
	}
	var keys []apiKey
	if err := resp.Decode(&keys); err != nil {
		return err
	}
	for _, key := range keys {
		if key.Name == homarrKeyName || key.ID == h.Secret(h.Key("homarr_api_key_id")) {
			return helpers.ErrManual
		}
	}
	resp, err = h.HTTP(ctx, helpers.Request{
		Method: http.MethodPost, Path: "/api/api-keys", NoRedirect: true, Header: header,
		JSON: map[string]any{"name": homarrKeyName, "permissions": homarrPermissions()},
	})
	if err != nil {
		return err
	}
	if resp.Status != http.StatusCreated {
		return fmt.Errorf("Immich API-key creation returned HTTP %d", resp.Status)
	}
	var created struct {
		ID     string `json:"id"`
		Secret string `json:"secret"`
		APIKey apiKey `json:"apiKey"`
	}
	if resp.Decode(&created) != nil || created.Secret == "" {
		return errors.New("Immich did not return the newly created key; inspect its API keys before retrying")
	}
	if err := h.SetSecret(h.Key("homarr_api_key"), created.Secret); err != nil {
		return err
	}
	if created.ID == "" {
		created.ID = created.APIKey.ID
	}
	if created.ID == "" {
		return errors.New("Immich did not return the newly created key ID")
	}
	return h.SetSecret(h.Key("homarr_api_key_id"), created.ID)
}
