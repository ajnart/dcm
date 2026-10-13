package sabnzbd

import (
	"context"
	"errors"
	"math"
	"strconv"
	"strings"

	"github.com/ajnart/self-host/internal/helpers"
)

func VerifyHomarr(ctx context.Context, h *helpers.H) error {
	version, err := verifyAPIKey(ctx, h, h.Secret(h.Key("api_key")))
	if err != nil {
		return err
	}
	if version != "5.1.3" {
		return errors.New("SABnzbd version is unsupported by the Homarr Link; back up the App and use version 5.1.3, then retry self-host setup homarr")
	}
	return nil
}

func verifyAPIKey(ctx context.Context, h *helpers.H, key string) (string, error) {
	if key == "" {
		return "", errors.New("SABnzbd full API key is missing; run self-host setup sabnzbd")
	}
	h.Log.Secret(key)
	auth, err := apiForm(ctx, h, map[string]string{"mode": "auth", "key": key})
	if err != nil {
		return "", err
	}
	if auth["auth"] != "apikey" {
		return "", errors.New("SABnzbd requires its full API key, not the NZB upload key; run self-host setup sabnzbd")
	}
	result, err := apiForm(ctx, h, map[string]string{"mode": "queue", "apikey": key, "limit": "1"})
	if err != nil {
		return "", err
	}
	queue, ok := result["queue"].(map[string]any)
	if !ok {
		return "", errors.New("SABnzbd did not return authenticated queue data")
	}
	version, ok := queue["version"].(string)
	if !ok || strings.TrimSpace(version) == "" {
		return "", errors.New("SABnzbd did not return its current queue version; retry self-host setup sabnzbd")
	}
	_, paused := queue["paused"].(bool)
	rate, numeric := queue["kbpersec"].(string)
	speed, parseErr := strconv.ParseFloat(rate, 64)
	_, slots := queue["slots"].([]any)
	if !paused || !numeric || parseErr != nil || math.IsNaN(speed) || math.IsInf(speed, 0) || speed < 0 || !slots {
		return "", errors.New("SABnzbd returned incomplete queue data; retry self-host setup sabnzbd")
	}
	result, err = apiForm(ctx, h, map[string]string{"mode": "history", "apikey": key, "limit": "1"})
	if err != nil {
		return "", err
	}
	history, ok := result["history"].(map[string]any)
	if !ok {
		return "", errors.New("SABnzbd did not return authenticated history data")
	}
	if _, ok := history["slots"].([]any); !ok {
		return "", errors.New("SABnzbd returned incomplete history data; an empty history must explicitly contain an empty slots array")
	}
	return version, nil
}

func providerConfigured(ctx context.Context, h *helpers.H) (bool, error) {
	result, err := apiForm(ctx, h, map[string]string{"mode": "get_config", "section": "servers", "apikey": h.Secret(h.Key("api_key"))})
	if err != nil {
		return false, err
	}
	config, ok := result["config"].(map[string]any)
	if !ok {
		return false, errors.New("SABnzbd did not return its provider configuration; retry self-host setup sabnzbd")
	}
	if len(config) == 0 {
		return false, nil
	}
	servers, ok := config["servers"].([]any)
	if !ok {
		return false, errors.New("SABnzbd did not return its provider configuration; retry self-host setup sabnzbd")
	}
	for _, raw := range servers {
		server, ok := raw.(map[string]any)
		if !ok {
			return false, errors.New("SABnzbd returned incomplete provider configuration")
		}
		enabled, ok := server["enable"].(float64)
		host, hasHost := server["host"].(string)
		connections, hasConnections := server["connections"].(float64)
		if !ok || enabled != 0 && enabled != 1 || !hasHost || !hasConnections {
			return false, errors.New("SABnzbd returned incomplete provider configuration")
		}
		if enabled == 1 && host != "" && connections > 0 {
			return true, nil
		}
	}
	return false, nil
}
