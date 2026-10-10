// Package passbolt is Passbolt: a team password manager whose browser
// extension holds the OpenPGP keys, backed by MariaDB and an SMTP relay.
package passbolt

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"regexp"
	"strconv"

	"github.com/ajnart/self-host/internal/app"
	"github.com/ajnart/self-host/internal/helpers"
)

// App is Passbolt. Traps: docs/catalog/traps/passbolt.md.
type App struct{}

func (App) Info() app.Info {
	return app.Info{
		ID: "passbolt", Name: "Passbolt", Category: "Passwords",
		Description:   "Share passwords safely with your team, with a browser add-on",
		Image:         "passbolt/passbolt:5.16.0-1-ce",
		Docs:          "https://www.passbolt.com/docs/hosting/install/ce/docker/",
		Port:          18085,
		ContainerPort: 80,
		Service:       "passbolt",
	}
}

// Inputs requires the stable private HTTPS origin and the owner-approved
// no-auth STARTTLS relay; changing the origin after enrollment unlinks clients.
func (App) Inputs() []app.Input {
	return []app.Input{
		{
			Key:      "PASSBOLT_CANONICAL_ORIGIN",
			Prompt:   "Stable private HTTPS URL for Passbolt",
			Help:     "The exact https://host clients will use, e.g. https://passbolt.selfhost.local. See https://www.passbolt.com/docs/hosting/install/ce/docker/",
			Required: true,
		},
		{
			Key:      "PASSBOLT_SMTP_HOST",
			Prompt:   "No-auth STARTTLS SMTP relay hostname",
			Help:     "An owner-approved relay; authenticated SMTP needs separate credential transport",
			Required: true,
		},
		{Key: "PASSBOLT_SMTP_PORT", Prompt: "SMTP relay port", Default: "587"},
		{Key: "PASSBOLT_FROM_EMAIL", Prompt: "Notification sender email", Default: "passbolt@selfhost.local"},
		{Key: "PASSBOLT_FROM_NAME", Prompt: "Notification sender name", Default: "Passbolt"},
		{Key: "PASSBOLT_SERVER_KEY_EMAIL", Prompt: "Initial server OpenPGP key email", Default: "passbolt@selfhost.local"},
		{Key: "PASSBOLT_SERVER_KEY_NAME", Prompt: "Initial server OpenPGP key name", Default: "Passbolt"},
	}
}

func (App) Secrets() []app.SecretSpec {
	return []app.SecretSpec{
		{Name: "database_password", Length: 48},
		{Name: "database_root_password", Length: 48},
	}
}

func origin(rc app.RenderContext) string {
	if value := rc.Inputs["PASSBOLT_CANONICAL_ORIGIN"]; value != "" {
		return value
	}
	return "https://passbolt.example.com"
}

func input(rc app.RenderContext, key, fallback string) string {
	if value := rc.Inputs[key]; value != "" {
		return value
	}
	return fallback
}

func (App) Compose(rc app.RenderContext) string {
	port := strconv.Itoa(rc.Port)
	// A fresh bind hides the image directory's www-data group write access. The official
	// entrypoint exports its server keys there as www-data before starting nginx.
	return `services:
  passbolt:
    image: passbolt/passbolt:5.16.0-1-ce
    restart: unless-stopped
    command: ["/bin/sh", "-c", "chown www-data:www-data /etc/passbolt/gpg && chmod 0700 /etc/passbolt/gpg && exec /usr/bin/wait-for.sh -t 0 passbolt-db:3306 -- /docker-entrypoint.sh"]
    environment:
      TZ: ${TZ}
      APP_FULL_BASE_URL: ` + origin(rc) + `
      PASSBOLT_SSL_FORCE: "true"
      EMAIL_DEFAULT_FROM: ` + input(rc, "PASSBOLT_FROM_EMAIL", "passbolt@selfhost.local") + `
      EMAIL_DEFAULT_FROM_NAME: ` + input(rc, "PASSBOLT_FROM_NAME", "Passbolt") + `
      EMAIL_TRANSPORT_DEFAULT_HOST: ` + input(rc, "PASSBOLT_SMTP_HOST", "smtp.example.com") + `
      EMAIL_TRANSPORT_DEFAULT_PORT: "` + input(rc, "PASSBOLT_SMTP_PORT", "587") + `"
      EMAIL_TRANSPORT_DEFAULT_TLS: "true"
      PASSBOLT_KEY_EMAIL: ` + input(rc, "PASSBOLT_SERVER_KEY_EMAIL", "passbolt@selfhost.local") + `
      PASSBOLT_KEY_NAME: ` + input(rc, "PASSBOLT_SERVER_KEY_NAME", "Passbolt") + `
      DATASOURCES_DEFAULT_HOST: passbolt-db
      DATASOURCES_DEFAULT_USERNAME: passbolt
      DATASOURCES_DEFAULT_DATABASE: passbolt
      DATASOURCES_DEFAULT_PASSWORD: ${PASSBOLT_DATABASE_PASSWORD}
    volumes:
      - ./gpg:/etc/passbolt/gpg
      - ./jwt:/etc/passbolt/jwt
    depends_on:
      - passbolt-db
    ports:
      - ${BIND_IP}:` + port + `:80
  passbolt-db:
    image: mariadb:10.11
    restart: unless-stopped
    environment:
      MYSQL_DATABASE: passbolt
      MYSQL_USER: passbolt
      MYSQL_PASSWORD: ${PASSBOLT_DATABASE_PASSWORD}
      MYSQL_ROOT_PASSWORD: ${PASSBOLT_DATABASE_ROOT_PASSWORD}
    volumes:
      - ./database:/var/lib/mysql
`
}

