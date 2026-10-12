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

const HomarrRecoveryHint = "Run self-host setup linkwarden, then self-host setup homarr. Restore only a known matching token and ownership JSON through the optional private inputs linkwarden.homarr_api_key and linkwarden.homarr_token_ownership using install --set-file and owner-only credential files. Empty inputs preserve saved values. Reinstall replaces Compose: first preserve and review existing authentication, mounts and ports and separately approve replacement; never blindly use install --yes. Otherwise revoke only the recorded self-host Homarr statistics token in Linkwarden Settings > Access Tokens and retry Setup. A valid authenticated inventory must confirm its recorded ID and name are absent before resetting a pending or mismatched pair. Unknown ownership remains Manual. Linkwarden tokens are write-capable and expire after 90 days."

type accessToken struct {
	ID        int64     `json:"id"`
	Name      string    `json:"name"`
	IsSession *bool     `json:"isSession"`
	Expires   time.Time `json:"expires"`
	UserID    int64     `json:"userId"`
	Revoked   *bool     `json:"revoked"`
}

type tokenOwnership struct {
	ID          int64     `json:"id"`
	AccountID   int64     `json:"accountId"`
	Expires     time.Time `json:"expires"`
	Fingerprint string    `json:"fingerprint"`
	Pending     bool      `json:"pending,omitempty"`
}

func homarrOwnership(h *helpers.H) (tokenOwnership, error) {
	var ownership tokenOwnership
	if json.Unmarshal([]byte(h.Secret(h.Key("homarr_token_ownership"))), &ownership) != nil || ownership.ID <= 0 || len(ownership.Fingerprint) != 64 || ownership.Expires.IsZero() || ownership.AccountID != 0 && ownership.AccountID != 1 {
		return ownership, fmt.Errorf("%w: Linkwarden Homarr token ownership is unavailable; restore its known matching private inputs", helpers.ErrManual)
	}
	if _, err := hex.DecodeString(ownership.Fingerprint); err != nil {
		return ownership, fmt.Errorf("%w: Linkwarden Homarr token ownership fingerprint is invalid; restore its known matching private inputs", helpers.ErrManual)
	}
	return ownership, nil
}

func saveHomarrOwnership(h *helpers.H, ownership tokenOwnership) error {
	metadata, err := json.Marshal(ownership)
	if err != nil {
		return err
	}
	return h.SetSecret(h.Key("homarr_token_ownership"), string(metadata))
}

func HomarrAccountID(h *helpers.H) (int64, error) {
	ownership, err := homarrOwnership(h)
	if err != nil {
		return 0, err
	}
	if ownership.AccountID == 0 || ownership.Pending || ownership.Fingerprint != tokenFingerprint(h.Secret(h.Key("homarr_api_key"))) || !ownership.Expires.After(h.Now()) {
		return 0, fmt.Errorf("%w: Linkwarden Homarr token ownership needs Setup recovery", helpers.ErrManual)
	}
	return ownership.AccountID, nil
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
		return false, fmt.Errorf("%w: Linkwarden Homarr token does not belong to the Project administrator; restore the selected account's matching credential and ownership record", helpers.ErrManual)
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
	seen := map[int64]bool{}
	for _, current := range *body.Response {
		if current.ID <= 0 || current.IsSession == nil || current.Expires.IsZero() || seen[current.ID] {
			return nil, errors.New("Linkwarden did not return a complete unambiguous access-token inventory")
		}
		seen[current.ID] = true
	}
	return *body.Response, nil
}

func homarrTokenWorks(ctx context.Context, h *helpers.H) (bool, error) {
	token := h.Secret(h.Key("homarr_api_key"))
	if token == "" {
		return false, nil
	}
	h.Log.Secret(token)
	ownership, err := homarrOwnership(h)
	if err != nil {
		return false, err
	}
	if ownership.Fingerprint != tokenFingerprint(token) {
		return false, fmt.Errorf("%w: Linkwarden Homarr token and ownership do not match; recover the pending credential before retrying", helpers.ErrManual)
	}
	if ownership.Pending || ownership.AccountID == 0 {
		return false, nil
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
			return false, fmt.Errorf("%w: Linkwarden Homarr token metadata no longer matches its recorded ownership", helpers.ErrManual)
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
		return fmt.Errorf("%w: Linkwarden Homarr token is missing, pending, expired or rejected; run self-host setup linkwarden", helpers.ErrManual)
	}
	return nil
}

func createHomarrToken(ctx context.Context, h *helpers.H) error {
	if ok, err := homarrTokenWorks(ctx, h); ok || err != nil && !errors.Is(err, helpers.ErrManual) {
		return err
	}
	var ownership tokenOwnership
	if h.Secret(h.Key("homarr_token_ownership")) != "" {
		var err error
		ownership, err = homarrOwnership(h)
		if err != nil {
			return err
		}
	} else if h.Secret(h.Key("homarr_api_key")) != "" {
		return fmt.Errorf("%w: restore the known token's matching ownership record through private inputs before retrying", helpers.ErrManual)
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
	for _, current := range tokens {
		if current.Name == homarrTokenName && current.ID != ownership.ID {
			return fmt.Errorf("%w: an existing Linkwarden Homarr token needs recovery; restore its saved credential or revoke only the managed token, then retry", helpers.ErrManual)
		}
	}
	for _, current := range tokens {
		if current.ID == ownership.ID {
			if current.Name != homarrTokenName || current.IsSession == nil || *current.IsSession || !current.Expires.Equal(ownership.Expires) || !current.Expires.After(h.Now()) {
				return fmt.Errorf("%w: the recorded Linkwarden token needs explicit recovery or revocation", helpers.ErrManual)
			}
			token := h.Secret(h.Key("homarr_api_key"))
			if token == "" || tokenFingerprint(token) != ownership.Fingerprint {
				return fmt.Errorf("%w: an issued Linkwarden token still exists but its matching secret is unavailable; restore the pair or revoke only that recorded token", helpers.ErrManual)
			}
			ok, err := tokenIdentity(ctx, h, token)
			if err != nil {
				return err
			}
			if !ok {
				return fmt.Errorf("%w: the recorded Linkwarden token is rejected; restore its matching secret or revoke it", helpers.ErrManual)
			}
			ownership.AccountID = 1
			ownership.Pending = false
			return saveHomarrOwnership(h, ownership)
		}
	}
	if ownership.ID != 0 {
		if err := h.SetSecret(h.Key("homarr_api_key"), ""); err != nil {
			return err
		}
		if err := h.SetSecret(h.Key("homarr_token_ownership"), ""); err != nil {
			return err
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
	if created.Response.SecretKey == "" || current.ID <= 0 || current.UserID != 1 || current.Name != homarrTokenName || current.IsSession == nil || *current.IsSession || current.Revoked == nil || *current.Revoked || !current.Expires.After(h.Now()) || current.Expires.After(h.Now().Add(91*24*time.Hour)) {
		return errors.New("Linkwarden returned incomplete or unexpected token metadata; inspect Access Tokens before retrying")
	}
	ownership = tokenOwnership{ID: current.ID, AccountID: current.UserID, Expires: current.Expires, Fingerprint: tokenFingerprint(created.Response.SecretKey), Pending: true}
	if err := saveHomarrOwnership(h, ownership); err != nil {
		return err
	}
	if err := h.SetSecret(h.Key("homarr_api_key"), created.Response.SecretKey); err != nil {
		return err
	}
	ownership.Pending = false
	return saveHomarrOwnership(h, ownership)
}
