package linkwarden

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"time"

	"github.com/ajnart/self-host/internal/helpers"
)

const homarrTokenName = "self-host Homarr statistics"

type accessToken struct {
	ID        int64     `json:"id"`
	Name      string    `json:"name"`
	IsSession *bool     `json:"isSession"`
	Expires   time.Time `json:"expires"`
	UserID    int64     `json:"userId"`
}

type tokenOwnership struct {
	ID          int64     `json:"id"`
	Expires     time.Time `json:"expires"`
	Fingerprint string    `json:"fingerprint"`
}

func tokenFingerprint(token string) string {
	sum := sha256.Sum256([]byte(token))
	return hex.EncodeToString(sum[:])
}

func tokenIdentity(ctx context.Context, h *helpers.H, token string) (bool, error) {
	resp, err := h.HTTP(ctx, helpers.Request{
		Path: "/api/v1/users/me", NoRedirect: true,
		Header: map[string]string{"Authorization": "Bearer " + token},
	})
	if err != nil {
		return false, err
	}
	if resp.Status == http.StatusUnauthorized || resp.Status == http.StatusForbidden {
		return false, nil
	}
	if resp.Status != http.StatusOK {
		return false, fmt.Errorf("Linkwarden token identity returned HTTP %d", resp.Status)
	}
	var identity struct {
		Response struct {
			ID       int64  `json:"id"`
			Username string `json:"username"`
		} `json:"response"`
	}
	if resp.Decode(&identity) != nil {
		return false, errors.New("Linkwarden did not return its token owner")
	}
	if identity.Response.ID != 1 || identity.Response.Username != h.AdminUser() {
		return false, errors.New("Linkwarden Homarr token does not belong to the Project administrator")
	}
	return true, nil
}

func tokenList(ctx context.Context, h *helpers.H, token string) ([]accessToken, error) {
	resp, err := h.HTTP(ctx, helpers.Request{
		Path: "/api/v1/tokens", NoRedirect: true,
		Header: map[string]string{"Authorization": "Bearer " + token},
	})
	if err != nil {
		return nil, err
	}
	if resp.Status == http.StatusNotFound || resp.Status == http.StatusMethodNotAllowed || resp.Status == http.StatusForbidden {
		return nil, fmt.Errorf("%w: Linkwarden headless access-token discovery is unavailable; review Settings > Access Tokens before retrying", helpers.ErrManual)
	}
	if resp.Status != http.StatusOK {
		return nil, fmt.Errorf("Linkwarden token discovery returned HTTP %d", resp.Status)
	}
	var body struct {
		Response *[]accessToken `json:"response"`
	}
	if resp.Decode(&body) != nil || body.Response == nil {
		return nil, errors.New("Linkwarden did not return its access-token list")
	}
	return *body.Response, nil
}

func homarrTokenWorks(ctx context.Context, h *helpers.H) (bool, error) {
	token := h.Secret(h.Key("homarr_api_key"))
	if token == "" {
		return false, nil
	}
	h.Log.Secret(token)
	var ownership tokenOwnership
	if json.Unmarshal([]byte(h.Secret(h.Key("homarr_token_ownership"))), &ownership) != nil || ownership.ID <= 0 || ownership.Fingerprint != tokenFingerprint(token) || ownership.Expires.IsZero() {
		return false, fmt.Errorf("%w: Linkwarden Homarr token ownership is unavailable; review its saved credential through the Project secret boundary", helpers.ErrManual)
	}
	if !ownership.Expires.After(h.Now()) {
		return false, nil
	}
	ok, err := tokenIdentity(ctx, h, token)
	if err != nil || !ok {
		return false, err
	}
	tokens, err := tokenList(ctx, h, token)
	if err != nil {
		return false, err
	}
	for _, current := range tokens {
		if current.ID != ownership.ID {
			continue
		}
		if current.Name != homarrTokenName || current.IsSession == nil || *current.IsSession || !current.Expires.Equal(ownership.Expires) {
			return false, errors.New("Linkwarden Homarr token metadata no longer matches its recorded ownership")
		}
		return true, nil
	}
	return false, nil
}

