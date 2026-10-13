package helpers

import (
	"context"
	"time"
)

type KeyScheme struct {
	Header string
	Prefix string
	Suffix string
}

func (s KeyScheme) Headers(key string) map[string]string {
	return map[string]string{s.Header: s.Prefix + key + s.Suffix}
}

type APIKey struct {
	Msg        string
	Hint       string
	Credential string
	Scheme     KeyScheme
	Probe      string
	Discover   func(ctx context.Context, h *H) (string, error)
}

func ConfigKey(rel string, extract Extractor, timeout time.Duration) func(context.Context, *H) (string, error) {
	return func(ctx context.Context, h *H) (string, error) {
		return h.ConfigValue(ctx, rel, extract, timeout)
	}
}

func (h *H) APIKeyAccepted(ctx context.Context, k APIKey) (bool, error) {
	key := h.Secret(h.Key("api_key"))
	if key == "" {
		return false, nil
	}
	resp, err := h.HTTP(ctx, Request{Path: k.Probe, Header: k.Scheme.Headers(key)})
	return err == nil && resp.Status == 200, err
}

func (h *H) APIKeyStep(ctx context.Context, k APIKey) error {
	return h.Step(ctx, "api-key", k.Msg, StepSpec{
		Check:      func(ctx context.Context) (bool, error) { return h.APIKeyAccepted(ctx, k) },
		Do:         func(ctx context.Context) error { return h.StoreAPIKey(ctx, k) },
		Hint:       k.Hint,
		Credential: k.Credential,
	})
}

func (h *H) StoreAPIKey(ctx context.Context, k APIKey) error {
	key, err := k.Discover(ctx, h)
	if err != nil {
		return err
	}
	return h.SetSecret(h.Key("api_key"), key)
}
