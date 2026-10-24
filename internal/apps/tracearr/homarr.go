package tracearr

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/ajnart/self-host/internal/helpers"
)

type homarrHealth struct {
	Status    string    `json:"status"`
	Version   string    `json:"version"`
	Timestamp time.Time `json:"timestamp"`
	Servers   []struct {
		ID            string `json:"id"`
		Type          string `json:"type"`
		Online        *bool  `json:"online"`
		Historical    *bool  `json:"historical"`
		ActiveStreams *int64 `json:"activeStreams"`
	} `json:"servers"`
}

func homarrKeyNeeded(h *helpers.H) bool {
	return h.Peer("homarr") != nil || h.Secret(h.Key("homarr_api_key")) != "" || h.Secret(h.Key("homarr_api_key_owner")) != "" || h.Secret(h.Key("homarr_api_key_hash")) != ""
}

func homarrKeyHash(key string) string {
	sum := sha256.Sum256([]byte(key))
	return hex.EncodeToString(sum[:])
}

func currentHomarrKey(ctx context.Context, h *helpers.H, session string) (string, error) {
	resp, err := h.HTTP(ctx, helpers.Request{
		Path: "/api/v1/settings/api-key", NoRedirect: true,
		Header: map[string]string{"Authorization": "Bearer " + session},
	})
	if err != nil {
		return "", err
	}
	if resp.Status != 200 {
		return "", fmt.Errorf("Tracearr API-key discovery returned HTTP %d; retry self-host setup tracearr", resp.Status)
	}
	var current struct {
		Token json.RawMessage `json:"token"`
	}
	if resp.Decode(&current) != nil || len(current.Token) == 0 {
		return "", errors.New("Tracearr API-key discovery returned an incomplete response")
	}
	if string(current.Token) == "null" {
		return "", nil
	}
	var token string
	if json.Unmarshal(current.Token, &token) != nil || !strings.HasPrefix(token, "trr_pub_") {
		return "", errors.New("Tracearr did not return a supported public-API key")
	}
	h.Log.Secret(token)
	return token, nil
}

func homarrKeyWorks(ctx context.Context, h *helpers.H, session, ownerID string) (bool, error) {
	key := h.Secret(h.Key("homarr_api_key"))
	if key == "" {
		return false, nil
	}
	if ownerID == "" || h.Secret(h.Key("homarr_api_key_owner")) != ownerID || h.Secret(h.Key("homarr_api_key_hash")) != homarrKeyHash(key) {
		return false, fmt.Errorf("%w: Tracearr key ownership is unverified; restore its Project credential checkpoint before retrying Setup", helpers.ErrManual)
	}
	current, err := currentHomarrKey(ctx, h, session)
	if err != nil {
		return false, err
	}
	if current != key {
		return false, fmt.Errorf("%w: Tracearr's saved key changed; restore the owned key through the Project credential boundary, without regenerating it", helpers.ErrManual)
	}
	_, err = readHomarrHealth(ctx, h)
	return err == nil, err
}

func setupHomarrKey(ctx context.Context, h *helpers.H, session, ownerID string) error {
	if !homarrKeyNeeded(h) {
		return nil
	}
	return h.Step(ctx, "homarr-api-key", "prepare the owned Tracearr public-API key for Homarr", helpers.StepSpec{
		Check: func(ctx context.Context) (bool, error) {
			return homarrKeyWorks(ctx, h, session, ownerID)
		},
		Do: func(ctx context.Context) error {
			if ok, err := homarrKeyWorks(ctx, h, session, ownerID); err != nil || ok {
				return err
			}
			current, err := currentHomarrKey(ctx, h, session)
			if err != nil {
				return err
			}
			checkpoint := h.Secret(h.Key("homarr_api_key_owner"))
			if checkpoint != "" && checkpoint != ownerID {
				return fmt.Errorf("%w: Tracearr key creation belongs to a different owner; restore the Project checkpoint", helpers.ErrManual)
			}
			if current != "" {
				if checkpoint == "" || h.Secret(h.Key("homarr_api_key_hash")) != homarrKeyHash(current) {
					return fmt.Errorf("%w: Tracearr already has an unowned API key; preserve it and make an explicit credential ownership decision before retrying", helpers.ErrManual)
				}
				return h.SetSecret(h.Key("homarr_api_key"), current)
			}
			if checkpoint != "" || h.Secret(h.Key("homarr_api_key_hash")) != "" {
				return fmt.Errorf("%w: Tracearr key creation was already attempted; inspect the owned account and restore its credential without repeating regeneration", helpers.ErrManual)
			}
			if session == "" || ownerID == "" {
				return errors.New("Tracearr owner identity is missing; retry self-host setup tracearr")
			}
			if err := h.SetSecret(h.Key("homarr_api_key_owner"), ownerID); err != nil {
				return err
			}
			resp, err := h.HTTP(ctx, helpers.Request{
				Method: "POST", Path: "/api/v1/settings/api-key/regenerate", NoRedirect: true,
				Header: map[string]string{"Authorization": "Bearer " + session},
			})
			if err != nil {
				return fmt.Errorf("%w: Tracearr key creation was not confirmed; inspect the owned account without regenerating or adopting an uncertain key", helpers.ErrManual)
			}
			var created struct {
				Token string `json:"token"`
			}
			if resp.Status != 200 || resp.Decode(&created) != nil || !strings.HasPrefix(created.Token, "trr_pub_") {
				return fmt.Errorf("%w: Tracearr key creation was not confirmed; inspect the owned account before retrying Setup", helpers.ErrManual)
			}
			if err := h.SetSecret(h.Key("homarr_api_key_hash"), homarrKeyHash(created.Token)); err != nil {
				return err
			}
			return h.SetSecret(h.Key("homarr_api_key"), created.Token)
		},
		Hint:       "Preserve the owner and any existing key. Restore only the owned Project credential/checkpoint, then run self-host setup tracearr and self-host setup homarr. Never paste credentials into chat or regenerate a working key.",
		Credential: "admin",
	})
}

