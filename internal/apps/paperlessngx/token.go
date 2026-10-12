package paperlessngx

import (
	"context"
	"crypto/rand"
	"encoding/json"
	"fmt"
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
	ID           int      `json:"id"`
	Username     string   `json:"username"`
	Owner        *string  `json:"first_name"`
	IsActive     *bool    `json:"is_active"`
	IsStaff      *bool    `json:"is_staff"`
	IsSuperuser  *bool    `json:"is_superuser"`
	IsMFAEnabled *bool    `json:"is_mfa_enabled"`
	Groups       []int    `json:"groups"`
	Permissions  []string `json:"user_permissions"`
}

type homarrAccount struct {
	ID    int    `json:"id"`
	Owner string `json:"owner"`
}

func accountRecovery(h *helpers.H, reason string) error {
	h.Info(reason)
	return fmt.Errorf("%w: %s", helpers.ErrManual, reason)
}

func validIntegrationUser(user integrationUser) bool {
	return user.ID > 0 && user.Username != "" && user.Owner != nil &&
		user.IsActive != nil && user.IsStaff != nil && user.IsSuperuser != nil &&
		user.IsMFAEnabled != nil && user.Groups != nil && user.Permissions != nil
}

func homarrUser(ctx context.Context, h *helpers.H) (integrationUser, error) {
	var account homarrAccount
	if err := json.Unmarshal([]byte(h.Secret(h.Key("homarr_account"))), &account); err != nil || account.ID <= 0 || account.Owner == "" {
		return integrationUser{}, accountRecovery(h, "Paperless-ngx's Homarr account identity is missing, pending or uncertain; existing accounts and credentials were preserved")
	}
	h.Log.Secret(account.Owner)
	resp, err := h.HTTP(ctx, helpers.Request{
		Path: "/api/users/" + strconv.Itoa(account.ID) + "/",
		User: h.AdminUser(), Password: h.AdminPassword(),
	})
	if err != nil {
		return integrationUser{}, err
	}
	if resp.Status == 401 || resp.Status == 403 || resp.Status == 404 {
		return integrationUser{}, accountRecovery(h, fmt.Sprintf("Paperless-ngx's recorded Homarr account ID %d cannot be inspected (HTTP %d); no replacement was created", account.ID, resp.Status))
	}
	if resp.Status != 200 {
		return integrationUser{}, fmt.Errorf("Paperless-ngx account lookup returned HTTP %d", resp.Status)
	}
	var user integrationUser
	if err := resp.Decode(&user); err != nil {
		return integrationUser{}, err
	}
	if !validIntegrationUser(user) {
		return integrationUser{}, fmt.Errorf("Paperless-ngx account lookup omitted required account fields")
	}
	if user.ID != account.ID || *user.Owner != account.Owner || user.Username == h.AdminUser() || *user.IsStaff || *user.IsSuperuser {
		return integrationUser{}, accountRecovery(h, "Paperless-ngx's recorded Homarr account no longer has verified non-administrator ownership; its permissions and credentials were preserved")
	}
	if !*user.IsActive || *user.IsMFAEnabled {
		return integrationUser{}, accountRecovery(h, "Paperless-ngx's owned Homarr account is disabled or requires MFA; Setup will not reactivate it or disable MFA")
	}
	return user, nil
}

func readOnlyUser(user integrationUser) bool {
	if !validIntegrationUser(user) || !*user.IsActive || *user.IsStaff || *user.IsSuperuser || *user.IsMFAEnabled || len(user.Groups) != 0 || len(user.Permissions) != len(homarrPermissions) {
		return false
	}
	for _, permission := range homarrPermissions {
		if !slices.Contains(user.Permissions, permission) {
			return false
		}
	}
	return true
}

func accountToken(ctx context.Context, h *helpers.H, user integrationUser, key string) (string, error) {
	req := helpers.Request{Path: "/api/profile/"}
	if key == "" {
		req.User, req.Password = user.Username, h.Secret(h.Key("homarr_password"))
		if req.Password == "" {
			return "", accountRecovery(h, "Paperless-ngx's owned Homarr account has no saved password; restore its verified Project credentials before retrying")
		}
	} else {
		h.Log.Secret(key)
		req.Header = map[string]string{"Authorization": "Token " + key}
	}
	resp, err := h.HTTP(ctx, req)
	if err != nil {
		return "", err
	}
	if resp.Status == 401 || resp.Status == 403 {
		return "", accountRecovery(h, fmt.Sprintf("Paperless-ngx's owned Homarr credential cannot sign in (HTTP %d); restore the same account's known login through official account controls", resp.Status))
	}
	if resp.Status != 200 {
		return "", fmt.Errorf("Paperless-ngx profile returned HTTP %d", resp.Status)
	}
	var profile struct {
		Token             json.RawMessage `json:"auth_token"`
		Owner             *string         `json:"first_name"`
		IsMFAEnabled      *bool           `json:"is_mfa_enabled"`
		HasUsablePassword *bool           `json:"has_usable_password"`
	}
	if err := resp.Decode(&profile); err != nil {
		return "", err
	}
	if profile.Owner == nil || profile.IsMFAEnabled == nil || profile.HasUsablePassword == nil || len(profile.Token) == 0 {
		return "", fmt.Errorf("Paperless-ngx profile omitted required credential fields")
	}
	var token *string
	if err := json.Unmarshal(profile.Token, &token); err != nil {
		return "", fmt.Errorf("Paperless-ngx profile returned an invalid token field")
	}
	if *profile.Owner != *user.Owner {
		return "", accountRecovery(h, "Paperless-ngx authenticated a different account than the recorded Homarr owner; existing credentials were preserved")
	}
	if *profile.IsMFAEnabled || !*profile.HasUsablePassword {
		return "", accountRecovery(h, "Paperless-ngx's owned Homarr account requires MFA or password recovery; Setup will not change its authentication policy")
	}
	if token == nil {
		return "", nil
	}
	h.Log.Secret(*token)
	return *token, nil
}

