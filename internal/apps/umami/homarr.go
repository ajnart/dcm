package umami

import (
	"context"
	"crypto/rand"
	"errors"
	"fmt"
	"net/url"
	"strconv"
	"time"

	"github.com/ajnart/self-host/internal/helpers"
)

const (
	homarrUsername = "self-host-homarr"
	homarrRole     = "view-only"
	homarrSiteName = "self-host Homarr fixture"
	homarrDomain   = "self-host.invalid"
)

type homarrUser struct {
	ID       string `json:"id"`
	Username string `json:"username"`
	Role     string `json:"role"`
}

type homarrWebsite struct {
	ID              string `json:"id"`
	Name            string `json:"name"`
	Domain          string `json:"domain"`
	UserID          string `json:"userId"`
	TeamID          string `json:"teamId"`
	CreatedBy       string `json:"createdBy"`
	ShareID         string `json:"shareId"`
	RecorderEnabled bool   `json:"recorderEnabled"`
}

func setupHomarr(ctx context.Context, h *helpers.H) error {
	return h.Step(ctx, "homarr-data", "prepare a separate Homarr account and empty fixture website", helpers.StepSpec{
		Check: func(ctx context.Context) (bool, error) {
			for _, key := range []string{"homarr_user_id", "homarr_username", "homarr_password", "homarr_website_id", "homarr_website_created_by"} {
				if h.Secret(h.Key(key)) == "" {
					return false, nil
				}
			}
			err := VerifyHomarr(ctx, h)
			return err == nil, err
		},
		Do: func(ctx context.Context) error {
			admin, ok, err := signInAs(ctx, h, h.AdminPassword())
			if err != nil {
				return err
			}
			if !ok {
				return errors.New("Umami administrator did not authenticate; run self-host setup umami")
			}
			if err := ensureHomarrAccount(ctx, h, admin); err != nil {
				return err
			}
			return ensureHomarrWebsite(ctx, h, admin)
		},
		Hint: "Open " + h.URL + " to review only the recorded self-host Homarr account and fixture website; " +
			"restore missing credentials through the Project secret boundary, then run self-host setup umami and self-host setup homarr. No tracking script or visits are created.",
		Credential: "admin",
	})
}

func homarrManual(h *helpers.H, message string) error {
	h.Info(message + "; review the recorded Homarr resources in " + h.URL + ", then retry self-host setup umami. Matching manually created resources are not adopted or changed")
	return helpers.ErrManual
}

func reserveHomarrID(h *helpers.H, name string) (string, error) {
	if id := h.Secret(h.Key(name)); id != "" {
		return id, nil
	}
	var bytes [16]byte
	if _, err := rand.Read(bytes[:]); err != nil {
		return "", err
	}
	bytes[6] = bytes[6]&0x0f | 0x40
	bytes[8] = bytes[8]&0x3f | 0x80
	id := fmt.Sprintf("%x-%x-%x-%x-%x", bytes[:4], bytes[4:6], bytes[6:8], bytes[8:10], bytes[10:])
	return id, h.SetSecret(h.Key(name), id)
}

func homarrRequest(ctx context.Context, h *helpers.H, token, method, path string, body any) (helpers.Response, error) {
	response, err := h.HTTP(ctx, helpers.Request{
		Method: method, Path: path, JSON: body, NoRedirect: true,
		Header: map[string]string{"Authorization": "Bearer " + token},
	})
	if err != nil {
		return response, err
	}
	if response.Status != 200 {
		return response, fmt.Errorf("Umami Homarr API returned HTTP %d; verify its account and retry self-host setup umami", response.Status)
	}
	return response, nil
}

