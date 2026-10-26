package homeassistant

import (
	"context"
	"crypto/rand"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"regexp"
	"slices"
	"strings"
	"time"

	"github.com/ajnart/self-host/internal/helpers"
)

const supportedVersion = "2026.9.3"

var entityIDPattern = regexp.MustCompile(`^[a-z_]+\.[a-z0-9_]+$`)

func validateEntityID(value string) error {
	if value != "" && !entityIDPattern.MatchString(value) {
		return errors.New("use an existing Home Assistant entity ID such as domain.name")
	}
	return nil
}

type authResult struct {
	Status  string `json:"status"`
	UserID  string `json:"user_id"`
	TokenID string `json:"token_id"`
	Token   string `json:"token"`
}

func authAPI(ctx context.Context, h *helpers.H, mode string) (authResult, error) {
	if h.Config.Exec == nil {
		return authResult{}, fmt.Errorf("%w: the Home Assistant authentication helper is unavailable", helpers.ErrManual)
	}
	ctx, cancel := context.WithTimeout(ctx, time.Minute)
	defer cancel()
	result, err := h.Exec(ctx, map[string]string{
		"SELF_HOST_MODE": mode, "SELF_HOST_ADMIN_USER": h.AdminUser(), "SELF_HOST_ADMIN_PASSWORD": h.AdminPassword(),
		"SELF_HOST_USER_ID": h.Secret(h.Key("homarr_user_id")), "SELF_HOST_PASSWORD": h.Secret(h.Key("homarr_password")),
		"SELF_HOST_TOKEN": h.Secret(h.Key("homarr_token")), "SELF_HOST_TOKEN_ID": h.Secret(h.Key("homarr_token_id")),
	}, "python3", "-c", homarrAuthScript)
	h.Log.Secret(string(result.Stdout))
	if err != nil {
		return authResult{}, errors.New("Home Assistant could not run its authentication API helper; check its supported image and retry Setup")
	}
	var decoded authResult
	if json.Unmarshal(result.Stdout, &decoded) != nil {
		return authResult{}, errors.New("Home Assistant returned an invalid authentication helper result")
	}
	h.Log.Secret(decoded.Token)
	return decoded, nil
}

func authResultError(result authResult) error {
	switch result.Status {
	case "ok":
		if result.UserID == "" || result.TokenID == "" {
			return errors.New("Home Assistant returned incomplete Homarr token metadata")
		}
		return nil
	case "manual":
		return fmt.Errorf("%w: review the dedicated Homarr identity and token in Home Assistant; no account, password or token was replaced", helpers.ErrManual)
	case "unsupported":
		return fmt.Errorf("Home Assistant is unsupported; use %s or newer in the same year series, then retry Setup after a Backup", supportedVersion)
	default:
		return errors.New("Home Assistant authentication API verification failed; retry Setup after checking the App")
	}
}

func VerifyHomarr(ctx context.Context, h *helpers.H) error {
	if h.Secret(h.Key("homarr_token")) == "" || h.Secret(h.Key("homarr_user_id")) == "" || h.Secret(h.Key("homarr_token_id")) == "" {
		return fmt.Errorf("%w: the dedicated Home Assistant long-lived access token is missing; run self-host setup home-assistant", helpers.ErrManual)
	}
	result, err := authAPI(ctx, h, "verify")
	if err != nil {
		return err
	}
	if err := authResultError(result); err != nil {
		return err
	}
	if result.UserID != h.Secret(h.Key("homarr_user_id")) || result.TokenID != h.Secret(h.Key("homarr_token_id")) {
		return errors.New("Home Assistant Homarr token ownership changed; review the dedicated identity before retrying Setup")
	}
	_, err = homarrRead(ctx, h, "/api/config", new(map[string]any))
	return err
}

