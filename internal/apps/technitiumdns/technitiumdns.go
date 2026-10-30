// Package technitiumdns is the Technitium DNS Server.
// Traps: docs/catalog/traps/technitium-dns.md.
package technitiumdns

import (
	"context"
	"crypto/rand"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/ajnart/self-host/internal/app"
	"github.com/ajnart/self-host/internal/helpers"
)

type App struct{}

func (App) Info() app.Info {
	return app.Info{
		ID: "technitium-dns", Name: "Technitium DNS Server", Category: "DNS",
		Description:   "Run your home network's address book (DNS), blocking ads and unwanted sites",
		Image:         "technitium/dns-server:latest",
		Docs:          "https://github.com/TechnitiumSoftware/DnsServer/blob/master/docker-compose.yml",
		Port:          5380,
		ContainerPort: 5380,
		Service:       "technitium-dns",
	}
}

func (App) Inputs() []app.Input {
	return []app.Input{{Key: "dns-port", Prompt: "Published DNS port", Default: "53", Help: "TCP and UDP host port; LAN DNS clients normally require port 53", HostPortProtocols: []string{"tcp", "udp"}, Validate: func(value string) error {
		port, err := strconv.Atoi(value)
		if err != nil || port < 1 || port > 65535 || strings.Trim(value, "0123456789") != "" {
			return errors.New("must be a decimal port from 1 to 65535")
		}
		return nil
	}}}
}

// Files writes the Admin password for DNS_SERVER_ADMIN_PASSWORD_FILE.
func (App) Files(rc app.RenderContext, secret func(string) string) []app.File {
	return []app.File{{Path: "admin-password", Content: secret("ADMIN_PASSWORD"), Mode: 0o600}}
}

func (App) Compose(rc app.RenderContext) string {
	port := strconv.Itoa(rc.Port)
	dnsPort := rc.Inputs["dns-port"]
	if dnsPort == "" {
		dnsPort = "53"
	}
	return `services:
  technitium-dns:
    image: technitium/dns-server:latest
    restart: unless-stopped
    environment:
      DNS_SERVER_DOMAIN: dns-server
      DNS_SERVER_ADMIN_PASSWORD_FILE: /run/secrets/admin-password
    volumes:
      - ./config:/etc/dns
      - ./logs:/var/log/technitium/dns
      - ./admin-password:/run/secrets/admin-password:ro
    ports:
      - ${BIND_IP}:` + dnsPort + `:53/udp
      - ${BIND_IP}:` + dnsPort + `:53/tcp
      - ${BIND_IP}:` + port + `:5380
`
}

func adminWorks(ctx context.Context, h *helpers.H) (bool, error) {
	token, err := adminSession(ctx, h)
	if err != nil {
		return false, err
	}
	logout(ctx, h, token)
	return true, nil
}

const (
	supportedVersion = "15.5.1"
	homarrUser       = "self-host-homarr"
	homarrTokenName  = "self-host Homarr statistics"
)

type permission struct {
	View   *bool `json:"canView"`
	Modify *bool `json:"canModify"`
	Delete *bool `json:"canDelete"`
}

type session struct {
	Username  string `json:"username"`
	Token     string `json:"token"`
	TokenName string `json:"tokenName"`
	Info      struct {
		Version     string                `json:"version"`
		Permissions map[string]permission `json:"permissions"`
	} `json:"info"`
}

func request(ctx context.Context, h *helpers.H, path, token string, form url.Values, result any) error {
	req := helpers.Request{Path: path, Form: form, NoRedirect: true}
	if form != nil {
		req.Method = http.MethodPost
	}
	if token != "" {
		h.Log.Secret(token)
		req.Header = map[string]string{"Authorization": "Bearer " + token}
	}
	resp, err := h.HTTP(ctx, req)
	if err != nil {
		return errors.New("Technitium API could not be reached; check its logs and retry self-host setup technitium-dns")
	}
	if resp.Status != http.StatusOK {
		return fmt.Errorf("Technitium %s returned HTTP %d", path, resp.Status)
	}
	var body struct {
		Status string `json:"status"`
	}
	if resp.Decode(&body) != nil {
		return errors.New("Technitium returned a malformed API response")
	}
	switch body.Status {
	case "ok":
	case "2fa-required":
		h.Info("Technitium requires two-factor authentication. Restore a permitted Admin login through the Project boundary, then retry self-host setup technitium-dns; Setup will not disable two-factor authentication.")
		return helpers.ErrManual
	case "invalid-token":
		return errors.New("Technitium rejected the saved token; restore its Project secret and retry self-host setup technitium-dns")
	default:
		return errors.New("Technitium rejected the API request; check the account and its permissions, then retry self-host setup technitium-dns")
	}
	if result != nil && resp.Decode(result) != nil {
		return errors.New("Technitium returned incomplete API data")
	}
	return nil
}

