package peanut

import (
	"context"
	"errors"
	"fmt"
	"math"
	"net/http"
	"strconv"
	"strings"

	"github.com/ajnart/self-host/internal/app"
	"github.com/ajnart/self-host/internal/helpers"
)

const infoPath = "/api/v1/info"

// App is PeaNUT. Traps: docs/catalog/traps/peanut.md.
type App struct{}

func (App) Info() app.Info {
	return app.Info{
		ID: "peanut", Name: "PeaNUT", Category: "Monitoring",
		Description:   "Check on your battery backup (UPS) with a live dashboard",
		Image:         "brandawg93/peanut:latest",
		Docs:          "https://github.com/Brandawg93/PeaNUT#readme",
		Port:          8080,
		ContainerPort: 8080,
		Service:       "peanut",
	}
}

func (App) Inputs() []app.Input { return nil }

func (App) Compose(rc app.RenderContext) string {
	port := strconv.Itoa(rc.Port)
	return `services:
  peanut:
    image: brandawg93/peanut:latest
    restart: unless-stopped
    environment:
      WEB_HOST: 0.0.0.0
      WEB_PORT: "8080"
      WEB_USERNAME: ${ADMIN_USER}
      WEB_PASSWORD: ${ADMIN_PASSWORD}
    volumes:
      - ./config:/config
    ports:
      - ${BIND_IP}:` + port + `:8080
`
}

func adminWorks(ctx context.Context, h *helpers.H) (bool, error) {
	if h.AdminUser() == "" || h.AdminPassword() == "" {
		return false, nil
	}
	anonymous, err := h.HTTP(ctx, helpers.Request{Path: infoPath, NoRedirect: true})
	if err != nil {
		return false, err
	}
	if anonymous.Status != http.StatusUnauthorized && anonymous.Status != http.StatusForbidden {
		return false, nil
	}
	wrong, err := h.HTTP(ctx, helpers.Request{Path: infoPath, User: h.AdminUser(), Password: h.AdminPassword() + "-wrong", NoRedirect: true})
	if err != nil {
		return false, err
	}
	if wrong.Status != http.StatusUnauthorized && wrong.Status != http.StatusForbidden {
		return false, nil
	}
	resp, err := h.HTTP(ctx, helpers.Request{Path: infoPath, User: h.AdminUser(), Password: h.AdminPassword(), NoRedirect: true})
	if err != nil {
		return false, err
	}
	var info struct{ Version string }
	return resp.Status == http.StatusOK && resp.Decode(&info) == nil && helpers.VersionCompatible(info.Version, "6.0.0"), nil
}

func VerifyAPI(ctx context.Context, h *helpers.H) error {
	if ok, err := adminWorks(ctx, h); err != nil || !ok {
		return errors.New("PeaNUT 6.0.0 or newer 6.x must accept the Project Admin login and reject anonymous and incorrect credentials; keep authentication enabled, repair its WEB_USERNAME/WEB_PASSWORD through the Project and retry self-host setup peanut")
	}
	return nil
}

type Device struct {
	ID, Server, Status string
	Readings           map[string]float64
}

