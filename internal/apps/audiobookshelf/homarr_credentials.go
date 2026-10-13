package audiobookshelf

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"net/http"
	"net/url"
	"strings"

	"github.com/ajnart/self-host/internal/helpers"
)

const homarrUser = "self-host-homarr"
const homarrKeyName = "self-host Homarr"

type account struct {
	ID          string          `json:"id"`
	Username    string          `json:"username"`
	Type        string          `json:"type"`
	IsActive    bool            `json:"isActive"`
	AccessToken string          `json:"accessToken"`
	Permissions map[string]bool `json:"permissions"`
}

func homarrPermissions() map[string]bool {
	return map[string]bool{
		"download": false, "update": false, "delete": false,
		"upload": false, "createEreader": false,
		"accessAllLibraries": true, "accessAllTags": true,
		"accessExplicitContent": true, "selectedTagsNotAccessible": false,
	}
}

func (a account) homarrAccount(id string) bool {
	if id == "" || a.ID != id || a.Username != homarrUser || a.Type != "admin" || !a.IsActive {
		return false
	}
	for permission, value := range homarrPermissions() {
		actual, present := a.Permissions[permission]
		if !present || actual != value {
			return false
		}
	}
	return true
}

func bearer(token string) map[string]string {
	return map[string]string{"Authorization": "Bearer " + token}
}

func credentialRequest(ctx context.Context, h *helpers.H, req helpers.Request) (helpers.Response, error) {
	req.NoRedirect = true
	resp, err := h.HTTP(ctx, req)
	if err != nil {
		return resp, err
	}
	if resp.Status != http.StatusOK {
		return resp, fmt.Errorf("Audiobookshelf %s %s returned HTTP %d", req.Method, req.Path, resp.Status)
	}
	return resp, nil
}

func adminSession(ctx context.Context, h *helpers.H) (string, error) {
	return h.Remember("audiobookshelf-admin-session", func() (string, error) {
		resp, err := credentialRequest(ctx, h, helpers.Request{
			Method: http.MethodPost, Path: "/login",
			JSON: map[string]string{"username": h.AdminUser(), "password": h.AdminPassword()},
		})
		if err != nil {
			return "", err
		}
		var body struct {
			User account `json:"user"`
		}
		if err := resp.Decode(&body); err != nil {
			return "", err
		}
		if body.User.ID == "" || body.User.Username != h.AdminUser() || body.User.Type != "root" || body.User.AccessToken == "" {
			return "", errors.New("Audiobookshelf did not return the root Admin login's temporary access token")
		}
		h.Log.Secret(body.User.AccessToken)
		return body.User.AccessToken, nil
	})
}

func homarrAccountWorks(ctx context.Context, h *helpers.H) (bool, error) {
	id := h.Secret(h.Key("homarr_user_id"))
	if id == "" {
		return false, nil
	}
	token, err := adminSession(ctx, h)
	if err != nil {
		return false, err
	}
	resp, err := credentialRequest(ctx, h, helpers.Request{
		Method: http.MethodGet, Path: "/api/users/" + url.PathEscape(id), Header: bearer(token),
	})
	if err != nil {
		return false, err
	}
	var user account
	if err := resp.Decode(&user); err != nil {
		return false, err
	}
	return user.homarrAccount(id), nil
}

func createHomarrAccount(ctx context.Context, h *helpers.H) error {
	if h.Secret(h.Key("homarr_user_id")) != "" {
		return fmt.Errorf("%w: the saved Homarr account needs repair; its permissions were not changed", helpers.ErrManual)
	}
	token, err := adminSession(ctx, h)
	if err != nil {
		return err
	}
	resp, err := credentialRequest(ctx, h, helpers.Request{Method: http.MethodGet, Path: "/api/users", Header: bearer(token)})
	if err != nil {
		return err
	}
	var existing struct {
		Users []account `json:"users"`
	}
	if err := resp.Decode(&existing); err != nil {
		return err
	}
	if existing.Users == nil {
		return errors.New("Audiobookshelf did not return its user list")
	}
	for _, user := range existing.Users {
		if strings.EqualFold(user.Username, homarrUser) {
			return fmt.Errorf("%w: a Homarr account already exists without saved ownership; it was not adopted", helpers.ErrManual)
		}
	}
	passwordBytes := make([]byte, 32)
	if _, err := rand.Read(passwordBytes); err != nil {
		return err
	}
	password := hex.EncodeToString(passwordBytes)
	h.Log.Secret(password)
	resp, err = credentialRequest(ctx, h, helpers.Request{
		Method: http.MethodPost, Path: "/api/users", Header: bearer(token),
		JSON: map[string]any{
			"username": homarrUser, "password": password, "type": "admin",
			"isActive": true, "permissions": homarrPermissions(),
		},
	})
	if err != nil {
		return err
	}
	var created struct {
		User account `json:"user"`
	}
	if err := resp.Decode(&created); err != nil {
		return err
	}
	if !created.User.homarrAccount(created.User.ID) {
		return errors.New("Audiobookshelf did not create the restricted Homarr administrator")
	}
	return h.SetSecret(h.Key("homarr_user_id"), created.User.ID)
}