func logout(ctx context.Context, h *helpers.H, token string) {
	_, _ = h.HTTP(ctx, helpers.Request{Method: http.MethodPost, Path: "/api/user/logout", NoRedirect: true,
		Header: map[string]string{"Authorization": "Bearer " + token}, Form: url.Values{}})
}

func adminUsername(h *helpers.H) string {
	user := h.Secret(h.Key("admin_user"))
	if user == "" {
		return "admin"
	}
	return user
}

func adminSession(ctx context.Context, h *helpers.H) (string, error) {
	user := adminUsername(h)
	var login session
	err := request(ctx, h, "/api/user/login", "", url.Values{
		"user": {user}, "pass": {h.AdminPassword()}, "includeInfo": {"true"},
	}, &login)
	if err != nil {
		return "", err
	}
	h.Log.Secret(login.Token)
	if login.Username != user || login.Token == "" {
		logout(ctx, h, login.Token)
		return "", errors.New("Technitium did not authenticate the Project administrator")
	}
	if !helpers.VersionCompatible(login.Info.Version, supportedVersion) {
		logout(ctx, h, login.Token)
		return "", fmt.Errorf("Technitium version is unsupported; this Setup supports %s or newer in the same major version; back up the App before changing versions", supportedVersion)
	}
	admin := login.Info.Permissions["Administration"]
	if admin.View == nil || admin.Modify == nil || !*admin.View || !*admin.Modify {
		logout(ctx, h, login.Token)
		return "", errors.New("the Technitium Admin login requires Administration View and Modify; Setup will not elevate an existing account")
	}
	return login.Token, nil
}

func homarrUserDetails(ctx context.Context, h *helpers.H, token string) error {
	var body struct {
		Response struct {
			Username string   `json:"username"`
			Type     string   `json:"type"`
			Disabled *bool    `json:"disabled"`
			Groups   []string `json:"memberOfGroups"`
		} `json:"response"`
	}
	if err := request(ctx, h, "/api/admin/users/get", token, url.Values{"user": {homarrUser}}, &body); err != nil {
		return err
	}
	user := body.Response
	if user.Username != homarrUser || user.Type != "Local" || user.Disabled == nil || *user.Disabled || user.Groups == nil || len(user.Groups) != 0 {
		return errors.New("the owned Technitium Homarr account must be enabled, local and have no additional groups; Setup will not change its privileges")
	}
	return nil
}

func readOnlySession(current session) error {
	if !helpers.VersionCompatible(current.Info.Version, supportedVersion) {
		return errors.New("Technitium Homarr token returned an unsupported version; back up the App before changing versions")
	}
	sections := []string{"Dashboard", "Zones", "Cache", "Allowed", "Blocked", "Apps", "DnsClient", "Settings", "DhcpServer", "Administration", "Logs"}
	if len(current.Info.Permissions) != len(sections) {
		return errors.New("Technitium did not return complete Homarr token permissions")
	}
	for _, section := range sections {
		p := current.Info.Permissions[section]
		if p.View == nil || p.Modify == nil || p.Delete == nil {
			return errors.New("Technitium did not return complete Homarr token permissions")
		}
		if *p.Modify || *p.Delete || (section == "Settings" || section == "Administration") && *p.View {
			return errors.New("Technitium Homarr token has excessive permissions; restore the read-only account policy before retrying Setup")
		}
		if section == "Dashboard" && !*p.View {
			return errors.New("Technitium Homarr statistics requires Dashboard View; Setup will not change account permissions")
		}
	}
	return nil
}

