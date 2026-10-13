// Package nextcloud is Nextcloud: your private files, calendars and
// collaboration, backed by MariaDB and Redis. Its administrator is created
// from the generated admin-password file on the first start.
// Traps: docs/catalog/traps/nextcloud.md.
package nextcloud

import (
	"context"
	"encoding/json"
	"encoding/xml"
	"errors"
	"fmt"
	"net/url"
	"slices"
	"strconv"
	"strings"
	"time"

	"github.com/ajnart/self-host/internal/app"
	"github.com/ajnart/self-host/internal/firstadmin"
	"github.com/ajnart/self-host/internal/helpers"
	"github.com/ajnart/self-host/internal/names"
)

type App struct{}

func (App) Info() app.Info {
	return app.Info{
		ID: "nextcloud", Name: "Nextcloud", Category: "Files",
		Description:   "Keep your files, calendars and contacts in sync across your devices",
		Image:         "nextcloud:35.0.1-apache",
		Docs:          "https://github.com/nextcloud/docker",
		Port:          8080,
		ContainerPort: 80,
		LongTimeouts:  true,
		Service:       "nextcloud",
	}
}

func (App) Inputs() []app.Input {
	return []app.Input{
		{Key: "homarr_app_password", Prompt: "Saved self-host Homarr app password", Private: true,
			Help: "Optional recovery of the known app password together with its matching token ID; use c-l-e-a-r (without hyphens) in both private inputs only after explicitly revoking self-host Homarr. Reinstall replaces Compose; preserve and review existing authentication, mounts and ports and separately approve replacement first."},
		{Key: "homarr_app_password_id", Prompt: "Saved self-host Homarr token ID", Private: true,
			Help: "Optional recovery of the known token ID corresponding to the supplied app password; never infer it from a name or successful login. Empty private inputs do not erase saved values."},
	}
}

// Secrets backs the database. The administrator is the shared Admin login,
// written to a file by Files before the container first starts.
func (App) Secrets() []app.SecretSpec {
	return []app.SecretSpec{
		{Name: "db_password", Length: 48},
		{Name: "db_root_password", Length: 48},
	}
}

func (App) Files(_ app.RenderContext, secret func(string) string) []app.File {
	return []app.File{
		{Path: "secrets/db_password", Content: secret("db_password") + "\n", Mode: 0o600},
		{Path: "secrets/db_root_password", Content: secret("db_root_password") + "\n", Mode: 0o600},
		{Path: "secrets/admin_password", Content: secret("ADMIN_PASSWORD") + "\n", Mode: 0o600},
	}
}

func (App) Compose(rc app.RenderContext) string {
	port := strconv.Itoa(rc.Port)
	return `services:
  nextcloud:
    image: nextcloud:35.0.1-apache
    restart: unless-stopped
    environment:
      MYSQL_HOST: nextcloud-db
      MYSQL_DATABASE: nextcloud
      MYSQL_USER: nextcloud
      NEXTCLOUD_ADMIN_USER: ${ADMIN_USER}
      NEXTCLOUD_TRUSTED_DOMAINS: "127.0.0.1 nextcloud ${LAN_IP}"
      REDIS_HOST: nextcloud-redis
      MYSQL_PASSWORD_FILE: /run/secrets/db_password
      NEXTCLOUD_ADMIN_PASSWORD_FILE: /run/secrets/admin_password
    volumes:
      - ./html:/var/www/html
      - ./secrets/db_password:/run/secrets/db_password:ro
      - ./secrets/admin_password:/run/secrets/admin_password:ro
    ports:
      - ${BIND_IP}:` + port + `:80
    depends_on:
      - nextcloud-db
      - nextcloud-redis
  nextcloud-db:
    image: mariadb:12.3.3
    restart: unless-stopped
    command: ["--transaction-isolation=READ-COMMITTED"]
    environment:
      MARIADB_DATABASE: nextcloud
      MARIADB_USER: nextcloud
      MARIADB_PASSWORD_FILE: /run/secrets/db_password
      MARIADB_ROOT_PASSWORD_FILE: /run/secrets/db_root_password
    volumes:
      - ./db:/var/lib/mysql
      - ./secrets/db_password:/run/secrets/db_password:ro
      - ./secrets/db_root_password:/run/secrets/db_root_password:ro
  nextcloud-redis:
    image: redis:8.10.2-alpine3.23
    restart: unless-stopped
  nextcloud-cron:
    image: nextcloud:35.0.1-apache
    restart: unless-stopped
    entrypoint: ["/cron.sh"]
    environment:
      MYSQL_HOST: nextcloud-db
      MYSQL_DATABASE: nextcloud
      MYSQL_USER: nextcloud
      REDIS_HOST: nextcloud-redis
      MYSQL_PASSWORD_FILE: /run/secrets/db_password
    volumes:
      - ./html:/var/www/html
      - ./secrets/db_password:/run/secrets/db_password:ro
    depends_on:
      - nextcloud
`
}