func APIKey(h *helpers.H) string { return h.Secret(h.Key("api_key")) }

func persistentKey(h *helpers.H) bool {
	parts := strings.Split(APIKey(h), ".")
	if len(parts) != 3 {
		return false
	}
	payload, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil {
		return false
	}
	var claims struct {
		Type  string          `json:"type"`
		KeyID string          `json:"keyId"`
		Name  string          `json:"name"`
		Exp   json.RawMessage `json:"exp"`
	}
	if json.Unmarshal(payload, &claims) != nil {
		return false
	}
	return claims.Type == "api" && claims.Name == homarrKeyName && claims.KeyID != "" && claims.KeyID == h.Secret(h.Key("homarr_api_key_id")) && len(claims.Exp) == 0
}

func VerifyHomarrCredential(ctx context.Context, h *helpers.H) (map[string]any, error) {
	key := APIKey(h)
	if key == "" {
		return nil, errors.New("Audiobookshelf has no saved Homarr API key; run self-host setup audiobookshelf")
	}
	if !persistentKey(h) {
		return nil, errors.New("Audiobookshelf's saved Homarr credential is not its non-expiring named API key")
	}
	resp, err := credentialRequest(ctx, h, helpers.Request{Method: http.MethodPost, Path: "/api/authorize", Header: bearer(key)})
	if err != nil {
		return nil, err
	}
	var authorized struct {
		User account `json:"user"`
	}
	if err := resp.Decode(&authorized); err != nil {
		return nil, err
	}
	if !authorized.User.homarrAccount(h.Secret(h.Key("homarr_user_id"))) {
		return nil, errors.New("Audiobookshelf's saved key does not belong to its restricted Homarr account")
	}
	resp, err = credentialRequest(ctx, h, helpers.Request{Method: http.MethodGet, Path: "/api/libraries", Header: bearer(key)})
	if err != nil {
		return nil, err
	}
	var libraries struct {
		Libraries []struct {
			ID        string  `json:"id"`
			Name      *string `json:"name"`
			MediaType string  `json:"mediaType"`
		} `json:"libraries"`
	}
	if err := resp.Decode(&libraries); err != nil {
		return nil, err
	}
	if libraries.Libraries == nil {
		return nil, errors.New("Audiobookshelf did not return an authenticated library list")
	}
	libraryStats := make([]any, 0, len(libraries.Libraries))
	audiobooks, podcasts := float64(0), float64(0)
	for _, library := range libraries.Libraries {
		if library.ID == "" || library.Name == nil || (library.MediaType != "book" && library.MediaType != "podcast") {
			return nil, errors.New("Audiobookshelf returned an unsupported library")
		}
		resp, err := credentialRequest(ctx, h, helpers.Request{
			Method: http.MethodGet, Path: "/api/libraries/" + url.PathEscape(library.ID) + "/stats", Header: bearer(key),
		})
		if err != nil {
			return nil, err
		}
		var stats map[string]any
		if err := resp.Decode(&stats); err != nil {
			return nil, err
		}
		items, ok := stats["totalItems"].(float64)
		if !ok || items < 0 || math.Trunc(items) != items {
			return nil, errors.New("Audiobookshelf did not return a valid library item count")
		}
		entry := map[string]any{
			"id": library.ID, "name": *library.Name, "mediaType": library.MediaType,
			"totalItems": items, "totalDurationSeconds": nil, "totalSizeBytes": nil,
		}
		for field, destination := range map[string]string{"totalDuration": "totalDurationSeconds", "totalSize": "totalSizeBytes"} {
			if value, present := stats[field]; present {
				number, ok := value.(float64)
				if !ok || number < 0 || field == "totalSize" && math.Trunc(number) != number {
					return nil, fmt.Errorf("Audiobookshelf did not return valid %s library stats", field)
				}
				entry[destination] = number
			}
		}
		libraryStats = append(libraryStats, entry)
		if library.MediaType == "book" {
			audiobooks += items
		} else {
			podcasts += items
		}
	}
	resp, err = credentialRequest(ctx, h, helpers.Request{Method: http.MethodGet, Path: "/api/me/listening-stats", Header: bearer(key)})
	if err != nil {
		return nil, err
	}
	var listening struct {
		TotalTime *float64 `json:"totalTime"`
	}
	if err := resp.Decode(&listening); err != nil {
		return nil, err
	}
	if listening.TotalTime == nil || *listening.TotalTime < 0 {
		return nil, errors.New("Audiobookshelf did not return authenticated listening stats")
	}
	resp, err = credentialRequest(ctx, h, helpers.Request{Method: http.MethodGet, Path: "/api/users/online", Header: bearer(key)})
	if err != nil {
		return nil, err
	}
	var online struct {
		OpenSessions []any `json:"openSessions"`
	}
	if err := resp.Decode(&online); err != nil {
		return nil, err
	}
	if online.OpenSessions == nil {
		return nil, errors.New("Audiobookshelf did not return authenticated online sessions")
	}
	return map[string]any{
		"libraryCount": float64(len(libraries.Libraries)), "totalAudiobooks": audiobooks, "totalPodcasts": podcasts,
		"totalListeningTimeSeconds": *listening.TotalTime, "activeSessions": float64(len(online.OpenSessions)),
		"libraries": libraryStats,
	}, nil
}

