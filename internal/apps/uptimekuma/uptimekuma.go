package uptimekuma

import (
	"context"
	"errors"
	"fmt"
	"regexp"
	"strconv"
	"strings"

	"github.com/ajnart/self-host/internal/app"
	"github.com/ajnart/self-host/internal/firstadmin"
	"github.com/ajnart/self-host/internal/helpers"
)

// App is Uptime Kuma. Traps: docs/catalog/traps/uptime-kuma.md.
type App struct{}

func (App) Info() app.Info {
	return app.Info{
		ID: "uptime-kuma", Name: "Uptime Kuma", Category: "Monitoring",
		Description:   "Get an alert when one of your websites or apps stops working",
		Image:         "louislam/uptime-kuma:2.5.5",
		Docs:          "https://github.com/louislam/uptime-kuma/wiki/%F0%9F%94%A7-How-to-Install",
		Port:          3001,
		ContainerPort: 3001,
		WebSockets:    true,
		Service:       "uptime-kuma",
	}
}

func (App) Inputs() []app.Input {
	return []app.Input{{
		Key: "homarr_status_page", Prompt: "Existing status page to show in Homarr (optional)",
		Help:     "Enter only its slug after reviewing which monitors it already shares without a login. This does not create or publish a page.",
		Validate: validateSlug,
	}}
}

var slugPattern = regexp.MustCompile(`^[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*$`)

func validateSlug(value string) error {
	if value != "" && !slugPattern.MatchString(value) {
		return errors.New("use the existing status page's slug, containing only letters, numbers and single hyphens; not its Address")
	}
	return nil
}

func HomarrSlug(h *helpers.H) string {
	return strings.ToLower(h.Inputs["homarr_status_page"])
}

func (App) Compose(rc app.RenderContext) string {
	port := strconv.Itoa(rc.Port)
	return `services:
  uptime-kuma:
    image: louislam/uptime-kuma:2.5.5
    restart: unless-stopped
    environment:
      UPTIME_KUMA_DB_TYPE: sqlite
    volumes:
      - ./appdata:/app/data
    ports:
      - ${BIND_IP}:` + port + `:3001
`
}

func (App) Links() []app.Link { return nil }

func loginWorks(ctx context.Context, h *helpers.H, user, password string) (bool, error) {
	unauthenticated, err := h.HTTP(ctx, helpers.Request{Path: "/metrics", NoRedirect: true})
	if err != nil {
		return false, err
	}
	if unauthenticated.Status == 200 {
		h.Info("Uptime Kuma metrics did not require a login; restore authentication in Settings, then retry self-host setup uptime-kuma. An open metrics endpoint cannot verify the Admin login.")
		return false, helpers.ErrManual
	}
	if unauthenticated.Status != 401 {
		return false, fmt.Errorf("Uptime Kuma metrics authentication probe returned HTTP %d; read its logs and retry Setup", unauthenticated.Status)
	}
	resp, err := h.HTTP(ctx, helpers.Request{Path: "/metrics", User: user, Password: password, NoRedirect: true})
	if err != nil {
		return false, err
	}
	if resp.Status == 401 {
		h.Info("Open Uptime Kuma and verify the saved Admin login. If API keys are enabled, metrics no longer accepts that login and this CLI cannot verify the Socket.IO sign-in; keep existing keys and authentication unchanged.")
		return false, nil
	}
	if !resp.OK() {
		return false, errors.New("the metrics endpoint did not accept the Admin login (HTTP " + strconv.Itoa(resp.Status) + ")")
	}
	return strings.Contains(string(resp.Body), "# HELP") || strings.Contains(string(resp.Body), "# TYPE"), nil
}

func setup() firstadmin.FirstAdmin {
	return firstadmin.FirstAdmin{
		Ready: firstadmin.Probe{Path: "/"},
		Login: loginWorks,
		Manual: "Uptime Kuma creates its first administrator in the web UI and has no HTTP setup API; " +
			"create it only if this is a new App. Do not replace an existing account or disable authentication. " +
			"API-key metrics authentication cannot verify the Admin login; keep existing keys unchanged",
	}
}

func (App) Setup(ctx context.Context, h *helpers.H) error {
	if err := setup().Setup(ctx, h); err != nil {
		return err
	}
	if HomarrSlug(h) == "" {
		return nil
	}
	return h.Step(ctx, "homarr-status-page", "verify the selected Uptime Kuma status page", helpers.StepSpec{
		Check: func(ctx context.Context) (bool, error) {
			_, err := HomarrMonitors(ctx, h)
			return err == nil, err
		},
		Do: func(ctx context.Context) error {
			_, err := HomarrMonitors(ctx, h)
			return err
		},
		Hint:       "Open " + h.URL + "/manage-status-page and review the selected page and its already shared monitors; do not publish private monitors. Then run self-host setup uptime-kuma and self-host setup homarr.",
		Credential: "admin",
	})
}