func readHomarrHealth(ctx context.Context, h *helpers.H) (homarrHealth, error) {
	var health homarrHealth
	key := h.Secret(h.Key("homarr_api_key"))
	if !strings.HasPrefix(key, "trr_pub_") || h.Secret(h.Key("homarr_api_key_owner")) == "" || h.Secret(h.Key("homarr_api_key_hash")) != homarrKeyHash(key) {
		return health, fmt.Errorf("%w: Tracearr's owned Homarr key is missing; run self-host setup tracearr, then self-host setup homarr", helpers.ErrManual)
	}
	resp, err := h.HTTP(ctx, helpers.Request{
		Path: "/api/v1/public/health", NoRedirect: true,
		Header: map[string]string{"Authorization": "Bearer " + key},
	})
	if err != nil {
		return health, err
	}
	if resp.Status != 200 {
		return health, fmt.Errorf("Tracearr Homarr authentication/readiness returned HTTP %d; run self-host setup tracearr", resp.Status)
	}
	if resp.Decode(&health) != nil || health.Status != "ok" || health.Servers == nil || health.Timestamp.IsZero() {
		return health, errors.New("Tracearr returned incomplete authenticated health data")
	}
	if !helpers.VersionCompatible(health.Version, "2.6.0") {
		return health, errors.New("Tracearr Homarr Link requires Tracearr 2.6.0 or newer 2.x; back up the App before changing versions")
	}
	age := h.Now().Sub(health.Timestamp)
	if age < -5*time.Second || age > 30*time.Second {
		return health, errors.New("Tracearr returned stale authenticated health data; check the Host clock and retry Setup")
	}
	return health, nil
}

func VerifyHomarr(ctx context.Context, h *helpers.H) error {
	health, err := readHomarrHealth(ctx, h)
	if err != nil {
		return err
	}
	resp, err := h.HTTP(ctx, helpers.Request{Path: "/health", NoRedirect: true})
	if err != nil {
		return err
	}
	var ready struct {
		Status string `json:"status"`
		Mode   string `json:"mode"`
		DB     *bool  `json:"db"`
		Redis  *bool  `json:"redis"`
	}
	if resp.Status != 200 || resp.Decode(&ready) != nil || ready.Status != "ok" || ready.Mode != "ready" || ready.DB == nil || !*ready.DB || ready.Redis == nil || !*ready.Redis {
		return errors.New("Tracearr's database, cache or startup is unavailable; run self-host setup tracearr before linking Homarr")
	}
	if len(health.Servers) == 0 {
		return fmt.Errorf("%w: Tracearr has no attached media server; approve a scoped owned Plex, Jellyfin or Emby connection separately, then retry self-host setup homarr", helpers.ErrManual)
	}
	for _, server := range health.Servers {
		if server.ID == "" || server.ActiveStreams == nil || *server.ActiveStreams < 0 || server.Online == nil || server.Historical == nil {
			return errors.New("Tracearr returned incomplete media-server readiness data")
		}
		if server.Type != "plex" && server.Type != "jellyfin" && server.Type != "emby" {
			return errors.New("Tracearr returned an unsupported media-server type")
		}
		if *server.Historical || !*server.Online {
			return fmt.Errorf("%w: a Tracearr media server is historical or offline; approve its recovery separately before retrying self-host setup homarr", helpers.ErrManual)
		}
	}
	return nil
}
