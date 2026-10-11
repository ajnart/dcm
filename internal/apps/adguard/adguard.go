// Package adguard is AdGuard Home. Traps: docs/catalog/traps/adguard-home.md.
package adguard

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"strconv"
	"strings"
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
		Image:         "adguard/adguardhome:v0.107.79",
		Docs:          "https://github.com/AdguardTeam/AdGuardHome/wiki/Docker",
		Port:          3000,
		ContainerPort: 3000,
		Service:       "adguard-home",
	}
}

func (App) Inputs() []app.Input { return nil }
func (App) Links() []app.Link   { return nil }

// Compose publishes only the private admin UI; DNS port 53 needs a separate
// owner-approved cutover.
func (App) Compose(rc app.RenderContext) string {
	port := strconv.Itoa(rc.Port)
	return `services:
  adguard-home:
    image: adguard/adguardhome:v0.107.79
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
		return false, nil
	}
	resp, err := h.HTTP(ctx, helpers.Request{Path: "/control/profile", User: user, Password: password, NoRedirect: true})
	if err != nil {
		return false, err
	}
	if resp.Status != http.StatusOK {
		return false, nil
	}
	var profile struct{ Name string }
	if resp.Decode(&profile) != nil || profile.Name != user {
		return false, errors.New("AdGuard Home did not verify the Admin login; restore its account and run self-host setup adguard-home")
	}
	resp, err = h.HTTP(ctx, helpers.Request{Path: "/control/status", User: user, Password: password, NoRedirect: true})
	if err != nil {
		return false, err
	}
	if resp.Status != http.StatusOK {
		return false, fmt.Errorf("AdGuard Home DNS status returned HTTP %d", resp.Status)
	}
	var status struct {
		Version  string
		Running  bool
		DNSPort  int `json:"dns_port"`
		HTTPPort int `json:"http_port"`
	}
	if resp.Decode(&status) != nil || status.Version == "" || status.DNSPort < 1 || status.HTTPPort != 3000 {
		return false, errors.New("AdGuard Home did not return its DNS status on the managed administration port 3000")
	}
	if !status.Running {
		return false, errors.New("AdGuard Home DNS is not running; read self-host logs adguard-home, then run self-host setup adguard-home")
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
	return firstAdmin().Setup(ctx, h)
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
	resp, err := h.HTTP(ctx, helpers.Request{Path: "/control/stats", User: h.AdminUser(), Password: h.AdminPassword(), NoRedirect: true})
	if err != nil {
		return err
	}
	if resp.Status != http.StatusOK {
		return fmt.Errorf("AdGuard Home DNS statistics returned HTTP %d", resp.Status)
	}
	var stats struct {
		TimeUnits        string  `json:"time_units"`
		DNSQueries       []int64 `json:"dns_queries"`
		BlockedFiltering []int64 `json:"blocked_filtering"`
		NumDNSQueries    *int64  `json:"num_dns_queries"`
		NumBlocked       *int64  `json:"num_blocked_filtering"`
	}
	if resp.Decode(&stats) != nil || (stats.TimeUnits != "hours" && stats.TimeUnits != "days") || stats.DNSQueries == nil || stats.BlockedFiltering == nil || stats.NumDNSQueries == nil || stats.NumBlocked == nil || *stats.NumDNSQueries < 0 || *stats.NumBlocked < 0 {
		return errors.New("AdGuard Home did not return DNS query and blocking statistics; run self-host setup adguard-home after restoring its statistics API")
	}
	resp, err = h.HTTP(ctx, helpers.Request{Path: "/control/filtering/status", User: h.AdminUser(), Password: h.AdminPassword(), NoRedirect: true})
	if err != nil {
		return err
	}
	if resp.Status != http.StatusOK {
		return fmt.Errorf("AdGuard Home filtering status returned HTTP %d", resp.Status)
	}
	var filtering struct {
		Filters []struct {
			Enabled    *bool  `json:"enabled"`
			RulesCount *int64 `json:"rules_count"`
		}
	}
	if resp.Decode(&filtering) != nil || filtering.Filters == nil {
		return errors.New("AdGuard Home did not return its DNS filters")
	}
	for _, filter := range filtering.Filters {
		if filter.Enabled == nil || filter.RulesCount == nil || *filter.RulesCount < 0 {
			return errors.New("AdGuard Home did not return its DNS filtering rule counts")
		}
	}
	return nil
}
