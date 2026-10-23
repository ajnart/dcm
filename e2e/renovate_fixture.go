package e2e

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"slices"
	"strings"
)

// Kept only in the owned harness process, never marshalled into evidence.
type renovateForgejoFixture struct {
	username, password, tokenName string
	userID, tokenID               int64
	tokenHash                     [32]byte
}

type renovateForgejoUser struct {
	ID     int64  `json:"id"`
	Login  string `json:"login"`
	Email  string `json:"email"`
	Admin  *bool  `json:"is_admin"`
	Active bool   `json:"active"`
}

type renovateForgejoToken struct {
	ID     int64    `json:"id"`
	Name   string   `json:"name"`
	Value  string   `json:"sha1"`
	Scopes []string `json:"scopes"`
}

type renovateForgejoHTTPError struct{ status int }

func (e renovateForgejoHTTPError) Error() string { return fmt.Sprintf("unexpected HTTP %d", e.status) }

func renovateForgejoOperationError(operation string, err error) error {
	var httpErr renovateForgejoHTTPError
	if errors.As(err, &httpErr) {
		return fmt.Errorf("%s returned HTTP %d", operation, httpErr.status)
	}
	return errors.New(operation + " failed")
}

func decodeRenovateCredentialHandoff(data []byte) (admin, password, token string, ok bool) {
	var doc struct {
		Admin struct {
			Username string            `json:"username"`
			Password string            `json:"password"`
			Aliases  map[string]string `json:"aliases"`
		} `json:"admin"`
		Apps map[string]map[string]string `json:"apps"`
	}
	if json.Unmarshal(data, &doc) != nil {
		return "", "", "", false
	}
	admin = doc.Admin.Aliases["forgejo"]
	if admin == "" {
		admin = doc.Admin.Username
	}
	return admin, doc.Admin.Password, doc.Apps["renovate"]["RENOVATE_TOKEN"], admin != "" && doc.Admin.Password != ""
}

func issueRenovateToken(ctx context.Context, client *http.Client, origin, admin, adminPassword, bot, botPassword string) (*renovateForgejoFixture, string, error) {
	f := &renovateForgejoFixture{username: bot, password: botPassword, tokenName: "selfhost-e2e-renovate"}
	account, err := createRenovateBot(ctx, client, origin, admin, adminPassword, bot, botPassword)
	if err != nil {
		return nil, "", err
	}
	var invalid []string
	if account.ID <= 0 {
		invalid = append(invalid, "id")
	}
	if account.Login != bot {
		invalid = append(invalid, "login")
	}
	if account.Email != bot+"@e2e.selfhost.test" {
		invalid = append(invalid, "email")
	}
	if account.Admin == nil || *account.Admin {
		invalid = append(invalid, "is_admin")
	}
	if !account.Active {
		invalid = append(invalid, "active")
	}
	if len(invalid) > 0 {
		return nil, "", errors.New("owned Forgejo bot identity response had invalid fields: " + strings.Join(invalid, ","))
	}
	f.userID = account.ID
	var issued renovateForgejoToken
	err = renovateForgejoRequest(ctx, client, origin, "POST", "/api/v1/users/"+url.PathEscape(bot)+"/tokens", renovateBasic(bot, botPassword), map[string]any{
		"name": f.tokenName, "scopes": []string{"read:user", "write:repository"},
	}, 201, &issued)
	if err != nil {
		return nil, "", errors.New("owned Forgejo token creation failed")
	}
	if issued.ID <= 0 || issued.Name != f.tokenName || issued.Value == "" || !renovateTokenScopes(issued.Scopes) {
		return nil, "", errors.New("owned Forgejo token issuance was not confirmed")
	}
	f.tokenID, f.tokenHash = issued.ID, sha256.Sum256([]byte(issued.Value))
	if err := f.verify(ctx, client, origin, issued.Value); err != nil {
		return nil, "", err
	}
	return f, issued.Value, nil
}

