// Package stalwartmail is Stalwart Mail Server: a mail server whose first-run
// admin UI is published privately; mail delivery stays a separate deployment.
package stalwartmail

import (
	"context"
	"fmt"
	"strconv"

	"github.com/ajnart/self-host/internal/app"
	"github.com/ajnart/self-host/internal/firstadmin"
	"github.com/ajnart/self-host/internal/helpers"
)

// App is Stalwart Mail Server. Traps: docs/catalog/traps/stalwart-mail.md.
type App struct{}

func (App) Info() app.Info {
	return app.Info{
		ID: "stalwart-mail", Name: "Stalwart Mail Server", Category: "Communication",
		Description:   "Run your own email service, managed from a private admin page",
		Image:         "stalwartlabs/stalwart:latest",
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

// Secrets declares the password of the bootstrap-time recovery administrator.
// Setup pins it only while it creates the permanent administrator.
func (App) Secrets() []app.SecretSpec {
	return []app.SecretSpec{{Name: "recovery_password", Length: 32}}
}

// Files makes the bind mounts owned by the Project user, which the container runs as.
func (App) Files(app.RenderContext, func(string) string) []app.File {
	return []app.File{
		{Path: "configuration/.keep", Mode: 0o644},
		{Path: "data/.keep", Mode: 0o644},
	}
}

func (App) Compose(rc app.RenderContext) string {
	port := strconv.Itoa(rc.Port)
	return `services:
  stalwart-mail:
    image: stalwartlabs/stalwart:latest
    restart: unless-stopped
    user: ${PUID}:${PGID}
    environment:
      TZ: ${TZ}
      STALWART_HOSTNAME: ` + hostname(rc) + `
      STALWART_RECOVERY_ADMIN: ${STALWART_MAIL_RECOVERY_ADMIN:-}
    volumes:
      - ./configuration:/etc/stalwart
      - ./data:/var/lib/stalwart
    ports:
      - ${BIND_IP}:` + port + `:8080
`
}

// LegacyComposes is the v0.6.0 render, which ran as root with no recovery administrator.
func (App) LegacyComposes(rc app.RenderContext) []string {
	return []string{`services:
  stalwart-mail:
    image: stalwartlabs/stalwart:latest
    restart: unless-stopped
    environment:
      TZ: ${TZ}
      STALWART_HOSTNAME: ` + hostname(rc) + `
    volumes:
      - ./configuration:/etc/stalwart
      - ./data:/var/lib/stalwart
    ports:
      - ${BIND_IP}:` + strconv.Itoa(rc.Port) + `:8080
`}
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
	return firstAdmin().Admin(ctx, h)
}

func firstAdmin() firstadmin.FirstAdmin {
	return firstadmin.FirstAdmin{
		Login:  login,
		Create: bootstrap,
		Title: func(_ *helpers.H, user string) string {
			return "complete the Stalwart setup and create the administrator " + user
		},
		Hint: func(h *helpers.H, user string) string {
			return "Open " + h.URL + " and complete the first-run wizard for " + h.Inputs["STALWART_HOSTNAME"] + "; set the administrator " +
				adminEmail(h.Inputs["STALWART_DOMAIN"]) + " with the password from `self-host credentials`. Mail delivery needs separate SMTP " +
				"ports, DNS, TLS and anti-abuse approval."
		},
	}
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
	return firstAdmin().Check(ctx, h)
}

func (App) Links() []app.Link { return nil }

func (App) StandaloneGuide() string {
	return "After the first start, finish the first-run setup in the admin UI to create the administrator."
}
