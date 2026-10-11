package paperlessngx

import (
	"context"
	"crypto/rand"
	"encoding/json"
	"fmt"
	"net/url"
	"slices"
	"strconv"

	"github.com/ajnart/self-host/internal/helpers"
)

var homarrPermissions = []string{
	"view_global_statistics",
	"view_tag",
	"view_correspondent",
	"view_documenttype",
}

type integrationUser struct {
	ID          int      `json:"id"`
	Username    string   `json:"username"`
	IsActive    bool     `json:"is_active"`
	IsStaff     bool     `json:"is_staff"`
	IsSuperuser bool     `json:"is_superuser"`
	Groups      []int    `json:"groups"`
	Permissions []string `json:"user_permissions"`
}

func homarrUser(ctx context.Context, h *helpers.H) (integrationUser, error) {
	username := h.Secret(h.Key("homarr_user"))
	resp, err := h.HTTP(ctx, helpers.Request{
		Path: "/api/users/?username=" + url.QueryEscape(username) + "&page_size=2",
		User: h.AdminUser(), Password: h.AdminPassword(),
	})
	if err != nil {
		return integrationUser{}, err
	}
	if resp.Status != 200 {
		return integrationUser{}, fmt.Errorf("Paperless-ngx account lookup returned HTTP %d", resp.Status)
	}
	var users struct {
		Results []integrationUser `json:"results"`
	}
	if err := resp.Decode(&users); err != nil {
		return integrationUser{}, err
	}
	for _, user := range users.Results {
		if user.Username == username {
			return user, nil
		}
	}
	return integrationUser{}, nil
}

func readOnlyUser(user integrationUser) bool {
	if user.ID <= 0 || !user.IsActive || user.IsStaff || user.IsSuperuser || len(user.Groups) != 0 || len(user.Permissions) != len(homarrPermissions) {
		return false
	}
	for _, permission := range homarrPermissions {
		if !slices.Contains(user.Permissions, permission) {
			return false
		}
	}
	return true
}

func accountToken(ctx context.Context, h *helpers.H) (string, error) {
	resp, err := h.HTTP(ctx, helpers.Request{
		Path: "/api/profile/", User: h.Secret(h.Key("homarr_user")), Password: h.Secret(h.Key("homarr_password")),
	})
	if err != nil {
		return "", err
	}
	if resp.Status != 200 {
		return "", fmt.Errorf("Paperless-ngx's saved Homarr account cannot sign in (HTTP %d); its password was not changed", resp.Status)
	}
	var profile struct {
		Token string `json:"auth_token"`
	}
	if err := resp.Decode(&profile); err != nil {
		return "", err
	}
	h.Log.Secret(profile.Token)
	return profile.Token, nil
}

func homarrTokenWorks(ctx context.Context, h *helpers.H) (bool, error) {
	key := h.Secret(h.Key("api_key"))
	if key == "" || h.Secret(h.Key("homarr_user")) == "" || h.Secret(h.Key("homarr_password")) == "" {
		return false, nil
	}
	user, err := homarrUser(ctx, h)
	if err != nil || !readOnlyUser(user) {
		return false, err
	}
	current, err := accountToken(ctx, h)
	if err != nil || current != key {
		return false, err
	}
	return probeHomarrToken(ctx, h, key)
}

func probeHomarrToken(ctx context.Context, h *helpers.H, key string) (bool, error) {
	if key == "" {
		return false, nil
	}
	h.Log.Secret(key)
	for _, path := range []string{"/api/statistics/", "/api/tags/?page_size=1", "/api/correspondents/?page_size=1", "/api/document_types/?page_size=1"} {
		resp, err := h.HTTP(ctx, helpers.Request{Path: path, Header: map[string]string{"Authorization": "Token " + key}})
		if err != nil {
			return false, err
		}
		if resp.Status != 200 {
			return false, fmt.Errorf("Paperless-ngx token probe %s returned HTTP %d", path, resp.Status)
		}
		var data struct {
			Total *int            `json:"documents_total"`
			Inbox json.RawMessage `json:"documents_inbox"`
			Count *int            `json:"count"`
		}
		if err := resp.Decode(&data); err != nil {
			return false, err
		}
		if path == "/api/statistics/" {
			if data.Total == nil || *data.Total < 0 || len(data.Inbox) == 0 {
				return false, fmt.Errorf("Paperless-ngx statistics omitted valid document counts")
			}
			var inbox *int
			if err := json.Unmarshal(data.Inbox, &inbox); err != nil || (inbox != nil && *inbox < 0) {
				return false, fmt.Errorf("Paperless-ngx statistics returned an invalid inbox count")
			}
		} else if data.Count == nil || *data.Count < 0 {
			return false, fmt.Errorf("Paperless-ngx token probe %s omitted a valid count", path)
		}
	}
	return true, nil
}

func ensureHomarrToken(ctx context.Context, h *helpers.H) error {
	for _, name := range []string{"homarr_user", "homarr_password"} {
		if h.Secret(h.Key(name)) == "" {
			value := rand.Text()
			if name == "homarr_user" {
				value = "self-host-homarr-" + value
			}
			if err := h.SetSecret(h.Key(name), value); err != nil {
				return err
			}
		}
	}
	user, err := homarrUser(ctx, h)
	if err != nil {
		return err
	}
	path, method := "/api/users/", "POST"
	fields := map[string]any{
		"is_active": true, "is_staff": false, "is_superuser": false,
		"groups": []int{}, "user_permissions": homarrPermissions,
	}
	if user.ID > 0 {
		if _, err := accountToken(ctx, h); err != nil {
			return err
		}
		path, method = "/api/users/"+strconv.Itoa(user.ID)+"/", "PATCH"
	} else {
		fields["username"] = h.Secret(h.Key("homarr_user"))
		fields["password"] = h.Secret(h.Key("homarr_password"))
	}
	if !readOnlyUser(user) {
		resp, err := h.HTTP(ctx, helpers.Request{Method: method, Path: path, JSON: fields, User: h.AdminUser(), Password: h.AdminPassword()})
		if err != nil {
			return err
		}
		if resp.Status != 200 && resp.Status != 201 {
			return fmt.Errorf("Paperless-ngx read-only account configuration returned HTTP %d; this requires Paperless-ngx 3.2.1's statistics permission", resp.Status)
		}
	}
	resp, err := h.HTTP(ctx, helpers.Request{Method: "POST", Path: "/api/token/", JSON: map[string]string{
		"username": h.Secret(h.Key("homarr_user")), "password": h.Secret(h.Key("homarr_password")),
	}})
	if err != nil {
		return err
	}
	if resp.Status != 200 {
		return fmt.Errorf("Paperless-ngx token discovery returned HTTP %d", resp.Status)
	}
	var token struct {
		Key string `json:"token"`
	}
	if err := resp.Decode(&token); err != nil {
		return err
	}
	h.Log.Secret(token.Key)
	ok, err := probeHomarrToken(ctx, h, token.Key)
	if err != nil {
		return err
	}
	if !ok {
		return fmt.Errorf("Paperless-ngx did not return a usable token")
	}
	return h.SetSecret(h.Key("api_key"), token.Key)
}
