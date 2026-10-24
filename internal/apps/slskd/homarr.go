package slskd

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/ajnart/self-host/internal/helpers"
)

type serverState struct {
	IsConnected *bool `json:"isConnected"`
	IsLoggedIn  *bool `json:"isLoggedIn"`
}

type downloadUser struct {
	Directories []struct {
		Files []struct {
			ID              string   `json:"id"`
			Filename        string   `json:"filename"`
			Size            *float64 `json:"size"`
			PercentComplete *float64 `json:"percentComplete"`
			AverageSpeed    *float64 `json:"averageSpeed"`
			State           string   `json:"state"`
			RequestedAt     string   `json:"requestedAt"`
		} `json:"files"`
	} `json:"directories"`
}

func apiRead(ctx context.Context, h *helpers.H, path string) (helpers.Response, error) {
	key := h.Secret(h.Key("api_key"))
	if len(key) < 16 || len(key) > 255 || strings.ContainsAny(key, ";\r\n") {
		return helpers.Response{}, errors.New("the saved Slskd primary API key is missing or invalid; restore it through the Project secret boundary, then run self-host update slskd and self-host setup slskd")
	}
	response, err := h.HTTP(ctx, helpers.Request{Path: path, NoRedirect: true, Header: map[string]string{"X-API-Key": key}})
	if err != nil {
		return response, errors.New("Slskd's local API could not be reached; inspect self-host logs slskd and retry self-host setup slskd")
	}
	if response.Status != http.StatusOK {
		return response, fmt.Errorf("Slskd rejected the local API read (HTTP %d); verify its primary API key and run self-host setup slskd", response.Status)
	}
	return response, nil
}

func VerifyHomarr(ctx context.Context, h *helpers.H) error {
	enabled, err := h.HTTP(ctx, helpers.Request{Path: "/api/v0/session/enabled", NoRedirect: true})
	if err != nil {
		return errors.New("Slskd authentication could not be checked; retry self-host setup slskd")
	}
	var authenticationEnabled bool
	if enabled.Status != http.StatusOK || enabled.Decode(&authenticationEnabled) != nil || !authenticationEnabled {
		return errors.New("Slskd authentication must remain enabled; restore it and retry self-host setup slskd")
	}
	response, err := apiRead(ctx, h, "/api/v0/application/version")
	if err != nil {
		return err
	}
	var version string
	if response.Decode(&version) != nil || !helpers.VersionCompatible(version, "0.26.1") {
		return errors.New("this Slskd Link supports Slskd 0.26.1 or newer 0.x; back up Slskd, run self-host update slskd, then retry self-host setup slskd")
	}
	if _, err := readServer(ctx, h); err != nil {
		return err
	}
	response, err = apiRead(ctx, h, "/api/v0/transfers/downloads")
	if err != nil {
		return err
	}
	var downloads []downloadUser
	if response.Decode(&downloads) != nil || downloads == nil {
		return errors.New("Slskd did not return a download list; retry self-host setup slskd")
	}
	for _, user := range downloads {
		if user.Directories == nil {
			return errors.New("Slskd returned incomplete download directories; retry self-host setup slskd")
		}
		for _, directory := range user.Directories {
			if directory.Files == nil {
				return errors.New("Slskd returned an incomplete download file list; retry self-host setup slskd")
			}
			for _, file := range directory.Files {
				if file.ID == "" || file.Filename == "" || file.State == "" || file.Size == nil || *file.Size < 0 || file.AverageSpeed == nil || *file.AverageSpeed < 0 || file.PercentComplete == nil || *file.PercentComplete < 0 || *file.PercentComplete > 100 {
					return errors.New("Slskd returned incomplete download data; retry self-host setup slskd")
				}
				if _, err := time.Parse("2006-01-02T15:04:05.999999999", file.RequestedAt); err != nil {
					if _, err := time.Parse(time.RFC3339Nano, file.RequestedAt); err != nil {
						return errors.New("Slskd returned an invalid download request time; retry self-host setup slskd")
					}
				}
			}
		}
	}
	return nil
}

func readServer(ctx context.Context, h *helpers.H) (serverState, error) {
	response, err := apiRead(ctx, h, "/api/v0/application")
	if err != nil {
		return serverState{}, err
	}
	var application struct {
		Server serverState `json:"server"`
	}
	if response.Decode(&application) != nil || application.Server.IsConnected == nil || application.Server.IsLoggedIn == nil {
		return application.Server, errors.New("Slskd did not return its Soulseek connection state; retry self-host setup slskd")
	}
	return application.Server, nil
}

func soulseekReady(ctx context.Context, h *helpers.H) (bool, error) {
	state, err := readServer(ctx, h)
	if err != nil {
		return false, err
	}
	return *state.IsConnected && *state.IsLoggedIn, nil
}

func soulseekHint(h *helpers.H) string {
	return "Open " + h.URL + " and configure your own Soulseek account privately in Slskd. After separately approving network use and connecting, run self-host setup slskd, then self-host setup homarr. The Web UI Admin login is not a Soulseek account; an empty download list does not prove that account works."
}

func VerifySoulseek(ctx context.Context, h *helpers.H) error {
	ready, err := soulseekReady(ctx, h)
	if err != nil {
		return err
	}
	if !ready {
		h.Info(soulseekHint(h))
		return helpers.ErrManual
	}
	return nil
}
