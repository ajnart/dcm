package pihole

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"time"

	"github.com/ajnart/self-host/internal/helpers"
)

func api(ctx context.Context, h *helpers.H, req helpers.Request, value any) error {
	req.NoRedirect = true
	resp, err := h.HTTP(ctx, req)
	if err != nil {
		return fmt.Errorf("Pi-hole %s is unavailable; retry self-host setup pihole", req.Path)
	}
	if resp.Status != http.StatusOK {
		return fmt.Errorf("Pi-hole %s returned HTTP %d; retry self-host setup pihole", req.Path, resp.Status)
	}
	var envelope struct {
		Error json.RawMessage `json:"error"`
	}
	if resp.Decode(&envelope) != nil || len(envelope.Error) > 0 && string(envelope.Error) != "null" {
		return fmt.Errorf("Pi-hole %s returned an invalid response or API error", req.Path)
	}
	if resp.Decode(value) != nil {
		return fmt.Errorf("Pi-hole %s returned an invalid response", req.Path)
	}
	return nil
}

func v6Ready(ctx context.Context, h *helpers.H) error {
	var login struct {
		DNS *bool `json:"dns"`
	}
	if err := api(ctx, h, helpers.Request{Path: "/api/info/login"}, &login); err != nil {
		return fmt.Errorf("this Link requires the Pi-hole v6 API from the Catalog image; no v5 token or unauthenticated fallback is supported: %w", err)
	}
	if login.DNS == nil || !*login.DNS {
		return errors.New("Pi-hole v6 did not report an operational DNS server; inspect self-host logs pihole, then retry Setup")
	}
	return nil
}

func adminSessionWorks(ctx context.Context, h *helpers.H) (bool, error) {
	resp, err := h.HTTP(ctx, helpers.Request{Path: "/api/auth", NoRedirect: true})
	if err == nil {
		var auth struct {
			Session struct {
				TOTP bool `json:"totp"`
			} `json:"session"`
		}
		if resp.Decode(&auth) == nil && auth.Session.TOTP {
			h.Info("Pi-hole's Admin login requires two-factor verification. Setup cannot supply that person-owned token or generate an application password through it; leave 2FA enabled and resolve the account prerequisite before retrying self-host setup pihole.")
			return false, helpers.ErrManual
		}
	}
	return sessionWorks(ctx, h)
}

func loginSession(ctx context.Context, h *helpers.H, password string) (string, error) {
	if password == "" {
		return "", errors.New("Pi-hole password is missing; retry self-host setup pihole")
	}
	h.Log.Secret(password)
	var login struct {
		Session struct {
			Valid bool   `json:"valid"`
			SID   string `json:"sid"`
		} `json:"session"`
	}
	if err := api(ctx, h, helpers.Request{Method: http.MethodPost, Path: "/api/auth", JSON: map[string]string{"password": password}}, &login); err != nil {
		return "", err
	}
	h.Log.Secret(login.Session.SID)
	if !login.Session.Valid || login.Session.SID == "" {
		return "", errors.New("Pi-hole did not return an authenticated v6 session; check its credential, 2FA and available session slots, then retry Setup")
	}
	return login.Session.SID, nil
}

func logoutSession(ctx context.Context, h *helpers.H, sid string) {
	ctx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 5*time.Second)
	defer cancel()
	h.HTTP(ctx, helpers.Request{Method: http.MethodDelete, Path: "/api/auth", Header: map[string]string{"X-FTL-SID": sid}, NoRedirect: true})
}

func applicationSession(ctx context.Context, h *helpers.H, header map[string]string) error {
	var body struct {
		Sessions []struct {
			Current *bool `json:"current_session"`
			Valid   *bool `json:"valid"`
			App     *bool `json:"app"`
			CLI     *bool `json:"cli"`
		} `json:"sessions"`
	}
	if err := api(ctx, h, helpers.Request{Path: "/api/auth/sessions", Header: header}, &body); err != nil {
		return err
	}
	current := 0
	for _, session := range body.Sessions {
		if session.Current == nil || !*session.Current {
			continue
		}
		current++
		if session.Valid == nil || !*session.Valid || session.App == nil || !*session.App || session.CLI == nil || *session.CLI {
			return errors.New("Pi-hole Homarr requires an application-password session, not an Admin password, CLI password or v5 API key")
		}
	}
	if current != 1 {
		return errors.New("Pi-hole did not identify the authenticated application-password session")
	}
	return nil
}

type applicationConfig struct {
	Config struct {
		Webserver struct {
			API struct {
				Hash *string `json:"app_pwhash"`
				Sudo *bool   `json:"app_sudo"`
			} `json:"api"`
		} `json:"webserver"`
	} `json:"config"`
}

func applicationSudoDisabled(ctx context.Context, h *helpers.H, header map[string]string) error {
	var config applicationConfig
	if err := api(ctx, h, helpers.Request{Path: "/api/config/webserver/api/app_sudo", Header: header}, &config); err != nil {
		return err
	}
	if config.Config.Webserver.API.Sudo == nil {
		return errors.New("Pi-hole did not return its application-password permissions")
	}
	if *config.Config.Webserver.API.Sudo {
		h.Info("Pi-hole application-password configuration changes are enabled. Review app_sudo in Pi-hole's settings and explicitly disable it before retrying self-host setup pihole; Setup will not change your permissions.")
		return helpers.ErrManual
	}
	return nil
}