func VerifyHomarr(ctx context.Context, h *helpers.H) error {
	token := h.Secret(h.Key("homarr_api_key"))
	if token == "" || h.Secret(h.Key("homarr_user")) != homarrUser {
		return errors.New("the owned Technitium Homarr credential is missing; run self-host setup technitium-dns")
	}
	var current session
	if err := request(ctx, h, "/api/user/session/get", token, nil, &current); err != nil {
		return err
	}
	if current.Username != homarrUser || current.TokenName != homarrTokenName || current.Token != token {
		return errors.New("Technitium Homarr credential does not belong to the owned API-token account")
	}
	if err := readOnlySession(current); err != nil {
		return err
	}
	var body struct {
		Response struct {
			Stats map[string]*int64 `json:"stats"`
		} `json:"response"`
	}
	if err := request(ctx, h, "/api/dashboard/stats/get?type=LastHour", token, nil, &body); err != nil {
		return err
	}
	for _, key := range []string{"totalQueries", "totalBlocked", "blockedZones", "blockListZones"} {
		value := body.Response.Stats[key]
		if value == nil || *value < 0 {
			return errors.New("Technitium returned incomplete DNS statistics; explicit zero counts are required for an empty dataset")
		}
	}
	if *body.Response.Stats["totalBlocked"] > *body.Response.Stats["totalQueries"] {
		return errors.New("Technitium returned inconsistent DNS statistics")
	}
	return nil
}

func homarrKeyWorks(ctx context.Context, h *helpers.H) (bool, error) {
	if h.Secret(h.Key("homarr_api_key")) == "" {
		return false, nil
	}
	if err := VerifyHomarr(ctx, h); err != nil {
		return false, err
	}
	token, err := adminSession(ctx, h)
	if err != nil {
		return false, err
	}
	defer logout(ctx, h, token)
	if err := homarrUserDetails(ctx, h, token); err != nil {
		return false, err
	}
	return true, nil
}

func createHomarrKey(ctx context.Context, h *helpers.H) error {
	if h.Secret(h.Key("homarr_api_key")) != "" {
		_, err := homarrKeyWorks(ctx, h)
		return err
	}
	token, err := adminSession(ctx, h)
	if err != nil {
		return err
	}
	defer logout(ctx, h, token)
	var listed struct {
		Response struct {
			Users []struct {
				Username string `json:"username"`
			} `json:"users"`
		} `json:"response"`
	}
	if err := request(ctx, h, "/api/admin/users/list", token, nil, &listed); err != nil {
		return err
	}
	if listed.Response.Users == nil || len(listed.Response.Users) == 0 {
		return errors.New("Technitium did not return its account list; no account was created")
	}
	found := false
	for _, user := range listed.Response.Users {
		if user.Username == "" {
			return errors.New("Technitium returned an incomplete account list; no account was created")
		}
		if user.Username == homarrUser {
			found = true
		}
	}
	owned := h.Secret(h.Key("homarr_user")) == homarrUser
	if found && !owned || !found && h.Secret(h.Key("homarr_user")) != "" {
		h.Info("The Technitium Homarr account conflicts with its Project ownership record. Restore the owned account and Project secrets or choose recovery in the console, then retry self-host setup technitium-dns; matching accounts are never adopted or reset.")
		return helpers.ErrManual
	}
	if !found {
		password := h.Secret(h.Key("homarr_password"))
		if password == "" {
			password = rand.Text()
			if err := h.SetSecret(h.Key("homarr_password"), password); err != nil {
				return err
			}
		}
		var created struct {
			Response struct {
				Username string `json:"username"`
			} `json:"response"`
		}
		if err := request(ctx, h, "/api/admin/users/create", token, url.Values{
			"user": {homarrUser}, "pass": {password}, "displayName": {homarrTokenName},
		}, &created); err != nil {
			return err
		}
		if created.Response.Username != homarrUser {
			return errors.New("Technitium did not confirm the created Homarr account; inspect accounts before retrying")
		}
		if err := h.Secrets.Set(h.Key("homarr_user"), homarrUser); err != nil {
			return err
		}
	}
	if err := homarrUserDetails(ctx, h, token); err != nil {
		return err
	}
	password := h.Secret(h.Key("homarr_password"))
	if password == "" {
		h.Info("Restore the owned Technitium Homarr account password through the Project secret boundary before retrying self-host setup technitium-dns; Setup will not reset the account.")
		return helpers.ErrManual
	}
	var login session
	if err := request(ctx, h, "/api/user/login", "", url.Values{
		"user": {homarrUser}, "pass": {password}, "includeInfo": {"true"},
	}, &login); err != nil {
		return err
	}
	h.Log.Secret(login.Token)
	if login.Token != "" {
		defer logout(ctx, h, login.Token)
	}
	if login.Username != homarrUser || login.Token == "" {
		return errors.New("Technitium did not authenticate the owned Homarr account")
	}
	if err := readOnlySession(login); err != nil {
		return err
	}
	var sessions struct {
		Response struct {
			Sessions []struct {
				Username string `json:"username"`
				Name     string `json:"tokenName"`
			} `json:"sessions"`
		} `json:"response"`
	}
	if err := request(ctx, h, "/api/admin/sessions/list", token, nil, &sessions); err != nil {
		return err
	}
	if sessions.Response.Sessions == nil {
		return errors.New("Technitium did not return its token list; no token was created")
	}
	for _, current := range sessions.Response.Sessions {
		if current.Username == homarrUser && current.Name == homarrTokenName {
			h.Info("The Technitium Homarr token exists but its Project secret is missing. Restore the secret through the Project boundary, or delete only the self-host Homarr statistics token for the owned account in the console, then retry self-host setup technitium-dns.")
			return helpers.ErrManual
		}
	}
	var created struct {
		Response session `json:"response"`
	}
	if err := request(ctx, h, "/api/admin/sessions/createToken", token, url.Values{
		"user": {homarrUser}, "tokenName": {homarrTokenName},
	}, &created); err != nil {
		return err
	}
	h.Log.Secret(created.Response.Token)
	if created.Response.Username != homarrUser || created.Response.TokenName != homarrTokenName || created.Response.Token == "" {
		return errors.New("Technitium did not confirm the created Homarr token; inspect tokens before retrying")
	}
	return h.SetSecret(h.Key("homarr_api_key"), created.Response.Token)
}

