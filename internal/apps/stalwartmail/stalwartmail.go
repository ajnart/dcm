// Package stalwartmail is Stalwart Mail Server: a mail server whose first-run
// admin UI is published privately; mail delivery stays a separate deployment.
package stalwartmail

import (
	"context"
	"fmt"
	"strconv"

	"github.com/ajnart/self-host/internal/app"
	"github.com/ajnart/self-host/internal/helpers"
)

// App is Stalwart Mail Server. Traps: docs/catalog/traps/stalwart-mail.md.
type App struct{}

func (App) Info() app.Info {
	return app.Info{
		ID: "stalwart-mail", Name: "Stalwart Mail Server", Category: "Communication",
		Description:   "Run your own email service, managed from a private admin page",
		Image:         "stalwartlabs/stalwart:v0.16.24",
		Docs:          "https://stalw.art/docs/install/platform/docker",
		Port:          8080,
		ContainerPort: 8080,
		Service:       "stalwart-mail",
	}
}

// Inputs requires the first-run server hostname and administrative domain;
// DNS, mail ports and TLS stay separately approved.
func (App) Inputs() []app.Input {
	return []app.Input{
		{
			Key:      "STALWART_HOSTNAME",
			Prompt:   "Server hostname for the admin UI",
			Help:     "The FQDN this server answers on, e.g. mail.selfhost.local. See https://stalw.art/docs/install/platform/docker",
			Required: true,
		},
		{
			Key:      "STALWART_DOMAIN",
			Prompt:   "Administrative account domain",
			Help:     "The domain the first administrator belongs to, e.g. selfhost.local",
			Required: true,
		},
	}
}

func hostname(rc app.RenderContext) string {
	if value := rc.Inputs["STALWART_HOSTNAME"]; value != "" {
		return value
	}
	return "mail.example.com"
}

func (App) Compose(rc app.RenderContext) string {
	port := strconv.Itoa(rc.Port)
	return `services:
  stalwart-mail:
    image: stalwartlabs/stalwart:v0.16.24
    restart: unless-stopped
    environment:
      TZ: ${TZ}
      STALWART_HOSTNAME: ` + hostname(rc) + `
    volumes:
      - ./configuration:/etc/stalwart
      - ./data:/var/lib/stalwart
    ports:
      - ${BIND_IP}:` + port + `:8080
`
}

const setupHint = "Set the hostname and domain with: self-host setup stalwart-mail --set stalwart-mail.STALWART_HOSTNAME=mail.selfhost.local " +
	"--set stalwart-mail.STALWART_DOMAIN=selfhost.local (see https://stalw.art/docs/install/platform/docker)"

func (App) Setup(ctx context.Context, h *helpers.H) error {
	host := h.Inputs["STALWART_HOSTNAME"]
	domain := h.Inputs["STALWART_DOMAIN"]
	if err := h.Step(ctx, "configuration", "the hostname and administrative domain are set", helpers.StepSpec{
		Check: func(context.Context) (bool, error) { return host != "" && domain != "", nil },
		Hint:  setupHint,
	}); err != nil {
		return err
	}
	if err := h.Ready(ctx, "/"); err != nil {
		return err
	}
	if err := h.Step(ctx, "admin-ui", "the Stalwart admin UI answers", helpers.StepSpec{
		Check:      func(ctx context.Context) (bool, error) { return adminUIAvailable(ctx, h) },
		Hint:       "Read Stalwart's logs for startup errors: self-host logs stalwart-mail",
		Credential: "admin",
	}); err != nil {
		return err
	}
	return h.Step(ctx, "admin", "complete the Stalwart administrator setup", helpers.StepSpec{
		Do:         func(context.Context) error { return fmt.Errorf("%w: %s", helpers.ErrManual, manualAdmin) },
		Hint:       adminHint(h),
		Credential: "admin",
	})
}

const manualAdmin = "Stalwart has no headless way to verify its administrator login"

func adminHint(h *helpers.H) string {
	return "Open " + h.URL + " and complete the first-run wizard for " + h.Inputs["STALWART_HOSTNAME"] + "; set the administrator " +
		adminEmail(h.Inputs["STALWART_DOMAIN"]) + " with the password from `self-host credentials`. Mail delivery needs separate SMTP " +
		"ports, DNS, TLS and anti-abuse approval."
}

func adminEmail(domain string) string {
	if domain == "" {
		return "admin@selfhost.local"
	}
	return "admin@" + domain
}

func adminUIAvailable(ctx context.Context, h *helpers.H) (bool, error) {
	resp, err := h.HTTP(ctx, helpers.Request{Path: "/"})
	if err != nil {
		return false, err
	}
	return resp.Status < 400, nil
}

func (App) Check(ctx context.Context, h *helpers.H) error {
	ok, err := adminUIAvailable(ctx, h)
	if err != nil {
		return err
	}
	if !ok {
		return fmt.Errorf("the Stalwart admin UI did not answer at %s", h.BaseURL)
	}
	return nil
}

func (App) Links() []app.Link { return nil }