func ensureHomarrAccount(ctx context.Context, h *helpers.H, admin signIn) error {
	id := h.Secret(h.Key("homarr_user_id"))
	existing := id != ""
	password := h.Secret(h.Key("homarr_password"))
	if password == "" {
		if existing || h.Secret(h.Key("homarr_pending_user_id")) != "" {
			return homarrManual(h, "The saved Homarr password is missing; restore it through the Project secret boundary without rotating the account")
		}
		password = rand.Text() + rand.Text()
		if err := h.SetSecret(h.Key("homarr_password"), password); err != nil {
			return err
		}
	}
	if !existing {
		var err error
		id, err = reserveHomarrID(h, "homarr_pending_user_id")
		if err != nil {
			return err
		}
	}
	response, err := homarrRequest(ctx, h, admin.Token, "GET", "/api/users/"+url.PathEscape(id), nil)
	if err != nil {
		return err
	}
	var account *homarrUser
	if response.Decode(&account) != nil {
		return errors.New("Umami returned an invalid Homarr account")
	}
	if account == nil {
		if existing {
			return homarrManual(h, "The recorded Homarr account is missing; restore it or explicitly clear only its owned identifiers to create a new account")
		}
		response, err = homarrRequest(ctx, h, admin.Token, "POST", "/api/users", map[string]string{
			"id": id, "username": homarrUsername, "password": password, "role": homarrRole,
		})
		if response.Status == 400 {
			return homarrManual(h, "Umami did not accept the separate Homarr account; resolve any conflicting username without adopting a manual account")
		}
		if err != nil {
			return err
		}
		if response.Decode(&account) != nil || account == nil {
			return errors.New("Umami did not return the created Homarr account")
		}
	}
	if account.ID != id || account.Username != homarrUsername || account.Role != homarrRole {
		return homarrManual(h, "The recorded Homarr account identity or role has changed")
	}
	login, ok, err := signInAsUser(ctx, h, homarrUsername, password, homarrRole)
	if err != nil {
		return err
	}
	if !ok || login.ID != id || login.Teams == nil || len(login.Teams) != 0 {
		return homarrManual(h, "The recorded Homarr account cannot authenticate in its isolated view-only role; restore its saved password and remove unintended team access")
	}
	if err := h.SetSecret(h.Key("homarr_username"), homarrUsername); err != nil {
		return err
	}
	return h.SetSecret(h.Key("homarr_user_id"), id)
}

func readHomarrWebsite(ctx context.Context, h *helpers.H, token, id string) (*homarrWebsite, error) {
	response, err := homarrRequest(ctx, h, token, "GET", "/api/websites/"+url.PathEscape(id), nil)
	if err != nil {
		return nil, err
	}
	var website *homarrWebsite
	if response.Decode(&website) != nil {
		return nil, errors.New("Umami returned an invalid fixture website")
	}
	return website, nil
}

func fixtureWebsite(website *homarrWebsite, id, creator string) bool {
	return website != nil && website.ID == id && website.CreatedBy == creator && website.Name == homarrSiteName &&
		website.Domain == homarrDomain && website.TeamID == "" && website.ShareID == "" && !website.RecorderEnabled
}

func ensureHomarrWebsite(ctx context.Context, h *helpers.H, admin signIn) error {
	if h.Secret(h.Key("homarr_website_id")) != "" {
		return VerifyHomarr(ctx, h)
	}
	id, err := reserveHomarrID(h, "homarr_pending_website_id")
	if err != nil {
		return err
	}
	website, err := readHomarrWebsite(ctx, h, admin.Token, id)
	if err != nil {
		return err
	}
	if website == nil {
		response, err := homarrRequest(ctx, h, admin.Token, "POST", "/api/websites", map[string]string{
			"id": id, "name": homarrSiteName, "domain": homarrDomain,
		})
		if err != nil {
			return err
		}
		if response.Decode(&website) != nil {
			return errors.New("Umami did not return the created fixture website")
		}
	}
	userID := h.Secret(h.Key("homarr_user_id"))
	if !fixtureWebsite(website, id, admin.ID) || website.UserID != admin.ID && website.UserID != userID {
		return homarrManual(h, "The pending fixture website does not match its recorded identity and ownership")
	}
	if website.UserID == admin.ID {
		if _, err := homarrRequest(ctx, h, admin.Token, "POST", "/api/websites/"+url.PathEscape(id)+"/transfer", map[string]string{"userId": userID}); err != nil {
			return err
		}
	}
	website, err = readHomarrWebsite(ctx, h, admin.Token, id)
	if err != nil {
		return err
	}
	if !fixtureWebsite(website, id, admin.ID) || website.UserID != userID {
		return errors.New("Umami fixture website ownership did not take effect")
	}
	if err := h.SetSecret(h.Key("homarr_website_created_by"), admin.ID); err != nil {
		return err
	}
	return h.SetSecret(h.Key("homarr_website_id"), id)
}