func (App) Check(ctx context.Context, h *helpers.H) error {
	if err := setup().Check(ctx, h); err != nil {
		return err
	}
	if HomarrSlug(h) == "" {
		return nil
	}
	_, err := HomarrMonitors(ctx, h)
	return err
}

type HomarrMonitor struct {
	ID   int64
	Name string
}

func HomarrMonitors(ctx context.Context, h *helpers.H) ([]HomarrMonitor, error) {
	slug := HomarrSlug(h)
	if slug == "" {
		h.Info("Homarr needs an explicitly selected existing Uptime Kuma status page. Review the monitors it already shares without a login. Saving its slug requires reinstall, which replaces apps/uptime-kuma/compose.yml and can restart the App. First preserve and review custom authentication, mounts and ports and separately approve the concrete replacement plan. If custom configuration cannot survive replacement, stop; there is no input-only save command. After approval, run self-host install uptime-kuma --set uptime-kuma.homarr_status_page=SLUG; use --yes noninteractively only after that approval. Then retry self-host setup uptime-kuma and self-host setup homarr. Do not publish private monitors or change Access.")
		return nil, helpers.ErrManual
	}
	if err := validateSlug(slug); err != nil {
		return nil, err
	}
	response, err := h.HTTP(ctx, helpers.Request{Path: "/api/status-page/" + slug, NoRedirect: true})
	if err != nil {
		return nil, err
	}
	if response.Status != 200 {
		h.Info("The selected Uptime Kuma status page is unavailable; review its actual slug and existing privacy settings, then retry Setup. Homarr cannot use a metrics API key to unlock a private status page.")
		return nil, helpers.ErrManual
	}
	var page struct {
		Config struct{ Slug string } `json:"config"`
		Groups *[]struct {
			ID       *int64  `json:"id"`
			Name     *string `json:"name"`
			Monitors *[]struct {
				ID   *int64  `json:"id"`
				Name *string `json:"name"`
			} `json:"monitorList"`
		} `json:"publicGroupList"`
	}
	if response.Decode(&page) != nil || page.Config.Slug != slug || page.Groups == nil {
		return nil, errors.New("Uptime Kuma did not return the selected status page and its monitor groups; review the page and retry Setup")
	}
	response, err = h.HTTP(ctx, helpers.Request{Path: "/api/status-page/heartbeat/" + slug, NoRedirect: true})
	if err != nil {
		return nil, err
	}
	if response.Status != 200 {
		return nil, fmt.Errorf("Uptime Kuma status-page heartbeats returned HTTP %d; review the selected page and retry Setup", response.Status)
	}
	var heartbeat struct {
		Lists map[string][]struct {
			Status *int    `json:"status"`
			Time   *string `json:"time"`
		} `json:"heartbeatList"`
		Uptime map[string]*float64 `json:"uptimeList"`
	}
	if response.Decode(&heartbeat) != nil || heartbeat.Lists == nil || heartbeat.Uptime == nil {
		return nil, errors.New("Uptime Kuma returned incomplete status-page heartbeat data; retry Setup")
	}
	monitors := []HomarrMonitor{}
	for _, group := range *page.Groups {
		if group.ID == nil || group.Name == nil || group.Monitors == nil {
			return nil, errors.New("Uptime Kuma returned an incomplete status-page group")
		}
		for _, monitor := range *group.Monitors {
			if monitor.ID == nil || *monitor.ID <= 0 || monitor.Name == nil {
				return nil, errors.New("Uptime Kuma returned an incomplete status-page monitor")
			}
			id := strconv.FormatInt(*monitor.ID, 10)
			beats, found := heartbeat.Lists[id]
			if !found || beats == nil {
				return nil, errors.New("Uptime Kuma omitted a selected monitor's heartbeat list; retry Setup")
			}
			for _, beat := range beats {
				if beat.Status == nil || *beat.Status < 0 || *beat.Status > 3 || beat.Time == nil || *beat.Time == "" {
					return nil, errors.New("Uptime Kuma returned an invalid monitor heartbeat")
				}
			}
			if value, found := heartbeat.Uptime[id+"_24"]; found {
				if value == nil || *value < 0 || *value > 1 {
					return nil, errors.New("Uptime Kuma returned an invalid 24-hour uptime value")
				}
			}
			monitors = append(monitors, HomarrMonitor{ID: *monitor.ID, Name: *monitor.Name})
		}
	}
	return monitors, nil
}