func adminWorks(ctx context.Context, h *helpers.H) (bool, error) {
	if saved := h.Secret(h.Key("homarr_app_password")); saved != "" {
		if ok, err := adminPasswordWorks(ctx, h, saved); err != nil || ok {
			return ok, err
		}
	}
	return adminPasswordWorks(ctx, h, h.AdminPassword())
}

func adminPasswordWorks(ctx context.Context, h *helpers.H, password string) (bool, error) {
	var account struct {
		ID     string
		Groups []string
	}
	err := readOCS(ctx, h, "/ocs/v2.php/cloud/user?format=json", password, &account)
	if errors.Is(err, errAuthentication) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	return account.ID == h.AdminUser() && slices.Contains(account.Groups, "admin"), nil
}

func (App) Setup(ctx context.Context, h *helpers.H) error {
	if err := h.Step(ctx, "ready", "wait for Nextcloud's first installation", helpers.StepSpec{
		Check: func(ctx context.Context) (bool, error) { return installed(ctx, h) },
		Do: func(ctx context.Context) error {
			return h.Poll(ctx, 5*time.Minute, func(ctx context.Context) (bool, error) { return installed(ctx, h) })
		},
		Hint: "Nextcloud must finish its database installation and leave maintenance mode; read self-host logs nextcloud, then retry self-host setup nextcloud.",
	}); err != nil {
		return err
	}
	if err := (App{}).ConfigureAccess(ctx, h); err != nil {
		return err
	}
	if err := h.Step(ctx, "app-addresses", "allow Nextcloud's Project addresses", helpers.StepSpec{
		Check: func(ctx context.Context) (bool, error) { return projectHostsWork(ctx, h) },
		Do: func(ctx context.Context) error {
			domains, err := trustedHosts(ctx, h)
			if err != nil {
				return err
			}
			for _, host := range projectHosts(h) {
				if !slices.Contains(domains, host) {
					domains = append(domains, host)
				}
			}
			return saveTrustedHosts(ctx, h, domains)
		},
		Hint: "Run self-host setup nextcloud to allow its internal and home addresses without removing existing trusted hosts.",
	}); err != nil {
		return err
	}
	if err := (firstadmin.FirstAdmin{
		StepID: "admin-login",
		Title:  func(_ *helpers.H, user string) string { return "administrator " + user + " signs in" },
		Login: func(ctx context.Context, h *helpers.H, _, _ string) (bool, error) {
			return adminWorks(ctx, h)
		},
		Create: func(ctx context.Context, h *helpers.H, _, _ string) error {
			if ok, err := adminWorks(ctx, h); err != nil || ok {
				return err
			}
			result, err := h.Exec(ctx, map[string]string{"SELF_HOST_NEXTCLOUD_USER": h.AdminUser()},
				"su", "-m", "-s", "/bin/sh", "www-data", "-c", `php occ twofactorauth:state -- "$SELF_HOST_NEXTCLOUD_USER"`)
			if err != nil {
				return errors.New("Nextcloud cannot verify its administrator's two-factor authentication state")
			}
			if strings.Contains(string(result.Stdout), "Two-factor authentication is enabled for user ") {
				return helpers.ErrManual
			}
			return errors.New("Nextcloud rejected the saved administrator login; recover it using self-host credentials, then retry self-host setup nextcloud")
		},
		Hint: func(h *helpers.H, user string) string {
			return "Open " + h.URL + " and sign in as " + user +
				" using self-host credentials. " + HomarrRecoveryHint(h)
		},
	}).Admin(ctx, h); err != nil {
		return err
	}
	return h.Step(ctx, "homarr-password", "prepare Nextcloud's Homarr app password", helpers.StepSpec{
		Check:      func(ctx context.Context) (bool, error) { return homarrPasswordWorks(ctx, h) },
		Do:         func(ctx context.Context) error { return prepareHomarrPassword(ctx, h) },
		Hint:       HomarrRecoveryHint(h),
		Credential: "admin",
	})
}