const managementHint = "Set the origin with: self-host install passbolt --yes --set passbolt.PASSBOLT_CANONICAL_ORIGIN=https://passbolt.selfhost.local " +
	"--set passbolt.PASSBOLT_SMTP_HOST=smtp.example.com (see https://www.passbolt.com/docs/hosting/install/ce/docker/)"

var fingerprint = regexp.MustCompile(`^[0-9A-Fa-f]{40}$`)

type verifyEnvelope struct {
	Header struct {
		Status string `json:"status"`
	} `json:"header"`
	Body struct {
		Fingerprint string `json:"fingerprint"`
		Keydata     string `json:"keydata"`
	} `json:"body"`
}

func serverKeyWorks(ctx context.Context, h *helpers.H) (bool, error) {
	resp, err := h.HTTP(ctx, helpers.Request{Path: "/auth/verify.json"})
	if err != nil {
		return false, err
	}
	if resp.Status != http.StatusOK {
		return false, nil
	}
	var envelope verifyEnvelope
	if err := resp.Decode(&envelope); err != nil {
		return false, err
	}
	return envelope.Header.Status == "success" && fingerprint.MatchString(envelope.Body.Fingerprint) && envelope.Body.Keydata != "", nil
}

func (App) Setup(ctx context.Context, h *helpers.H) error {
	base := h.Inputs["PASSBOLT_CANONICAL_ORIGIN"]
	relay := h.Inputs["PASSBOLT_SMTP_HOST"]
	if err := h.Step(ctx, "configuration", "the HTTPS origin and SMTP relay are set", helpers.StepSpec{
		Check: func(context.Context) (bool, error) {
			return base != "" && relay != "", nil
		},
		Hint: managementHint,
	}); err != nil {
		return err
	}
	if err := h.Ready(ctx, "/auth/verify.json"); err != nil {
		return err
	}
	if err := h.Step(ctx, "server-key", "Passbolt serves its server OpenPGP key", helpers.StepSpec{
		Check:      func(ctx context.Context) (bool, error) { return serverKeyWorks(ctx, h) },
		Do:         func(context.Context) error { return errors.New("Passbolt is not serving a server key yet") },
		Hint:       "Read Passbolt's logs for startup errors: self-host logs passbolt. Keep the database, gpg and jwt volumes across recreation.",
		Credential: "admin",
	}); err != nil {
		return err
	}
	return h.Step(ctx, "admin", "enroll the administrator's browser extension", helpers.StepSpec{
		Do:   func(context.Context) error { return fmt.Errorf("%w: %s", helpers.ErrManual, manualAdmin) },
		Hint: enrollmentHint(h),
	})
}

const manualAdmin = "Passbolt has no headless way to verify browser extension enrollment"

func enrollmentHint(h *helpers.H) string {
	return "Create the first administrator by enrolling the browser extension: open " + h.URL +
		", register " + adminEmail(h) + " as an admin, and save the private key, passphrase and recovery kit privately. " +
		"The Admin password is not used: Passbolt enrollment is OpenPGP key-based. Time sync and SMTP delivery are installation prerequisites."
}

func adminEmail(h *helpers.H) string { return h.AdminUser() + "@selfhost.local" }

func (App) Check(ctx context.Context, h *helpers.H) error {
	ok, err := serverKeyWorks(ctx, h)
	if err != nil {
		return err
	}
	if !ok {
		return fmt.Errorf("Passbolt is not serving its server OpenPGP key at %s", h.BaseURL)
	}
	return nil
}

func (App) Links() []app.Link { return nil }