func setupHomarr(ctx context.Context, h *helpers.H) error {
	if err := h.Step(ctx, "homarr-token", "create a read-only Home Assistant token for Homarr", helpers.StepSpec{
		Check: func(ctx context.Context) (bool, error) { return true, VerifyHomarr(ctx, h) },
		Do: func(ctx context.Context) error {
			if h.Secret(h.Key("homarr_password")) == "" {
				if h.Secret(h.Key("homarr_user_id")) != "" {
					return fmt.Errorf("%w: restore the saved Homarr password through the Project secret boundary; do not reset an existing user's password", helpers.ErrManual)
				}
				if err := h.SetSecret(h.Key("homarr_password"), rand.Text()); err != nil {
					return err
				}
			}
			result, err := authAPI(ctx, h, "ensure")
			if err != nil {
				return err
			}
			if result.UserID != "" && h.Secret(h.Key("homarr_user_id")) == "" {
				if err := h.SetSecret(h.Key("homarr_user_id"), result.UserID); err != nil {
					return err
				}
			}
			if err := authResultError(result); err != nil {
				return err
			}
			if result.Token != "" {
				if err := h.SetSecret(h.Key("homarr_token"), result.Token); err != nil {
					return err
				}
			}
			return h.SetSecret(h.Key("homarr_token_id"), result.TokenID)
		},
		Hint:       "Open " + h.URL + "/profile/security. Finish any required owner login or MFA without disabling it. The dedicated self-host-homarr user must remain Read Only and local-only. Restore its saved password from a Backup, or remove only its self-host Homarr long-lived token and retry self-host setup home-assistant. Never supply a refresh token or onboarding code. For browser-only issuance, sign in as that dedicated user using self-host credentials and create self-host Homarr under Long-Lived Access Tokens; import it privately with self-host install home-assistant --set-file home-assistant.homarr_token=- --yes, then retry Setup to verify it.",
		Credential: "admin",
	}); err != nil {
		return err
	}
	return h.Step(ctx, "homarr-entity", "select an existing read-only Home Assistant entity", helpers.StepSpec{
		Check: func(ctx context.Context) (bool, error) {
			if selected := h.Inputs["homarr_entity_id"]; selected != "" && selected != h.Secret(h.Key("homarr_entity_id")) {
				return false, nil
			}
			_, err := HomarrEntity(ctx, h)
			return err == nil, err
		},
		Do: func(ctx context.Context) error {
			selected := h.Inputs["homarr_entity_id"]
			if selected == "" {
				selected = h.Secret(h.Key("homarr_entity_id"))
			}
			if selected != "" {
				if _, err := readEntity(ctx, h, selected); err != nil {
					return err
				}
				return h.SetSecret(h.Key("homarr_entity_id"), selected)
			}
			var entities []Entity
			if _, err := homarrRead(ctx, h, "/api/states", &entities); err != nil {
				return err
			}
			if entities == nil {
				return errors.New("Home Assistant did not return an entity list")
			}
			slices.SortFunc(entities, func(a, b Entity) int { return strings.Compare(a.ID, b.ID) })
			for _, entity := range entities {
				if (strings.HasPrefix(entity.ID, "sun.") || strings.HasPrefix(entity.ID, "input_text.")) && entity.State != "unknown" && entity.State != "unavailable" {
					if _, err := readEntity(ctx, h, entity.ID); err != nil {
						return err
					}
					return h.SetSecret(h.Key("homarr_entity_id"), entity.ID)
				}
			}
			return fmt.Errorf("%w: Home Assistant has no usable Sun or text helper entity; select an existing safe entity explicitly", helpers.ErrManual)
		},
		Hint: "In Home Assistant, choose an existing entity from Developer tools > States, or create a harmless text helper. Use self-host install home-assistant --set home-assistant.homarr_entity_id=<selected-id> --yes, then self-host setup homarr. No hardware or automation control is enabled.",
	})
}

type Entity struct {
	ID          string         `json:"entity_id"`
	State       string         `json:"state"`
	LastChanged string         `json:"last_changed"`
	LastUpdated string         `json:"last_updated"`
	Attributes  map[string]any `json:"attributes"`
}