func (App) ConfigureAccess(ctx context.Context, h *helpers.H) error {
	if h.Settings["EASY_NAMES"] == "on" {
		if err := h.Step(ctx, "trusted-hosts", "allow the App's home addresses", helpers.StepSpec{
			Check: func(ctx context.Context) (bool, error) { return trustedHostsWork(ctx, h) },
			Do: func(ctx context.Context) error {
				domains, err := trustedHosts(ctx, h)
				if err != nil {
					return err
				}
				for _, host := range homeHosts(h) {
					if !slices.Contains(domains, host) {
						domains = append(domains, host)
					}
				}
				return saveTrustedHosts(ctx, h, domains)
			},
			Hint: "Check self-host logs nextcloud, then run self-host setup nextcloud.",
		}); err != nil {
			return err
		}
	}
	return nil
}

func (App) Check(ctx context.Context, h *helpers.H) error {
	if ok, err := installed(ctx, h); err != nil {
		return err
	} else if !ok {
		return errors.New("Nextcloud's database installation is incomplete or in maintenance mode; run self-host setup nextcloud")
	}
	if h.Settings["EASY_NAMES"] == "on" {
		if ok, err := trustedHostsWork(ctx, h); err != nil {
			return err
		} else if !ok {
			return fmt.Errorf("Nextcloud does not trust its home addresses; run self-host setup nextcloud")
		}
	}
	ok, err := adminWorks(ctx, h)
	if err != nil {
		return err
	}
	if !ok {
		return fmt.Errorf("the administrator %s cannot sign in to Nextcloud", h.AdminUser())
	}
	return VerifyHomarr(ctx, h)
}

func homeHosts(h *helpers.H) []string {
	hosts := []string{h.Settings["LAN_IP"]}
	if host, ok := names.Host("nextcloud", h.Settings["LAN_IP"]); ok {
		hosts = append(hosts, host)
	}
	return hosts
}

func trustedHosts(ctx context.Context, h *helpers.H) ([]string, error) {
	if h.Config.Exec == nil {
		return nil, errors.New("Nextcloud needs its Project container to verify trusted hosts; run self-host setup nextcloud")
	}
	result, err := h.Exec(ctx, nil, "su", "-s", "/bin/sh", "www-data", "-c", "php occ config:system:get trusted_domains")
	if err != nil {
		return nil, err
	}
	return strings.Fields(string(result.Stdout)), nil
}

func trustedHostsWork(ctx context.Context, h *helpers.H) (bool, error) {
	domains, err := trustedHosts(ctx, h)
	if err != nil {
		return false, err
	}
	for _, host := range homeHosts(h) {
		if !slices.Contains(domains, host) {
			return false, nil
		}
	}
	return true, nil
}

func (App) Links() []app.Link { return nil }

func installed(ctx context.Context, h *helpers.H) (bool, error) {
	resp, err := h.HTTP(ctx, helpers.Request{Path: "/status.php", NoRedirect: true})
	if err != nil {
		return false, err
	}
	if resp.Status != 200 {
		return false, fmt.Errorf("Nextcloud installation status returned HTTP %d", resp.Status)
	}
	var status struct {
		Installed, Maintenance, NeedsDbUpgrade *bool
		VersionString                          string
	}
	if resp.Decode(&status) != nil || status.Installed == nil || status.Maintenance == nil || status.NeedsDbUpgrade == nil || status.VersionString == "" {
		return false, errors.New("Nextcloud returned incomplete installation status")
	}
	return *status.Installed && !*status.Maintenance && !*status.NeedsDbUpgrade, nil
}