func createHomarrKey(ctx context.Context, h *helpers.H) error {
	if APIKey(h) != "" || h.Secret(h.Key("homarr_api_key_id")) != "" {
		return fmt.Errorf("%w: the saved Homarr key needs repair; it was not replaced", helpers.ErrManual)
	}
	token, err := adminSession(ctx, h)
	if err != nil {
		return err
	}
	resp, err := credentialRequest(ctx, h, helpers.Request{Method: http.MethodGet, Path: "/api/api-keys", Header: bearer(token)})
	if err != nil {
		return err
	}
	var existing struct {
		APIKeys []struct {
			Name string `json:"name"`
		} `json:"apiKeys"`
	}
	if err := resp.Decode(&existing); err != nil {
		return err
	}
	if existing.APIKeys == nil {
		return errors.New("Audiobookshelf did not return its API key list")
	}
	for _, key := range existing.APIKeys {
		if key.Name == homarrKeyName {
			return fmt.Errorf("%w: a Homarr API key exists but its one-time secret is unavailable; it was not replaced", helpers.ErrManual)
		}
	}
	resp, err = credentialRequest(ctx, h, helpers.Request{
		Method: http.MethodPost, Path: "/api/api-keys", Header: bearer(token),
		JSON: map[string]any{"name": homarrKeyName, "userId": h.Secret(h.Key("homarr_user_id")), "isActive": true},
	})
	if err != nil {
		return err
	}
	var created struct {
		APIKey struct {
			ID       string `json:"id"`
			APIKey   string `json:"apiKey"`
			Name     string `json:"name"`
			UserID   string `json:"userId"`
			IsActive bool   `json:"isActive"`
		} `json:"apiKey"`
	}
	if err := resp.Decode(&created); err != nil {
		return err
	}
	h.Log.Secret(created.APIKey.APIKey)
	if created.APIKey.ID == "" || created.APIKey.APIKey == "" || created.APIKey.Name != homarrKeyName || !created.APIKey.IsActive || created.APIKey.UserID != h.Secret(h.Key("homarr_user_id")) {
		return errors.New("Audiobookshelf did not return the new Homarr API key")
	}
	if err := h.SetSecret(h.Key("homarr_api_key_id"), created.APIKey.ID); err != nil {
		return err
	}
	return h.SetSecret(h.Key("api_key"), created.APIKey.APIKey)
}

func setupHomarrCredential(ctx context.Context, h *helpers.H) error {
	if err := h.Step(ctx, "homarr-account", "create a separate Homarr administrator with media changes disabled", helpers.StepSpec{
		Check:      func(ctx context.Context) (bool, error) { return homarrAccountWorks(ctx, h) },
		Do:         func(ctx context.Context) error { return createHomarrAccount(ctx, h) },
		Hint:       "Open Audiobookshelf Settings > Users. Resolve the self-host-homarr account ownership or permissions, then run self-host setup audiobookshelf. This account retains role-based administrator access.",
		Credential: "admin",
	}); err != nil {
		return err
	}
	return h.Step(ctx, "api-key", "save and verify Homarr's Audiobookshelf API key", helpers.StepSpec{
		Check: func(ctx context.Context) (bool, error) {
			if APIKey(h) == "" {
				return false, nil
			}
			_, err := VerifyHomarrCredential(ctx, h)
			return err == nil, err
		},
		Do:         func(ctx context.Context) error { return createHomarrKey(ctx, h) },
		Hint:       "Open Audiobookshelf Settings > API keys. Repair the saved self-host Homarr key for the separate self-host-homarr account, then run self-host setup audiobookshelf. Keys are shown only when created; revoked or lost keys are not silently replaced.",
		Credential: "admin",
	})
}