func applicationHash(ctx context.Context, h *helpers.H, header map[string]string) (string, error) {
	var config applicationConfig
	if err := api(ctx, h, helpers.Request{Path: "/api/config/webserver/api/app_pwhash", Header: header}, &config); err != nil {
		return "", err
	}
	if config.Config.Webserver.API.Hash == nil {
		return "", errors.New("Pi-hole did not return its application-password slot; no credential was changed")
	}
	h.Log.Secret(*config.Config.Webserver.API.Hash)
	return *config.Config.Webserver.API.Hash, nil
}

func VerifyHomarr(ctx context.Context, h *helpers.H) error {
	password := h.Secret(h.Key("homarr_app_password"))
	if password == "" || h.Secret(h.Key("homarr_app_password_hash")) == "" {
		return errors.New("Pi-hole Homarr application password or ownership is missing; run self-host setup pihole")
	}
	if password == h.AdminPassword() {
		return errors.New("Pi-hole Homarr must use its dedicated application password, not the Admin password")
	}
	if err := v6Ready(ctx, h); err != nil {
		return err
	}
	sid, err := loginSession(ctx, h, password)
	if err != nil {
		return err
	}
	defer logoutSession(ctx, h, sid)
	header := map[string]string{"X-FTL-SID": sid}
	if err := applicationSession(ctx, h, header); err != nil {
		return err
	}
	if err := applicationSudoDisabled(ctx, h, header); err != nil {
		return err
	}
	hash, err := applicationHash(ctx, h, header)
	if err != nil {
		return err
	}
	if hash == "" || hash != h.Secret(h.Key("homarr_app_password_hash")) {
		return errors.New("Pi-hole's application password no longer matches this Project's owned credential; restore it through the Project secret boundary, then retry Setup")
	}
	var statistics struct {
		Queries struct {
			Total   *uint64  `json:"total"`
			Blocked *uint64  `json:"blocked"`
			Percent *float64 `json:"percent_blocked"`
		} `json:"queries"`
		Gravity struct {
			Domains *uint64 `json:"domains_being_blocked"`
		} `json:"gravity"`
	}
	if err := api(ctx, h, helpers.Request{Path: "/api/stats/summary", Header: header}, &statistics); err != nil {
		return err
	}
	if statistics.Queries.Total == nil || statistics.Queries.Blocked == nil || statistics.Queries.Percent == nil || statistics.Gravity.Domains == nil || *statistics.Queries.Blocked > *statistics.Queries.Total || *statistics.Queries.Percent < 0 || *statistics.Queries.Percent > 100 {
		return errors.New("Pi-hole returned incomplete DNS statistics; explicit zero counts are valid, missing fields are not")
	}
	var blocking struct {
		Blocking string `json:"blocking"`
	}
	if err := api(ctx, h, helpers.Request{Path: "/api/dns/blocking", Header: header}, &blocking); err != nil {
		return err
	}
	if blocking.Blocking != "enabled" && blocking.Blocking != "disabled" {
		return errors.New("Pi-hole did not return an operational DNS blocking state; Setup will not change blocking rules")
	}
	return nil
}

func prepareHomarrPassword(ctx context.Context, h *helpers.H) error {
	password := h.Secret(h.Key("homarr_app_password"))
	hash := h.Secret(h.Key("homarr_app_password_hash"))
	if password != "" && hash != "" {
		return VerifyHomarr(ctx, h)
	}
	if password != "" || hash != "" {
		h.Info("Pi-hole's owned Homarr application-password record is incomplete. Restore its saved credential and hash through the Project secret boundary, then retry self-host setup pihole. Setup will not adopt or rotate an existing password.")
		return helpers.ErrManual
	}
	if err := v6Ready(ctx, h); err != nil {
		return err
	}
	sid, err := loginSession(ctx, h, h.AdminPassword())
	if err != nil {
		return err
	}
	defer logoutSession(ctx, h, sid)
	header := map[string]string{"X-FTL-SID": sid}
	if err := applicationSudoDisabled(ctx, h, header); err != nil {
		return err
	}
	existing, err := applicationHash(ctx, h, header)
	if err != nil {
		return err
	}
	if existing != "" {
		h.Info("Pi-hole already has an application password and supports only one. Setup will not adopt or replace it. Restore this Project's owned credential through the Project secret boundary, or explicitly resolve ownership and clear only an unused application-password slot in Pi-hole, then retry self-host setup pihole.")
		return helpers.ErrManual
	}
	var generated struct {
		App struct {
			Password string `json:"password"`
			Hash     string `json:"hash"`
		} `json:"app"`
	}
	if err := api(ctx, h, helpers.Request{Path: "/api/auth/app", Header: header}, &generated); err != nil {
		return err
	}
	h.Log.Secret(generated.App.Password)
	h.Log.Secret(generated.App.Hash)
	if generated.App.Password == "" || generated.App.Hash == "" || generated.App.Password == h.AdminPassword() {
		return errors.New("Pi-hole did not return a dedicated application password and hash; no credential was changed")
	}
	if err := h.SetSecret(h.Key("homarr_app_password_hash"), generated.App.Hash); err != nil {
		return err
	}
	if err := h.SetSecret(h.Key("homarr_app_password"), generated.App.Password); err != nil {
		return err
	}
	existing, err = applicationHash(ctx, h, header)
	if err != nil {
		return err
	}
	if existing != "" {
		return errors.New("Pi-hole's application-password slot changed during Setup; no existing credential was replaced. Review ownership before retrying")
	}
	var applied applicationConfig
	if err := api(ctx, h, helpers.Request{Method: http.MethodPatch, Path: "/api/config", Header: header,
		JSON: map[string]any{"config": map[string]any{"webserver": map[string]any{"api": map[string]string{"app_pwhash": generated.App.Hash}}}},
	}, &applied); err != nil {
		return err
	}
	return nil
}