func projectHosts(h *helpers.H) []string {
	hosts := []string{"127.0.0.1", "nextcloud"}
	if host := h.Settings["LAN_IP"]; host != "" {
		hosts = append(hosts, host)
	}
	return hosts
}

func projectHostsWork(ctx context.Context, h *helpers.H) (bool, error) {
	domains, err := trustedHosts(ctx, h)
	if err != nil {
		return false, err
	}
	for _, host := range projectHosts(h) {
		if !slices.Contains(domains, host) {
			return false, nil
		}
	}
	return true, nil
}

func saveTrustedHosts(ctx context.Context, h *helpers.H, domains []string) error {
	data, err := json.Marshal(domains)
	if err != nil {
		return err
	}
	_, err = h.Exec(ctx, map[string]string{"SELF_HOST_TRUSTED_DOMAINS": string(data)},
		"su", "-m", "-s", "/bin/sh", "www-data", "-c", `php occ config:system:set trusted_domains --type json --value "$SELF_HOST_TRUSTED_DOMAINS"`)
	return err
}

const homarrPasswordName = "self-host Homarr"

func HomarrRecoveryHint(h *helpers.H) string {
	return "Open " + h.URL + "/settings/user/security. Restore the known matching self-host Homarr app password and token ID from owner-only files. " +
		"Private-input ingestion requires reinstall, which replaces apps/nextcloud/compose.yml and generated credential files. Preserve and review existing authentication, mounts and ports, and obtain separate approval for replacement first. If existing custom configuration cannot survive replacement, stop: there is no credentials-only ingestion command. " +
		"Only after approval, run: self-host install nextcloud --yes --set-file nextcloud.homarr_app_password=/owned/private/app-password --set-file nextcloud.homarr_app_password_id=/owned/private/token-id. " +
		"To discard obsolete credentials, explicitly revoke only self-host Homarr first, then use that command with both files containing c-l-e-a-r (without hyphens); empty files do not erase saved values. " +
		"If the matching credential or ID is unknown, recovery remains Manual; do not infer an ID from the token name or a working login. If two-factor authentication rejects account-password API login, headless reissuance remains Manual; restore an explicitly matched app password and ID instead. Never disable two-factor authentication. Retry self-host setup nextcloud, then self-host setup homarr. " +
		"The default app password retains administrator and file-write authority; it is not read-only."
}

type authToken struct {
	ID    int             `json:"id"`
	Name  string          `json:"name"`
	Type  *int            `json:"type"`
	Scope map[string]bool `json:"scope"`
}

func homarrToken(ctx context.Context, h *helpers.H) (*authToken, error) {
	if h.Config.Exec == nil {
		return nil, errors.New("Nextcloud needs its Project container to discover app passwords; run self-host setup nextcloud")
	}
	result, err := h.Exec(ctx, map[string]string{"SELF_HOST_NEXTCLOUD_USER": h.AdminUser()},
		"su", "-m", "-s", "/bin/sh", "www-data", "-c", `php occ user:auth-tokens:list --output=json -- "$SELF_HOST_NEXTCLOUD_USER"`)
	if err != nil {
		return nil, errors.New("Nextcloud app-password discovery failed; run self-host setup nextcloud")
	}
	var tokens []authToken
	if json.Unmarshal(result.Stdout, &tokens) != nil || tokens == nil {
		return nil, errors.New("Nextcloud returned incomplete app-password metadata")
	}
	var found *authToken
	for _, token := range tokens {
		if token.Name != homarrPasswordName && strconv.Itoa(token.ID) != h.Secret(h.Key("homarr_app_password_id")) {
			continue
		}
		_, filesystemScope := token.Scope["filesystem"]
		if found != nil || token.ID <= 0 || token.Name != homarrPasswordName || token.Type == nil || *token.Type != 1 || len(token.Scope) != 1 || !filesystemScope {
			h.Info(HomarrRecoveryHint(h))
			return nil, helpers.ErrManual
		}
		found = &token
	}
	return found, nil
}