func homarrRead(ctx context.Context, h *helpers.H, path string, value any) (helpers.Response, error) {
	response, err := h.HTTP(ctx, helpers.Request{Path: path, NoRedirect: true, Header: map[string]string{"Authorization": "Bearer " + h.Secret(h.Key("homarr_token"))}})
	if err != nil {
		return response, errors.New("Home Assistant could not be reached; check the App and retry Setup")
	}
	if response.Status == http.StatusUnauthorized || response.Status == http.StatusForbidden {
		return response, errors.New("Home Assistant rejected its saved Homarr access token; run self-host setup home-assistant")
	}
	if response.Status == http.StatusNotFound && strings.HasPrefix(path, "/api/states/") {
		return response, fmt.Errorf("%w: the selected Home Assistant entity is missing; restore it or explicitly select another entity", helpers.ErrManual)
	}
	if response.Status != http.StatusOK || response.Decode(value) != nil {
		return response, errors.New("Home Assistant did not return the required authenticated API data; run self-host setup home-assistant")
	}
	if path == "/api/config" {
		config, ok := value.(*map[string]any)
		if !ok || !compatibleVersion(*config) {
			return response, fmt.Errorf("Home Assistant is unsupported; use %s or newer after a Backup and retry Setup", supportedVersion)
		}
	}
	return response, nil
}

func HomarrEntity(ctx context.Context, h *helpers.H) (Entity, error) {
	id := h.Secret(h.Key("homarr_entity_id"))
	if id == "" {
		return Entity{}, fmt.Errorf("%w: no Home Assistant entity is selected; run self-host setup home-assistant", helpers.ErrManual)
	}
	return readEntity(ctx, h, id)
}

func readEntity(ctx context.Context, h *helpers.H, id string) (Entity, error) {
	if err := validateEntityID(id); err != nil {
		return Entity{}, err
	}
	var entity Entity
	if _, err := homarrRead(ctx, h, "/api/states/"+id, &entity); err != nil {
		return Entity{}, err
	}
	if entity.ID != id || entity.State == "" || entity.Attributes == nil {
		return Entity{}, errors.New("Home Assistant returned incomplete entity data")
	}
	if entity.State == "unknown" || entity.State == "unavailable" {
		return Entity{}, fmt.Errorf("%w: the selected Home Assistant entity has no available state; check it or select another entity", helpers.ErrManual)
	}
	for _, stamp := range []string{entity.LastChanged, entity.LastUpdated} {
		if _, err := time.Parse(time.RFC3339Nano, stamp); err != nil {
			return Entity{}, errors.New("Home Assistant returned incomplete entity timestamps")
		}
	}
	return entity, nil
}

func onboardingComplete(ctx context.Context, h *helpers.H) error {
	response, err := h.HTTP(ctx, helpers.Request{Path: "/api/onboarding", NoRedirect: true})
	if err != nil {
		return err
	}
	if response.Status == http.StatusNotFound {
		return nil
	}
	var steps []struct {
		Step string `json:"step"`
		Done bool   `json:"done"`
	}
	if response.Status != http.StatusOK || response.Decode(&steps) != nil || len(steps) == 0 {
		return errors.New("Home Assistant did not return its onboarding status")
	}
	done := map[string]bool{}
	for _, step := range steps {
		done[step.Step] = step.Done
	}
	for _, step := range []string{"user", "core_config", "analytics", "integration"} {
		if !done[step] {
			return fmt.Errorf("%w: Home Assistant onboarding still needs a person's choices; owner creation does not approve provider or hardware actions", helpers.ErrManual)
		}
	}
	return nil
}

func onboarding(ctx context.Context, h *helpers.H) error {
	return h.Step(ctx, "onboarding", "review Home Assistant's remaining first-run choices", helpers.StepSpec{
		Check: func(ctx context.Context) (bool, error) { return true, onboardingComplete(ctx, h) },
		Do: func(ctx context.Context) error {
			if err := finishOnboarding(ctx, h); err != nil {
				return err
			}
			return onboardingComplete(ctx, h)
		},
		Hint: "Open " + h.URL + " and review the remaining core_config, analytics and integration choices; do not approve hardware, network discovery or external accounts implicitly. Then run self-host setup home-assistant and self-host setup homarr.",
	})
}

func compatibleVersion(config map[string]any) bool {
	version, _ := config["version"].(string)
	return helpers.VersionAtLeast(version, supportedVersion)
}