func homarrTokenWorks(ctx context.Context, h *helpers.H) (bool, error) {
	key := h.Secret(h.Key("api_key"))
	if key == "" && h.Secret(h.Key("homarr_account")) == "" && h.Secret(h.Key("homarr_user")) == "" && h.Secret(h.Key("homarr_password")) == "" {
		return false, nil
	}
	user, err := homarrUser(ctx, h)
	if err != nil || !readOnlyUser(user) {
		return false, err
	}
	current, err := accountToken(ctx, h, user, "")
	if err != nil || current != key {
		return false, err
	}
	ok, err := probeHomarrToken(ctx, h, user, key)
	return ok && h.Secret(h.Key("homarr_user")) == user.Username, err
}

func probeHomarrToken(ctx context.Context, h *helpers.H, user integrationUser, key string) (bool, error) {
	if key == "" {
		return false, nil
	}
	h.Log.Secret(key)
	current, err := accountToken(ctx, h, user, key)
	if err != nil {
		return false, err
	}
	if current != key {
		return false, accountRecovery(h, "Paperless-ngx's Homarr token does not belong to the verified account profile; existing credentials were preserved")
	}
	for _, path := range []string{"/api/statistics/", "/api/tags/?page_size=1", "/api/correspondents/?page_size=1", "/api/document_types/?page_size=1"} {
		resp, err := h.HTTP(ctx, helpers.Request{Path: path, Header: map[string]string{"Authorization": "Token " + key}})
		if err != nil {
			return false, err
		}
		if resp.Status == 401 || resp.Status == 403 {
			return false, accountRecovery(h, fmt.Sprintf("Paperless-ngx's owned Homarr token lacks access to %s (HTTP %d); review the selected account's permissions", path, resp.Status))
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
	if h.Secret(h.Key("homarr_account")) == "" && h.Secret(h.Key("homarr_user")) == "" && h.Secret(h.Key("homarr_password")) == "" && h.Secret(h.Key("api_key")) == "" {
		account := homarrAccount{Owner: rand.Text()}
		h.Log.Secret(account.Owner)
		pending, err := json.Marshal(account)
		if err != nil {
			return err
		}
		if err := h.SetSecret(h.Key("homarr_account"), string(pending)); err != nil {
			return err
		}
		username, password := "self-host-homarr-"+rand.Text(), rand.Text()
		if err := h.SetSecret(h.Key("homarr_user"), username); err != nil {
			return err
		}
		if err := h.SetSecret(h.Key("homarr_password"), password); err != nil {
			return err
		}
		resp, err := h.HTTP(ctx, helpers.Request{Method: "POST", Path: "/api/users/", JSON: map[string]any{
			"username": username, "password": password, "first_name": account.Owner,
			"is_active": true, "is_staff": false, "is_superuser": false,
			"groups": []int{}, "user_permissions": homarrPermissions,
		}, User: h.AdminUser(), Password: h.AdminPassword()})
		if err != nil {
			return err
		}
		if resp.Status == 401 || resp.Status == 403 {
			return accountRecovery(h, "Paperless-ngx denied creating the dedicated Homarr account; the pending checkpoint was preserved for review")
		}
		if resp.Status != 201 {
			return fmt.Errorf("Paperless-ngx read-only account configuration returned HTTP %d; this requires Paperless-ngx 3.2.1's statistics permission", resp.Status)
		}
		var created integrationUser
		if err := resp.Decode(&created); err != nil {
			return err
		}
		if !validIntegrationUser(created) {
			return fmt.Errorf("Paperless-ngx account creation omitted required account fields; its pending checkpoint was preserved")
		}
		if created.Username != username || *created.Owner != account.Owner || !readOnlyUser(created) {
			return accountRecovery(h, "Paperless-ngx account creation did not return the intended read-only owner; its pending checkpoint was preserved")
		}
		account.ID = created.ID
		checkpoint, err := json.Marshal(account)
		if err != nil {
			return err
		}
		if err := h.SetSecret(h.Key("homarr_account"), string(checkpoint)); err != nil {
			return err
		}
	}
	user, err := homarrUser(ctx, h)
	if err != nil {
		return err
	}
	if !readOnlyUser(user) {
		return accountRecovery(h, "Paperless-ngx's owned Homarr account permissions changed; restore the documented read-only policy if intended, then retry Setup")
	}
	key, err := accountToken(ctx, h, user, "")
	if err != nil {
		return err
	}
	if key == "" {
		resp, err := h.HTTP(ctx, helpers.Request{Method: "POST", Path: "/api/token/", JSON: map[string]string{
			"username": user.Username, "password": h.Secret(h.Key("homarr_password")),
		}})
		if err != nil {
			return err
		}
		if resp.Status == 401 || resp.Status == 403 {
			return accountRecovery(h, "Paperless-ngx denied token discovery for the owned Homarr account; restore its known login before retrying")
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
		key = token.Key
	}
	ok, err := probeHomarrToken(ctx, h, user, key)
	if err != nil {
		return err
	}
	if !ok {
		return fmt.Errorf("Paperless-ngx did not return a usable token")
	}
	if err := h.SetSecret(h.Key("homarr_user"), user.Username); err != nil {
		return err
	}
	return h.SetSecret(h.Key("api_key"), key)
}