func Devices(ctx context.Context, h *helpers.H) ([]Device, error) {
	resp, err := h.HTTP(ctx, helpers.Request{Path: "/api/v1/devices?meta=true", User: h.AdminUser(), Password: h.AdminPassword(), NoRedirect: true})
	if err != nil {
		return nil, errors.New("PeaNUT device API could not be reached; run self-host setup peanut")
	}
	if resp.Status >= 500 {
		return nil, fmt.Errorf("%w: PeaNUT cannot read its NUT server; check the owner-selected server connection and retry self-host setup peanut", helpers.ErrManual)
	}
	if resp.Status != http.StatusOK {
		return nil, errors.New("PeaNUT rejected the device API request; repair its Project Admin login without disabling authentication and retry self-host setup peanut")
	}
	var raw []map[string]any
	if resp.Decode(&raw) != nil || raw == nil {
		return nil, errors.New("PeaNUT did not return a device array; use PeaNUT 6.0.0 or newer 6.x and retry self-host setup peanut")
	}
	if len(raw) == 0 {
		return nil, fmt.Errorf("%w: PeaNUT has no UPS readings; connect an owner-selected existing NUT server and retry self-host setup peanut", helpers.ErrManual)
	}
	devices := make([]Device, 0, len(raw))
	ids := map[string]bool{}
	for _, values := range raw {
		device := Device{Readings: map[string]float64{}}
		device.ID, _ = values["peanut.device_id"].(string)
		device.Server, _ = values["peanut.server"].(string)
		device.Status, _ = values["ups.status"].(string)
		if strings.TrimSpace(device.ID) == "" || strings.TrimSpace(device.Server) == "" || ids[device.ID] {
			return nil, fmt.Errorf("%w: PeaNUT needs real server/device metadata and globally unique UPS names; check the selected NUT servers and retry self-host setup peanut", helpers.ErrManual)
		}
		ids[device.ID] = true
		knownStatus := false
		for _, flag := range strings.Fields(strings.ToUpper(device.Status)) {
			if flag == "OL" || flag == "OB" || flag == "LB" {
				knownStatus = true
			}
		}
		if !knownStatus {
			return nil, fmt.Errorf("%w: a PeaNUT UPS has unavailable or unknown status; verify its NUT driver connection and retry self-host setup peanut", helpers.ErrManual)
		}
		for _, key := range []string{"battery.charge", "battery.runtime", "battery.voltage", "ups.load", "input.voltage", "output.voltage"} {
			value, present := values[key]
			if !present {
				continue
			}
			var reading float64
			switch value := value.(type) {
			case float64:
				reading = value
			case string:
				if value == "" {
					continue
				}
				reading, err = strconv.ParseFloat(strings.TrimSpace(value), 64)
			default:
				err = errors.New("unsupported reading")
			}
			if err != nil || math.IsNaN(reading) || math.IsInf(reading, 0) || reading < 0 || (key == "battery.charge" || key == "ups.load") && reading > 100 {
				return nil, fmt.Errorf("%w: PeaNUT returned an invalid UPS reading; verify the NUT driver and retry self-host setup peanut", helpers.ErrManual)
			}
			device.Readings[key] = reading
		}
		if _, present := device.Readings["battery.charge"]; !present {
			return nil, fmt.Errorf("%w: PeaNUT has no battery charge reading for a discovered UPS; verify its NUT driver and retry self-host setup peanut", helpers.ErrManual)
		}
		devices = append(devices, device)
	}
	return devices, nil
}

func (App) Setup(ctx context.Context, h *helpers.H) error {
	if err := h.Ready(ctx, infoPath, helpers.NoRedirect(), helpers.WantStatus(http.StatusOK, http.StatusUnauthorized, http.StatusForbidden)); err != nil {
		return err
	}
	if err := h.Step(ctx, "admin-auth", "verify the administrator "+h.AdminUser(), helpers.StepSpec{
		Check: func(ctx context.Context) (bool, error) { return adminWorks(ctx, h) },
		Do: func(ctx context.Context) error {
			return VerifyAPI(ctx, h)
		},
		Hint: "Keep PeaNUT 6.0.0 or newer 6.x authenticated with the Project Admin login from `self-host credentials`. " +
			"Repair its Project WEB_USERNAME/WEB_PASSWORD settings, then run self-host setup peanut. API verification does not prove the stored browser account matches.",
		Credential: "admin",
	}); err != nil {
		return err
	}
	return h.Step(ctx, "ups-data", "verify discovered UPS readings", helpers.StepSpec{
		Check: func(ctx context.Context) (bool, error) {
			_, err := Devices(ctx, h)
			return err == nil, err
		},
		Do: func(ctx context.Context) error {
			_, err := Devices(ctx, h)
			return err
		},
		Hint: "Open " + h.URL + " and connect an owner-selected existing NUT server with unique UPS names. " +
			"Verify its driver supplies UPS status and battery charge, then retry self-host setup peanut and self-host setup homarr. " +
			"This does not configure hardware, grant control access or prove physical UPS health; a dummy source verifies only API behavior.",
		Credential: "admin",
	})
}

func (App) Check(ctx context.Context, h *helpers.H) error {
	if err := VerifyAPI(ctx, h); err != nil {
		return err
	}
	_, err := Devices(ctx, h)
	return err
}

func (App) Links() []app.Link { return nil }