func homarrPasswordWorks(ctx context.Context, h *helpers.H) (bool, error) {
	if h.Secret(h.Key("homarr_app_password")) == "" {
		return false, nil
	}
	if h.Secret(h.Key("homarr_app_password_id")) == "" {
		return false, nil
	}
	err := VerifyHomarr(ctx, h)
	return err == nil, err
}

func prepareHomarrPassword(ctx context.Context, h *helpers.H) error {
	token, err := homarrToken(ctx, h)
	if err != nil {
		return err
	}
	password := h.Secret(h.Key("homarr_app_password"))
	id := h.Secret(h.Key("homarr_app_password_id"))
	if password == "clear" || id == "clear" {
		if password != "clear" || id != "clear" || token != nil {
			h.Info(HomarrRecoveryHint(h))
			return helpers.ErrManual
		}
		if err := h.SetSecret(h.Key("homarr_app_password"), ""); err != nil {
			return err
		}
		if err := h.SetSecret(h.Key("homarr_app_password_id"), ""); err != nil {
			return err
		}
		password, id = "", ""
	}
	if token != nil {
		if password == "" || id == "" {
			h.Info(HomarrRecoveryHint(h))
			return helpers.ErrManual
		}
		return VerifyHomarr(ctx, h)
	}
	if password != "" || id != "" {
		h.Info(HomarrRecoveryHint(h))
		return helpers.ErrManual
	}
	h.Info("Nextcloud's Homarr app password retains administrator and file-write authority; Nextcloud's headless app-password command does not offer read-only scopes.")
	result, err := h.Exec(ctx, map[string]string{"SELF_HOST_NEXTCLOUD_USER": h.AdminUser(), "NC_PASS": h.AdminPassword()},
		"su", "-m", "-s", "/bin/sh", "www-data", "-c", `php occ user:auth-tokens:add --no-interaction --password-from-env --name 'self-host Homarr' -- "$SELF_HOST_NEXTCLOUD_USER"`)
	if err != nil {
		return errors.New("Nextcloud could not create its Homarr app password; inspect Personal settings > Security before retrying")
	}
	_, password, ok := strings.Cut(string(result.Stdout), "app password:\n")
	password = strings.TrimSpace(password)
	if !ok || len(password) != 72 || strings.ContainsAny(password, " \t\r\n") {
		return errors.New("Nextcloud did not return its app password; inspect Personal settings > Security before retrying")
	}
	if err := h.SetSecret(h.Key("homarr_app_password"), password); err != nil {
		return err
	}
	token, err = homarrToken(ctx, h)
	if err != nil {
		return err
	}
	if token == nil {
		return errors.New("Nextcloud did not return its created app-password metadata")
	}
	return h.SetSecret(h.Key("homarr_app_password_id"), strconv.Itoa(token.ID))
}

var errAuthentication = errors.New("Nextcloud rejected the saved credential; run self-host setup nextcloud")

func readOCS(ctx context.Context, h *helpers.H, path, password string, data any) error {
	resp, err := h.HTTP(ctx, helpers.Request{
		Path: path, NoRedirect: true, User: h.AdminUser(), Password: password,
		Header: map[string]string{"OCS-APIRequest": "true"},
	})
	if err != nil {
		return err
	}
	if resp.Status == 401 || resp.Status == 403 {
		return errAuthentication
	}
	if resp.Status != 200 {
		return fmt.Errorf("Nextcloud API returned HTTP %d; run self-host setup nextcloud", resp.Status)
	}
	var body struct {
		OCS struct {
			Meta struct {
				Status     string
				StatusCode int
			}
			Data json.RawMessage
		}
	}
	if resp.Decode(&body) != nil || body.OCS.Meta.Status != "ok" || body.OCS.Meta.StatusCode != 200 || len(body.OCS.Data) == 0 || string(body.OCS.Data) == "null" {
		return errors.New("Nextcloud returned an OCS error or incomplete API data; run self-host setup nextcloud")
	}
	if json.Unmarshal(body.OCS.Data, data) != nil {
		return errors.New("Nextcloud returned invalid API data; run self-host setup nextcloud")
	}
	return nil
}