func createRenovateBot(ctx context.Context, client *http.Client, origin, admin, adminPassword, bot, botPassword string) (renovateForgejoUser, error) {
	var account renovateForgejoUser
	err := renovateForgejoRequest(ctx, client, origin, "POST", "/api/v1/admin/users", renovateBasic(admin, adminPassword), map[string]any{
		"username": bot, "email": bot + "@e2e.selfhost.test", "password": botPassword,
		"must_change_password": false, "send_notify": false, "visibility": "private",
	}, 201, &account)
	if err != nil {
		return account, renovateForgejoOperationError("owned Forgejo bot creation", err)
	}
	return account, nil
}

func (f *renovateForgejoFixture) verify(ctx context.Context, client *http.Client, origin, token string) error {
	if sha256.Sum256([]byte(token)) != f.tokenHash {
		return errors.New("Renovate did not retain the exact owned token")
	}
	var account renovateForgejoUser
	if err := renovateForgejoRequest(ctx, client, origin, "GET", "/api/v1/user", "token "+token, nil, 200, &account); err != nil {
		return errors.New("owned Forgejo token authentication failed")
	}
	if account.ID != f.userID || account.Login != f.username || account.Email != f.username+"@e2e.selfhost.test" || account.Admin == nil || *account.Admin || !account.Active {
		return errors.New("owned Forgejo PAT did not authenticate the dedicated bot")
	}
	var tokens []renovateForgejoToken
	if err := renovateForgejoRequest(ctx, client, origin, "GET", "/api/v1/users/"+url.PathEscape(f.username)+"/tokens", renovateBasic(f.username, f.password), nil, 200, &tokens); err != nil {
		return errors.New("owned Forgejo token inventory failed")
	}
	for _, saved := range tokens {
		if saved.ID == f.tokenID && saved.Name == f.tokenName && renovateTokenScopes(saved.Scopes) {
			return nil
		}
	}
	return errors.New("owned Forgejo token ID was not retained")
}

func renovateTokenScopes(scopes []string) bool {
	return len(scopes) == 2 && slices.Contains(scopes, "read:user") && slices.Contains(scopes, "write:repository")
}

func renovateBasic(user, password string) string {
	return "Basic " + base64.StdEncoding.EncodeToString([]byte(user+":"+password))
}

// Only owned loopback APIs are eligible; response bodies and transport errors
// stay private even when upstream reflects a submitted credential.
func renovateForgejoRequest(ctx context.Context, client *http.Client, origin, method, path, auth string, body any, status int, out any) error {
	u, err := url.Parse(origin)
	if err != nil || u.User != nil || u.RawQuery != "" || u.Fragment != "" || u.Path != "" ||
		(u.Scheme != "http" && u.Scheme != "https") || !net.ParseIP(u.Hostname()).IsLoopback() {
		return errors.New("Forgejo fixture API origin is not owned loopback")
	}
	var payload []byte
	if body != nil {
		payload, err = json.Marshal(body)
		if err != nil {
			return errors.New("owned Forgejo fixture request could not be encoded")
		}
	}
	req, err := http.NewRequestWithContext(ctx, method, origin+path, bytes.NewReader(payload))
	if err != nil {
		return errors.New("owned Forgejo fixture request could not be built")
	}
	req.Header.Set("Authorization", auth)
	req.Header.Set("Accept", "application/json")
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	// Block redirects even if a caller supplied a default client.
	private := *client
	private.CheckRedirect = func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }
	resp, err := private.Do(req)
	if err != nil {
		return errors.New("owned Forgejo fixture API request failed")
	}
	defer resp.Body.Close()
	if resp.StatusCode != status {
		return renovateForgejoHTTPError{status: resp.StatusCode}
	}
	if out == nil {
		return nil
	}
	if err := json.NewDecoder(io.LimitReader(resp.Body, 64<<10)).Decode(out); err != nil {
		return errors.New("owned Forgejo fixture API returned an invalid response")
	}
	return nil
}