func VerifyHomarr(ctx context.Context, h *helpers.H) error {
	userID := h.Secret(h.Key("homarr_user_id"))
	websiteID := h.Secret(h.Key("homarr_website_id"))
	password := h.Secret(h.Key("homarr_password"))
	creator := h.Secret(h.Key("homarr_website_created_by"))
	if userID == "" || websiteID == "" || password == "" || creator == "" || h.Secret(h.Key("homarr_username")) != homarrUsername {
		h.Info("Run self-host setup umami to prepare its separate Homarr account and empty fixture website, then self-host setup homarr")
		return helpers.ErrManual
	}
	login, ok, err := signInAsUser(ctx, h, homarrUsername, password, homarrRole)
	if err != nil {
		return err
	}
	if !ok || login.ID != userID || login.Teams == nil || len(login.Teams) != 0 {
		return homarrManual(h, "The saved Homarr account did not authenticate with its recorded identity and isolated view-only role")
	}
	website, err := readHomarrWebsite(ctx, h, login.Token, websiteID)
	if err != nil {
		return err
	}
	if !fixtureWebsite(website, websiteID, creator) || website.UserID != userID {
		return homarrManual(h, "The recorded fixture website is missing or its ownership or settings changed")
	}
	now := h.Now().UTC()
	query := url.Values{
		"startAt": {strconv.FormatInt(now.Add(-24*time.Hour).UnixMilli(), 10)},
		"endAt":   {strconv.FormatInt(now.UnixMilli(), 10)},
	}
	path := "/api/websites/" + url.PathEscape(websiteID)
	response, err := homarrRequest(ctx, h, login.Token, "GET", path+"/stats?"+query.Encode(), nil)
	if err != nil {
		return err
	}
	var stats map[string]any
	if response.Decode(&stats) != nil {
		return errors.New("Umami returned invalid fixture statistics")
	}
	for _, metric := range []string{"pageviews", "visitors", "visits", "bounces", "totaltime"} {
		value, ok := stats[metric].(float64)
		if !ok || value < 0 {
			return errors.New("Umami returned incomplete fixture statistics; missing values are not zero")
		}
	}
	query.Set("unit", "hour")
	query.Set("timezone", "UTC")
	response, err = homarrRequest(ctx, h, login.Token, "GET", path+"/pageviews?"+query.Encode(), nil)
	if err != nil {
		return err
	}
	type point struct {
		X string   `json:"x"`
		Y *float64 `json:"y"`
	}
	var series struct {
		Pageviews []point `json:"pageviews"`
		Sessions  []point `json:"sessions"`
	}
	if response.Decode(&series) != nil || series.Pageviews == nil || series.Sessions == nil {
		return errors.New("Umami returned incomplete fixture pageview and visitor series")
	}
	for _, points := range [][]point{series.Pageviews, series.Sessions} {
		for _, value := range points {
			if value.X == "" || value.Y == nil || *value.Y < 0 {
				return errors.New("Umami returned an invalid fixture data point")
			}
		}
	}
	response, err = homarrRequest(ctx, h, login.Token, "GET", path+"/active", nil)
	if err != nil {
		return err
	}
	var active struct {
		Visitors *float64 `json:"visitors"`
	}
	if response.Decode(&active) != nil || active.Visitors == nil || *active.Visitors < 0 {
		return errors.New("Umami did not explicitly return active visitors; missing values are not zero")
	}
	return nil
}

func HomarrWebsiteID(ctx context.Context, h *helpers.H) (string, error) {
	if err := VerifyHomarr(ctx, h); err != nil {
		return "", err
	}
	return h.Secret(h.Key("homarr_website_id")), nil
}
