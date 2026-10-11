package emby

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"net/url"

	"github.com/ajnart/self-host/internal/helpers"
)

const homarrKeyName = "self-host Homarr"

var errAPIKeyRejected = errors.New("Emby rejected the API key; run self-host setup emby")

func APIKey(h *helpers.H) string { return h.Secret(h.Key("homarr_api_key")) }

func verifyServer(ctx context.Context, h *helpers.H, key string) error {
	resp, err := h.HTTP(ctx, helpers.Request{Path: "/emby/System/Info", Header: embyHeader(key), NoRedirect: true})
	if err != nil {
		return err
	}
	if resp.Status == http.StatusUnauthorized || resp.Status == http.StatusForbidden {
		return errAPIKeyRejected
	}
	var info struct{ ID, Version string }
	if resp.Status != http.StatusOK || resp.Decode(&info) != nil || info.ID == "" || info.Version != "4.10.0.40" {
		return errors.New("Emby must return authenticated server information for version 4.10.0.40; run self-host setup emby")
	}
	return nil
}

func VerifyHomarr(ctx context.Context, h *helpers.H) error {
	key := APIKey(h)
	if key == "" {
		return errors.New("Emby Homarr API key is missing; run self-host setup emby")
	}
	if err := verifyServer(ctx, h, key); err != nil {
		return err
	}
	managed, err := findHomarrKey(ctx, h, key)
	if err != nil {
		return err
	}
	if managed != key {
		return errors.New("Emby saved credential is not its dedicated Homarr API key; inspect Security and retry self-host setup emby")
	}
	resp, err := h.HTTP(ctx, helpers.Request{Path: "/emby/Sessions", Header: embyHeader(key), NoRedirect: true})
	if err != nil {
		return err
	}
	if resp.Status == http.StatusUnauthorized || resp.Status == http.StatusForbidden {
		return errAPIKeyRejected
	}
	var sessions []struct{ ID string }
	if resp.Status != http.StatusOK || resp.Decode(&sessions) != nil || sessions == nil {
		return errors.New("Emby did not return authenticated sessions; run self-host setup emby")
	}
	for _, session := range sessions {
		if session.ID == "" {
			return errors.New("Emby returned an incomplete session")
		}
	}
	return nil
}

type apiKey struct {
	AccessToken string
	AppName     string
	IsActive    *bool
}

func findHomarrKey(ctx context.Context, h *helpers.H, token string) (string, error) {
	resp, err := h.HTTP(ctx, helpers.Request{Path: "/Auth/Keys", Header: embyHeader(token), NoRedirect: true})
	if err != nil {
		return "", err
	}
	var inventory struct {
		Items            []apiKey
		TotalRecordCount *int
	}
	if resp.Status != http.StatusOK || resp.Decode(&inventory) != nil || inventory.Items == nil || inventory.TotalRecordCount == nil || *inventory.TotalRecordCount != len(inventory.Items) {
		return "", errors.New("Emby API-key inventory is incomplete; inspect Security before retrying")
	}
	found := ""
	for _, item := range inventory.Items {
		h.Log.Secret(item.AccessToken)
		if item.AccessToken == "" || item.AppName == "" || item.IsActive == nil {
			return "", errors.New("Emby API-key inventory has missing fields; inspect Security before retrying")
		}
		if item.AppName != homarrKeyName {
			continue
		}
		if found != "" || item.AccessToken == "" || item.IsActive == nil || !*item.IsActive {
			return "", helpers.ErrManual
		}
		found = item.AccessToken
	}
	return found, nil
}

func createHomarrKey(ctx context.Context, h *helpers.H) error {
	if APIKey(h) != "" {
		if err := VerifyHomarr(ctx, h); err != nil {
			if errors.Is(err, errAPIKeyRejected) {
				return fmt.Errorf("%w: the saved Emby key is rejected; restore it before retrying", helpers.ErrManual)
			}
			return err
		}
		return nil
	}
	token, err := signIn(ctx, h, h.AdminUser(), h.AdminPassword())
	if err != nil {
		return err
	}
	if token == "" {
		return helpers.ErrManual
	}
	defer logout(ctx, h, token)
	if err := verifyServer(ctx, h, token); err != nil {
		return err
	}
	key, err := findHomarrKey(ctx, h, token)
	if err != nil {
		return err
	}
	if key == "" {
		if h.Secret(h.Key("homarr_key_created")) != "" {
			return helpers.ErrManual
		}
		if err := h.SetSecret(h.Key("homarr_key_created"), "pending"); err != nil {
			return err
		}
		resp, err := h.HTTP(ctx, helpers.Request{
			Method: http.MethodPost, Path: "/Auth/Keys?App=" + url.QueryEscape(homarrKeyName), Header: embyHeader(token), NoRedirect: true,
		})
		if err != nil {
			return err
		}
		if !resp.OK() {
			return fmt.Errorf("Emby key creation returned HTTP %d; inspect Security before retrying", resp.Status)
		}
		key, err = findHomarrKey(ctx, h, token)
		if err != nil {
			return err
		}
		if key == "" {
			return errors.New("Emby did not list the new API key; inspect Security before retrying")
		}
	}
	if key == token {
		return errors.New("Emby returned a login session instead of an API key")
	}
	if err := h.SetSecret(h.Key("homarr_api_key"), key); err != nil {
		return err
	}
	return VerifyHomarr(ctx, h)
}

func VerifyReleases(ctx context.Context, h *helpers.H) error {
	if err := VerifyHomarr(ctx, h); err != nil {
		return err
	}
	resp, err := h.HTTP(ctx, helpers.Request{Path: "/Users/Public", Header: embyHeader(APIKey(h)), NoRedirect: true})
	if err != nil {
		return err
	}
	var users []struct{ ID, Name string }
	if resp.Status != http.StatusOK || resp.Decode(&users) != nil || users == nil {
		return errors.New("Emby did not return its public user list")
	}
	if len(users) == 0 {
		return fmt.Errorf("%w: Homarr Media Releases requires a visible local Emby user; select one in Emby before retrying self-host setup homarr", helpers.ErrManual)
	}
	if users[0].ID == "" || users[0].Name == "" {
		return errors.New("Emby returned an incomplete public user")
	}
	path := "/Users/" + url.PathEscape(users[0].ID) + "/Items/Latest?Limit=100&Fields=CommunityRating,Studios,PremiereDate,Genres,ChildCount,ProductionYear,DateCreated,Overview,Taglines"
	resp, err = h.HTTP(ctx, helpers.Request{Path: path, Header: embyHeader(APIKey(h)), NoRedirect: true})
	if err != nil {
		return err
	}
	var items []struct{ ID string }
	if resp.Status != http.StatusOK || resp.Decode(&items) != nil || items == nil {
		return errors.New("Emby did not return the selected user's latest media")
	}
	for _, item := range items {
		if item.ID == "" {
			return errors.New("Emby returned an incomplete latest media item")
		}
	}
	return nil
}