func VerifyHomarr(ctx context.Context, h *helpers.H) error {
	if ok, err := installed(ctx, h); err != nil {
		return err
	} else if !ok {
		return errors.New("Nextcloud installation is incomplete; run self-host setup nextcloud")
	}
	if ok, err := projectHostsWork(ctx, h); err != nil {
		return err
	} else if !ok {
		return errors.New("Nextcloud does not trust its Project addresses; run self-host setup nextcloud")
	}
	password := h.Secret(h.Key("homarr_app_password"))
	id := h.Secret(h.Key("homarr_app_password_id"))
	if password == "" || id == "" || password == "clear" || id == "clear" {
		h.Info(HomarrRecoveryHint(h))
		return helpers.ErrManual
	}
	token, err := homarrToken(ctx, h)
	if err != nil {
		return err
	}
	if token == nil || id != strconv.Itoa(token.ID) {
		h.Info(HomarrRecoveryHint(h))
		return helpers.ErrManual
	}
	var account struct {
		ID     string
		Groups []string
	}
	if err := readOCS(ctx, h, "/ocs/v2.php/cloud/user?format=json", password, &account); err != nil {
		return err
	}
	if account.ID != h.AdminUser() || !slices.Contains(account.Groups, "admin") {
		return errors.New("Nextcloud Homarr app password does not belong to the Project administrator")
	}
	var notifications []struct {
		ID                         *int `json:"notification_id"`
		Datetime, Subject, Message *string
	}
	if err := readOCS(ctx, h, "/ocs/v2.php/apps/notifications/api/v2/notifications?format=json", password, &notifications); err != nil {
		return err
	}
	if notifications == nil {
		return errors.New("Nextcloud did not return a notification list")
	}
	for _, notification := range notifications {
		if notification.ID == nil || *notification.ID <= 0 || notification.Datetime == nil || notification.Subject == nil || notification.Message == nil {
			return errors.New("Nextcloud returned incomplete notifications")
		}
		if _, err := time.Parse(time.RFC3339, *notification.Datetime); err != nil {
			return errors.New("Nextcloud returned an invalid notification time")
		}
	}
	resp, err := h.HTTP(ctx, helpers.Request{
		Method: "PROPFIND", Path: "/remote.php/dav/principals/users/" + url.PathEscape(account.ID) + "/", NoRedirect: true,
		User: h.AdminUser(), Password: password,
		Header: map[string]string{"Depth": "0", "Content-Type": "application/xml"},
		Body:   []byte(`<d:propfind xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav"><d:prop><c:calendar-home-set/></d:prop></d:propfind>`),
	})
	if err != nil {
		return err
	}
	if resp.Status != 207 {
		return fmt.Errorf("Nextcloud calendar discovery returned HTTP %d; run self-host setup nextcloud", resp.Status)
	}
	var dav struct {
		XMLName   xml.Name `xml:"DAV: multistatus"`
		Responses []struct {
			Properties []struct {
				Status string `xml:"DAV: status"`
				Prop   struct {
					CalendarHome struct {
						Href string `xml:"DAV: href"`
					} `xml:"urn:ietf:params:xml:ns:caldav calendar-home-set"`
				} `xml:"DAV: prop"`
			} `xml:"DAV: propstat"`
		} `xml:"DAV: response"`
	}
	if xml.Unmarshal(resp.Body, &dav) != nil {
		return errors.New("Nextcloud returned invalid calendar discovery data")
	}
	for _, response := range dav.Responses {
		for _, property := range response.Properties {
			if property.Status == "HTTP/1.1 200 OK" && property.Prop.CalendarHome.Href != "" {
				return nil
			}
		}
	}
	return errors.New("Nextcloud calendar discovery did not return the account's calendar home; run self-host setup nextcloud")
}