func ready(ctx context.Context, h *helpers.H, path string) error {
	probe := func(ctx context.Context) (bool, error) {
		resp, err := h.HTTP(ctx, helpers.Request{Path: path})
		if err != nil {
			return false, err
		}
		return resp.Status < 500, nil
	}
	return h.Step(ctx, "ready", "wait for the web server on "+path, helpers.StepSpec{
		Check: probe,
		Do:    func(ctx context.Context) error { return h.Poll(ctx, 2*time.Minute, probe) },
		Hint:  "Check the App's logs: self-host logs " + h.App,
	})
}

func (App) Setup(ctx context.Context, h *helpers.H) error {
	if err := ready(ctx, h, "/"); err != nil {
		return err
	}
	if err := h.Step(ctx, "admin-login", "authenticate the administrator "+adminUsername(h), helpers.StepSpec{
		Check:      func(ctx context.Context) (bool, error) { return adminWorks(ctx, h) },
		Hint:       "A fresh App creates the built-in admin with the shared Admin password on self-host start technitium-dns. Existing accounts are never reset; restore the Admin login and any App-local username alias through the Project boundary and retry self-host setup technitium-dns.",
		Credential: "admin",
	}); err != nil {
		return err
	}
	if adminUsername(h) != h.AdminUser() && h.Secret(h.Key("admin_user")) == "" {
		if err := h.Secrets.Set(h.Key("admin_user"), adminUsername(h)); err != nil {
			return err
		}
	}
	return h.Step(ctx, "homarr-token", "prepare read-only Technitium DNS statistics", helpers.StepSpec{
		Check:      func(ctx context.Context) (bool, error) { return homarrKeyWorks(ctx, h) },
		Do:         func(ctx context.Context) error { return createHomarrKey(ctx, h) },
		Hint:       "Run self-host setup technitium-dns. Restore missing owned account/token secrets through the Project boundary; existing matching accounts are never adopted, passwords reset or permissions changed. DNS controls are not enabled.",
		Credential: "admin",
	})
}

func (App) Check(ctx context.Context, h *helpers.H) error {
	ok, err := adminWorks(ctx, h)
	if err != nil {
		return err
	}
	if !ok {
		return errors.New("the Admin login cannot sign in to the Technitium DNS console")
	}
	return VerifyHomarr(ctx, h)
}

func (App) Links() []app.Link { return nil }

func (App) StandaloneGuide() string {
	return "Sign in as admin with the ADMIN_PASSWORD value. If systemd-resolved already holds port 53 on the host, the container cannot bind it: turn off its DNSStubListener."
}
