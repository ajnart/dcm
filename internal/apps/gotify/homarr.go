package gotify

import (
	"context"
	"crypto/rand"
	"errors"
	"fmt"
	"net/http"
	"strconv"
	"time"

	"github.com/ajnart/self-host/internal/helpers"
)

const homarrUsername = "self-host-homarr"

func homarrLoginWorks(ctx context.Context, h *helpers.H) (bool, error) {
	username := h.Secret(h.Key("homarr_username"))
	password := h.Secret(h.Key("homarr_password"))
	id, err := strconv.ParseUint(h.Secret(h.Key("homarr_user_id")), 10, 64)
	if username != homarrUsername || password == "" || err != nil || id == 0 {
		return false, nil
	}
	response, err := h.HTTP(ctx, helpers.Request{Path: "/current/user", NoRedirect: true, User: username, Password: password})
	if err != nil {
		return false, err
	}
	if response.Status == http.StatusUnauthorized || response.Status == http.StatusForbidden {
		return false, nil
	}
	if response.Status != http.StatusOK {
		return false, fmt.Errorf("Gotify Homarr login returned HTTP %d; run self-host setup gotify", response.Status)
	}
	var current account
	if response.Decode(&current) != nil || current.ID == 0 || current.Name == "" || current.Admin == nil {
		return false, errors.New("Gotify returned incomplete account data; run self-host setup gotify")
	}
	return current.ID == id && current.Name == username && !*current.Admin, nil
}

func VerifyHomarr(ctx context.Context, h *helpers.H) error {
	ok, err := homarrLoginWorks(ctx, h)
	if err != nil {
		return err
	}
	if !ok {
		return errors.New("Gotify Homarr login must belong to its recorded non-admin account; run self-host setup gotify")
	}
	response, err := h.HTTP(ctx, helpers.Request{
		Path: "/message?limit=100", NoRedirect: true,
		User: h.Secret(h.Key("homarr_username")), Password: h.Secret(h.Key("homarr_password")),
	})
	if err != nil {
		return err
	}
	if response.Status != http.StatusOK {
		return fmt.Errorf("Gotify notifications returned HTTP %d; run self-host setup gotify", response.Status)
	}
	var page struct {
		Paging *struct {
			Size  *int `json:"size"`
			Limit *int `json:"limit"`
		} `json:"paging"`
		Messages []struct {
			ID      uint64    `json:"id"`
			AppID   uint64    `json:"appid"`
			Date    time.Time `json:"date"`
			Title   *string   `json:"title"`
			Message *string   `json:"message"`
		} `json:"messages"`
	}
	if response.Decode(&page) != nil || page.Messages == nil || page.Paging == nil || page.Paging.Size == nil || page.Paging.Limit == nil || *page.Paging.Size != len(page.Messages) || *page.Paging.Limit != 100 || len(page.Messages) > 100 {
		return errors.New("Gotify returned incomplete notification data; run self-host setup gotify")
	}
	for _, message := range page.Messages {
		if message.ID == 0 || message.AppID == 0 || message.Date.IsZero() || message.Title == nil || message.Message == nil {
			return errors.New("Gotify returned an incomplete notification; run self-host setup gotify")
		}
	}
	return nil
}

func createHomarrAccount(ctx context.Context, h *helpers.H) error {
	ok, err := homarrLoginWorks(ctx, h)
	if err != nil {
		return err
	}
	if ok {
		return VerifyHomarr(ctx, h)
	}
	response, err := h.HTTP(ctx, helpers.Request{Path: "/user", NoRedirect: true, User: h.AdminUser(), Password: h.AdminPassword()})
	if err != nil {
		return err
	}
	if response.Status != http.StatusOK {
		return fmt.Errorf("Gotify account discovery returned HTTP %d; run self-host setup gotify", response.Status)
	}
	var accounts []account
	if response.Decode(&accounts) != nil || len(accounts) == 0 {
		return errors.New("Gotify did not return its user accounts")
	}
	for _, current := range accounts {
		if current.ID == 0 || current.Name == "" || current.Admin == nil {
			return errors.New("Gotify returned incomplete account data")
		}
		if current.Name == homarrUsername {
			return helpers.ErrManual
		}
	}
	password := h.Secret(h.Key("homarr_password"))
	if password == "" {
		password = rand.Text()
		if err := h.SetSecret(h.Key("homarr_password"), password); err != nil {
			return err
		}
	}
	if err := h.SetSecret(h.Key("homarr_username"), homarrUsername); err != nil {
		return err
	}
	response, err = h.HTTP(ctx, helpers.Request{
		Method: http.MethodPost, Path: "/user", NoRedirect: true, User: h.AdminUser(), Password: h.AdminPassword(),
		JSON: map[string]any{"name": homarrUsername, "pass": password, "admin": false},
	})
	if err != nil {
		return err
	}
	if response.Status != http.StatusOK {
		return fmt.Errorf("Gotify account creation returned HTTP %d; inspect its users before retrying Setup", response.Status)
	}
	var created account
	if response.Decode(&created) != nil || created.ID == 0 || created.Name != homarrUsername || created.Admin == nil || *created.Admin {
		return errors.New("Gotify did not return the new non-admin account; inspect its users before retrying Setup")
	}
	return h.SetSecret(h.Key("homarr_user_id"), strconv.FormatUint(created.ID, 10))
}
