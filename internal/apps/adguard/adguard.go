// Package adguard is AdGuard Home. Traps: docs/catalog/traps/adguard-home.md.
package adguard

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/ajnart/self-host/internal/app"
	"github.com/ajnart/self-host/internal/firstadmin"
	"github.com/ajnart/self-host/internal/helpers"
)

// App is AdGuard Home. Traps: docs/catalog/traps/adguard-home.md.
type App struct{}

func (App) Info() app.Info {
	return app.Info{
		ID: "adguard-home", Name: "AdGuard Home", Category: "DNS",
		Description:   "Block ads and trackers on every device at home, with a simple control page",
		Image:         "adguard/adguardhome:latest",
		Docs:          "https://github.com/AdguardTeam/AdGuardHome/wiki/Docker",
		Port:          3000,
		ContainerPort: 3000,
		Service:       "adguard-home",
	}
}

func (App) Inputs() []app.Input { return nil }
func (App) Links() []app.Link   { return nil }

func (App) StandaloneGuide() string {
	return "After the first start, finish the install wizard in the browser: create the administrator and keep the admin port at 3000. " +
		"This Compose publishes only that port: for DNS also publish 53/tcp and 53/udp, and if systemd-resolved already holds port 53, turn off its DNSStubListener (see the resolved section of AdGuard's Docker wiki)."
}

// Compose publishes only the private admin UI; DNS port 53 needs a separate
// owner-approved cutover.
func (App) Compose(rc app.RenderContext) string {
	port := strconv.Itoa(rc.Port)
	return `services:
  adguard-home:
    image: adguard/adguardhome:latest
    restart: unless-stopped
    volumes:
      - ./work:/opt/adguardhome/work
      - ./conf:/opt/adguardhome/conf
    ports:
      - ${BIND_IP}:` + port + `:3000
`
}

func loginWorks(ctx context.Context, h *helpers.H, user, password string) (bool, error) {
	if user == "" || password == "" {
		return false, errors.New("AdGuard Home requires the saved Admin username and password; restore the Project Admin login, then run self-host setup adguard-home")
	}
	resp, err := h.HTTP(ctx, helpers.Request{Path: "/control/profile", User: user, Password: password, NoRedirect: true})
	if err != nil {
		return false, err
	}
	if resp.Status == http.StatusUnauthorized {
		return false, nil
	}
	location := resp.Header.Get("Location")
	if resp.Status == http.StatusFound && (location == "install.html" || location == "/install.html" || location == "/control/install.html") {
		exists, err := adminExists(ctx, h)
		if err != nil {
			return false, err
		}
		if !exists {
			return false, nil
		}
	}
	if resp.Status != http.StatusOK {
		return false, fmt.Errorf("AdGuard Home Admin profile returned HTTP %d", resp.Status)
	}
	var profile struct{ Name string }
	if resp.Decode(&profile) != nil || profile.Name != user {
		return false, errors.New("AdGuard Home did not return the authenticated Admin profile; read self-host logs adguard-home, then run self-host setup adguard-home")
	}
	return true, nil
}

// adminExists reports whether the fresh first-install form is gone, which
// means an administrator was already configured.
func adminExists(ctx context.Context, h *helpers.H) (bool, error) {
	resp, err := h.HTTP(ctx, helpers.Request{Path: "/control/install/get_addresses", NoRedirect: true})
	if err != nil {
		return false, err
	}
	switch resp.Status {
	case http.StatusOK:
		var install struct{ Version string }
		if resp.Decode(&install) != nil || install.Version == "" {
			return false, errors.New("AdGuard Home did not return its first-run configuration")
		}
		return false, nil
	case http.StatusForbidden, http.StatusNotFound:
		return true, nil
	default:
		return false, fmt.Errorf("AdGuard Home first-run configuration returned HTTP %d", resp.Status)
	}
}

func createAdmin(ctx context.Context, h *helpers.H, user, password string) error {
	resp, err := h.HTTP(ctx, helpers.Request{
		Method: http.MethodPost, Path: "/control/install/configure", NoRedirect: true,
		JSON: map[string]any{
			"dns":      map[string]any{"ip": "0.0.0.0", "port": 53},
			"web":      map[string]any{"ip": "0.0.0.0", "port": 3000},
			"username": user,
			"password": password,
		},
	})
	if err != nil {
		return err
	}
	if resp.Status != http.StatusOK {
		return fmt.Errorf("AdGuard Home rejected first-run configuration (HTTP %d); run self-host setup adguard-home after correcting its account or port conflict", resp.Status)
	}
	return nil
}

func firstAdmin() firstadmin.FirstAdmin {
	return firstadmin.FirstAdmin{
		Ready: firstadmin.Probe{
			Path: "/control/install/get_addresses",
			Want: []int{http.StatusOK, http.StatusForbidden, http.StatusNotFound},
		},
		Exists: adminExists,
		Create: createAdmin,
		Login:  loginWorks,
		Valid: func(user, password string) error {
			if user == "" || strings.ContainsAny(user, ":\r\n\x00") {
				return errors.New("the Admin username is not valid for AdGuard Home")
			}
			if utf8.RuneCountInString(password) < 8 || len(password) > 72 || strings.ContainsAny(password, "\r\n\x00") {
				return errors.New("the Admin password is not valid for AdGuard Home")
			}
			return nil
		},
		Manual: "keep the administration port at 3000; if an administrator already exists, restore the saved Admin login without replacing the DNS settings",
	}
}

