package bazarr

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"strings"

	"github.com/ajnart/self-host/internal/helpers"
)

var errAPIKeyRejected = errors.New("Bazarr rejected its saved API key; run self-host setup bazarr")

func setupAPIKey(ctx context.Context, h *helpers.H) error {
	return h.Step(ctx, "api-key", "verify Bazarr's subtitle API access", helpers.StepSpec{
		Check: func(ctx context.Context) (bool, error) {
			err := VerifyHomarr(ctx, h)
			return err == nil, err
		},
		Do: func(ctx context.Context) error {
			if key := h.Secret(h.Key("api_key")); key != "" {
				if err := verifyAPIKey(ctx, h, key); !errors.Is(err, errAPIKeyRejected) {
					return err
				}
			}
			key, err := apiKey(ctx, h)
			if err != nil {
				return err
			}
			if err := verifyAPIKey(ctx, h, key); err != nil {
				return err
			}
			return h.SetSecret(h.Key("api_key"), key)
		},
		Hint: "Settings > General > Security: verify the API key and keep Basic authentication enabled, then run self-host setup bazarr followed by self-host setup homarr. Subtitle providers and language profiles remain your choice.",
	})
}

func VerifyHomarr(ctx context.Context, h *helpers.H) error {
	key := h.Secret(h.Key("api_key"))
	if key == "" {
		return errors.New("Bazarr's saved API key is missing; run self-host setup bazarr before self-host setup homarr")
	}
	return verifyAPIKey(ctx, h, key)
}

func verifyAPIKey(ctx context.Context, h *helpers.H, key string) error {
	h.Log.Secret(key)
	var status struct {
		Data struct {
			Version string `json:"bazarr_version"`
		} `json:"data"`
	}
	if err := readAPI(ctx, h, key, "/api/system/status", &status); err != nil {
		return err
	}
	if strings.TrimSpace(status.Data.Version) == "" {
		return errors.New("Bazarr returned no API version; inspect its Status and retry self-host setup bazarr")
	}
	var badges struct {
		Episodes      *int    `json:"episodes"`
		Movies        *int    `json:"movies"`
		Providers     *int    `json:"providers"`
		Status        *int    `json:"status"`
		SonarrSignalR *string `json:"sonarr_signalr"`
		RadarrSignalR *string `json:"radarr_signalr"`
		Announcements *int    `json:"announcements"`
	}
	if err := readAPI(ctx, h, key, "/api/badges", &badges); err != nil {
		return err
	}
	for _, count := range []*int{badges.Episodes, badges.Movies, badges.Providers, badges.Status, badges.Announcements} {
		if count == nil || *count < 0 {
			return errors.New("Bazarr returned incomplete subtitle counts; retry self-host setup bazarr")
		}
	}
	if badges.SonarrSignalR == nil || badges.RadarrSignalR == nil {
		return errors.New("Bazarr returned incomplete media connection status; retry self-host setup bazarr")
	}
	return nil
}

func readAPI(ctx context.Context, h *helpers.H, key, path string, value any) error {
	resp, err := h.HTTP(ctx, helpers.Request{Path: path, Header: map[string]string{"X-API-KEY": key}})
	if err != nil {
		return h.Log.RedactError(err)
	}
	if resp.Status == http.StatusUnauthorized || resp.Status == http.StatusForbidden {
		return errAPIKeyRejected
	}
	if resp.Status != http.StatusOK {
		return fmt.Errorf("Bazarr %s returned HTTP %d; inspect its Status and retry self-host setup bazarr", path, resp.Status)
	}
	if err := resp.Decode(value); err != nil {
		return fmt.Errorf("Bazarr %s returned invalid API data; retry self-host setup bazarr", path)
	}
	return nil
}
