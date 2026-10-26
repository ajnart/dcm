package homeassistant

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"net/url"

	"github.com/ajnart/self-host/internal/helpers"
)

// finishOnboarding saves the wizard steps after the owner exists with the
// choices the web UI's default buttons make: no analytics sharing, default
// core configuration, and no integration chosen. Each step is skipped once
// done, so a rerun changes nothing.
func finishOnboarding(ctx context.Context, h *helpers.H) error {
	pending, err := pendingOnboarding(ctx, h)
	if err != nil || len(pending) == 0 {
		return err
	}
	outcome, err := submitLogin(ctx, h, h.AdminUser(), h.AdminPassword())
	if err != nil {
		return err
	}
	if outcome.Type != "create_entry" || outcome.Result == "" {
		return fmt.Errorf("%w: sign in to Home Assistant with the Admin login to finish onboarding", helpers.ErrManual)
	}
	id := clientID(h)
	tokens, err := h.Expect(ctx, helpers.Request{
		Method: http.MethodPost, Path: "/auth/token",
		Form: url.Values{"grant_type": {"authorization_code"}, "code": {outcome.Result}, "client_id": {id}},
	})
	if err != nil {
		return err
	}
	var issued struct {
		AccessToken  string `json:"access_token"`
		RefreshToken string `json:"refresh_token"`
	}
	if err := tokens.Decode(&issued); err != nil {
		return err
	}
	h.Log.Secret(issued.AccessToken)
	h.Log.Secret(issued.RefreshToken)
	defer h.HTTP(ctx, helpers.Request{
		Method: http.MethodPost, Path: "/auth/revoke", Form: url.Values{"token": {issued.RefreshToken}},
	})
	bodies := map[string]map[string]any{
		"core_config": {},
		"analytics":   {},
		"integration": {"client_id": id, "redirect_uri": id},
	}
	var errs []error
	for _, step := range []string{"core_config", "analytics", "integration"} {
		if !pending[step] {
			continue
		}
		_, err := h.Expect(ctx, helpers.Request{
			Method: http.MethodPost, Path: "/api/onboarding/" + step, JSON: bodies[step],
			Header: map[string]string{"Authorization": "Bearer " + issued.AccessToken},
		})
		if err != nil {
			errs = append(errs, fmt.Errorf("onboarding step %s: %w", step, err))
		}
	}
	return errors.Join(errs...)
}

func pendingOnboarding(ctx context.Context, h *helpers.H) (map[string]bool, error) {
	response, err := h.HTTP(ctx, helpers.Request{Path: "/api/onboarding", NoRedirect: true})
	if err != nil {
		return nil, err
	}
	pending := map[string]bool{}
	if response.Status == http.StatusNotFound {
		return pending, nil
	}
	var steps []struct {
		Step string `json:"step"`
		Done bool   `json:"done"`
	}
	if response.Status != http.StatusOK {
		return nil, fmt.Errorf("GET /api/onboarding returned HTTP %d", response.Status)
	}
	if err := response.Decode(&steps); err != nil {
		return nil, err
	}
	for _, step := range steps {
		if step.Step != "user" && !step.Done {
			pending[step.Step] = true
		}
	}
	return pending, nil
}