func (App) Setup(ctx context.Context, h *helpers.H) error {
	f := firstAdmin()
	if err := h.Ready(ctx, f.Ready.Path, helpers.WantStatus(f.Ready.Want...), helpers.NoRedirect(), helpers.Timeout(2*time.Minute)); err != nil {
		return err
	}
	user, password := h.AdminUser(), h.AdminPassword()
	if err := h.Step(ctx, "admin", "verify the administrator "+user, helpers.StepSpec{
		Check: func(ctx context.Context) (bool, error) { return f.Login(ctx, h, user, password) },
		Do: func(ctx context.Context) error {
			ok, err := f.Login(ctx, h, user, password)
			if err != nil || ok {
				return err
			}
			exists, err := f.Exists(ctx, h)
			if err != nil {
				return err
			}
			if exists {
				return errors.New("the Admin login was rejected by AdGuard Home; restore the saved Admin login without replacing DNS settings, then run self-host setup adguard-home")
			}
			if err := f.Valid(user, password); err != nil {
				return err
			}
			return f.Create(ctx, h, user, password)
		},
		Hint:       "read self-host logs adguard-home for the administrator API failure, then run self-host setup adguard-home",
		Credential: "admin",
	}); err != nil {
		return err
	}
	attempt := func(ctx context.Context) (bool, error) {
		err := checkDNSData(ctx, h)
		return err == nil, err
	}
	return h.Step(ctx, "dns-api", "verify running DNS, query statistics and filtering data", helpers.StepSpec{
		Check: attempt,
		Do: func(ctx context.Context) error {
			return h.Poll(ctx, 2*time.Minute, attempt)
		},
		Hint: "read self-host logs adguard-home, restore its DNS API, then run self-host setup adguard-home",
	})
}

func (App) Check(ctx context.Context, h *helpers.H) error {
	ok, err := loginWorks(ctx, h, h.AdminUser(), h.AdminPassword())
	if err != nil {
		return err
	}
	if !ok {
		return fmt.Errorf("the Admin login %s cannot sign in to AdGuard Home", h.AdminUser())
	}
	return checkDNSData(ctx, h)
}

func checkDNSData(ctx context.Context, h *helpers.H) error {
	resp, err := h.HTTP(ctx, helpers.Request{Path: "/control/status", User: h.AdminUser(), Password: h.AdminPassword(), NoRedirect: true})
	if err != nil {
		return err
	}
	if resp.Status != http.StatusOK {
		return fmt.Errorf("AdGuard Home DNS status returned HTTP %d", resp.Status)
	}
	var status struct {
		Version  string
		Running  *bool
		DNSPort  int `json:"dns_port"`
		HTTPPort int `json:"http_port"`
	}
	if resp.Decode(&status) != nil || status.Version == "" || status.Running == nil || status.DNSPort < 1 || status.HTTPPort != 3000 {
		return errors.New("AdGuard Home did not return its DNS status on the managed administration port 3000")
	}
	if !*status.Running {
		return errors.New("AdGuard Home DNS is not running; read self-host logs adguard-home, then run self-host setup adguard-home")
	}
	resp, err = h.HTTP(ctx, helpers.Request{Path: "/control/stats", User: h.AdminUser(), Password: h.AdminPassword(), NoRedirect: true})
	if err != nil {
		return err
	}
	if resp.Status != http.StatusOK {
		return fmt.Errorf("AdGuard Home DNS statistics returned HTTP %d", resp.Status)
	}
	var stats struct {
		TimeUnits        string   `json:"time_units"`
		DNSQueries       []*int64 `json:"dns_queries"`
		BlockedFiltering []*int64 `json:"blocked_filtering"`
		NumDNSQueries    *int64   `json:"num_dns_queries"`
		NumBlocked       *int64   `json:"num_blocked_filtering"`
	}
	if resp.Decode(&stats) != nil || (stats.TimeUnits != "hours" && stats.TimeUnits != "days") || stats.DNSQueries == nil || stats.BlockedFiltering == nil || stats.NumDNSQueries == nil || stats.NumBlocked == nil || *stats.NumDNSQueries < 0 || *stats.NumBlocked < 0 {
		return errors.New("AdGuard Home did not return DNS query and blocking statistics; run self-host setup adguard-home after restoring its statistics API")
	}
	for _, counts := range [][]*int64{stats.DNSQueries, stats.BlockedFiltering} {
		for _, count := range counts {
			if count == nil || *count < 0 {
				return errors.New("AdGuard Home returned invalid DNS query or blocking histogram counts; restore its statistics API, then run self-host setup adguard-home")
			}
		}
	}
	resp, err = h.HTTP(ctx, helpers.Request{Path: "/control/filtering/status", User: h.AdminUser(), Password: h.AdminPassword(), NoRedirect: true})
	if err != nil {
		return err
	}
	if resp.Status != http.StatusOK {
		return fmt.Errorf("AdGuard Home filtering status returned HTTP %d", resp.Status)
	}
	var filtering struct {
		Filters json.RawMessage
	}
	if resp.Decode(&filtering) != nil || filtering.Filters == nil {
		return errors.New("AdGuard Home did not return its DNS filters")
	}
	var filters []struct {
		Enabled    *bool  `json:"enabled"`
		RulesCount *int64 `json:"rules_count"`
	}
	if json.Unmarshal(filtering.Filters, &filters) != nil {
		return errors.New("AdGuard Home did not return its DNS filters")
	}
	for _, filter := range filters {
		if filter.Enabled == nil || filter.RulesCount == nil || *filter.RulesCount < 0 {
			return errors.New("AdGuard Home did not return its DNS filtering rule counts")
		}
	}
	return nil
}