func VerifyHomarr(ctx context.Context, h *helpers.H) error {
	ok, err := homarrTokenWorks(ctx, h)
	if err != nil {
		return err
	}
	if !ok {
		return errors.New("Linkwarden Homarr token is missing, expired or rejected; run self-host setup linkwarden")
	}
	return nil
}

func createHomarrToken(ctx context.Context, h *helpers.H) error {
	if ok, err := homarrTokenWorks(ctx, h); err != nil || ok {
		return err
	}
	resp, err := h.HTTP(ctx, helpers.Request{
		Method: http.MethodPost, Path: "/api/v1/session", NoRedirect: true,
		JSON: map[string]string{"username": h.AdminUser(), "password": h.AdminPassword(), "sessionName": "self-host token setup"},
	})
	if err != nil {
		return err
	}
	var session struct {
		Response struct {
			Token string `json:"token"`
		} `json:"response"`
	}
	if resp.Status != http.StatusOK || resp.Decode(&session) != nil || session.Response.Token == "" {
		return errors.New("cannot sign in to Linkwarden to prepare its Homarr token")
	}
	h.Log.Secret(session.Response.Token)
	if ok, err := tokenIdentity(ctx, h, session.Response.Token); err != nil || !ok {
		if err != nil {
			return err
		}
		return errors.New("Linkwarden rejected the administrator session")
	}
	tokens, err := tokenList(ctx, h, session.Response.Token)
	if err != nil {
		return err
	}
	var ownership tokenOwnership
	json.Unmarshal([]byte(h.Secret(h.Key("homarr_token_ownership"))), &ownership)
	for _, current := range tokens {
		if current.Name == homarrTokenName || current.ID == ownership.ID {
			return fmt.Errorf("%w: an existing Linkwarden Homarr token needs recovery; restore its saved credential or revoke only the managed token, then retry", helpers.ErrManual)
		}
	}
	resp, err = h.HTTP(ctx, helpers.Request{
		Method: http.MethodPost, Path: "/api/v1/tokens", NoRedirect: true,
		Header: map[string]string{"Authorization": "Bearer " + session.Response.Token},
		JSON:   map[string]any{"name": homarrTokenName, "expires": 3},
	})
	if err != nil {
		return err
	}
	if resp.Status == http.StatusNotFound || resp.Status == http.StatusMethodNotAllowed || resp.Status == http.StatusForbidden {
		return fmt.Errorf("%w: Linkwarden headless token provisioning is unavailable", helpers.ErrManual)
	}
	if resp.Status != http.StatusOK {
		return fmt.Errorf("Linkwarden token creation returned HTTP %d; inspect Access Tokens before retrying", resp.Status)
	}
	var created struct {
		Response struct {
			SecretKey string      `json:"secretKey"`
			Token     accessToken `json:"token"`
		} `json:"response"`
	}
	if resp.Decode(&created) != nil {
		return errors.New("Linkwarden did not return its newly created token; inspect Access Tokens before retrying")
	}
	h.Log.Secret(created.Response.SecretKey)
	current := created.Response.Token
	if created.Response.SecretKey == "" || current.ID <= 0 || current.UserID != 1 || current.Name != homarrTokenName || current.IsSession == nil || *current.IsSession || !current.Expires.After(h.Now()) || current.Expires.After(h.Now().Add(91*24*time.Hour)) {
		return errors.New("Linkwarden returned incomplete or unexpected token metadata; inspect Access Tokens before retrying")
	}
	metadata, err := json.Marshal(tokenOwnership{ID: current.ID, Expires: current.Expires, Fingerprint: tokenFingerprint(created.Response.SecretKey)})
	if err != nil {
		return err
	}
	if err := h.SetSecret(h.Key("homarr_token_ownership"), string(metadata)); err != nil {
		return err
	}
	return h.SetSecret(h.Key("homarr_api_key"), created.Response.SecretKey)
}
