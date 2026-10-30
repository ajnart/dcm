package standalone

import (
	"context"
	"strings"
	"testing"

	"github.com/ajnart/self-host/internal/app"
	"github.com/ajnart/self-host/internal/apps/minio"
	"github.com/ajnart/self-host/internal/apps/speedtesttracker"
	"github.com/ajnart/self-host/internal/helpers"
)

type fake struct {
	compose string
	secrets []app.SecretSpec
	files   func(secret func(string) string) []app.File
	guide   string
}

func (fake) Info() app.Info                          { return app.Info{ID: "fake", Name: "Fake", Port: 8080} }
func (fake) Inputs() []app.Input                     { return nil }
func (f fake) Compose(app.RenderContext) string      { return f.compose }
func (fake) Setup(context.Context, *helpers.H) error { return nil }
func (fake) Check(context.Context, *helpers.H) error { return nil }
func (fake) Links() []app.Link                       { return nil }
func (f fake) Secrets() []app.SecretSpec             { return f.secrets }
func (f fake) StandaloneGuide() string               { return f.guide }
func (f fake) Files(_ app.RenderContext, secret func(string) string) []app.File {
	if f.files == nil {
		return nil
	}
	return f.files(secret)
}

func tokenFile(secret func(string) string) []app.File {
	return []app.File{{Path: "token.txt", Content: secret("token")}}
}

const shortForm = `services:
  web:
    image: x/web:1
    restart: unless-stopped
    environment:
      TOKEN_FILE: /run/secrets/token
    volumes:
      - ./token.txt:/run/secrets/token:ro
      - ./data:/data
    ports:
      - ${BIND_IP}:8080:80
`

const longForm = `services:
  web:
    image: x/web:1
    environment:
      - TZ=${TZ}
      - TOKEN_FILE=/run/secrets/token
    volumes:
      - type: bind
        source: ./token.txt
        target: /run/secrets/token
        read_only: true
      - type: bind
        source: ./config
        target: /config
      - type: volume
        source: cache
        target: /cache
    ports:
      - target: 80
        published: 8080
        host_ip: ${BIND_IP}
`

func TestProject(t *testing.T) {
	secrets := []app.SecretSpec{{Name: "token", Length: 16}}
	cases := []struct {
		name       string
		app        app.App
		compose    []string
		notCompose []string
		notes      []string
		env        map[string]string
		standalone bool
		err        string
	}{
		{
			name:       "secret file becomes an environment variable",
			app:        fake{compose: shortForm, secrets: secrets, files: tokenFile},
			compose:    []string{"container_name: ${CONTAINER_PREFIX}web", "restart: ${RESTART_POLICY}", "TOKEN: ${FAKE_TOKEN}", "${CONFIG_PATH}/fake/data:/data", "- 8080:80"},
			notCompose: []string{"BIND_IP", "token.txt", "_FILE", "secrets:"},
			notes:      []string{"(TOKEN_FILE); this Compose passes them as plain environment variables (TOKEN)"},
			standalone: true,
		},
		{
			name:       "list-form environment and long-form volumes",
			app:        fake{compose: longForm, secrets: secrets, files: tokenFile},
			compose:    []string{"- TOKEN=${FAKE_TOKEN}", "source: ${CONFIG_PATH}/fake/config", "source: cache", "- TZ=${TZ}", "published: 8080"},
			notCompose: []string{"host_ip", "token.txt", "TOKEN_FILE"},
			standalone: true,
		},
		{
			name:       "guide may name what the compose reads",
			app:        fake{compose: shortForm, secrets: secrets, files: tokenFile, guide: "Mind the /data folder and FAKE_TOKEN."},
			notes:      []string{"Mind the /data folder and FAKE_TOKEN."},
			standalone: true,
		},
		{
			name: "guide naming something the compose lacks",
			app:  fake{compose: shortForm, secrets: secrets, files: tokenFile, guide: "Set FAKE_MISSING first."},
			err:  "guide names FAKE_MISSING",
		},
		{
			name: "guide naming a folder the compose does not mount",
			app:  fake{compose: shortForm, secrets: secrets, files: tokenFile, guide: "Look in /srv/elsewhere."},
			err:  "guide names /srv/elsewhere",
		},
		{
			name: "source that climbs out of the App's folder",
			app:  fake{compose: strings.Replace(shortForm, "./data", "../data", 1)},
			err:  `volume source "../data"`,
		},
		{
			name: "top-level key that plain Compose export does not handle",
			app:  fake{compose: shortForm + "volumes:\n  cache:\n"},
			err:  `top-level key "volumes"`,
		},
		{
			name: "list-form entry that reads a secret it cannot resolve",
			app:  fake{compose: strings.Replace(longForm, "TOKEN_FILE=/run/secrets/token", "OTHER=/run/secrets/other", 1), secrets: secrets, files: tokenFile},
			err:  "reads a secret file",
		},
		{
			name: "secret read that no volume provides",
			app:  fake{compose: strings.Replace(shortForm, "TOKEN_FILE: /run/secrets/token", "TOKEN_FILE: /run/secrets/token\n      OTHER: /run/secrets/other", 1), secrets: secrets, files: tokenFile},
			err:  "reads /run/secrets/other",
		},
		{
			name: "env_file is not supplied",
			app:  fake{compose: strings.Replace(shortForm, "restart:", "env_file: .env\n    restart:", 1)},
			err:  "uses env_file",
		},
		{
			name: "alias",
			app:  fake{compose: "services:\n  web: &web\n    image: x\n  api: *web\n"},
			err:  "YAML alias",
		},
		{
			name:       "required input bound as a mount gets a placeholder and a note",
			app:        minio.App{},
			compose:    []string{"- ${MINIO_LICENSE_FILE}:/run/secrets/aistor-license:ro", "MINIO_ROOT_PASSWORD: ${ADMIN_PASSWORD}"},
			notes:      []string{"Set MINIO_LICENSE_FILE before the first start"},
			env:        map[string]string{"MINIO_LICENSE_FILE": "./minio-license-file"},
			standalone: true,
		},
		{
			name:  "generated files make it not standalone, hex stand-in decodes",
			app:   speedtesttracker.App{},
			notes: []string{"config/app.key, php-fpm-run"},
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			entry, err := Project(tc.app)
			if tc.err != "" {
				if err == nil || !strings.Contains(err.Error(), tc.err) {
					t.Fatalf("error = %v, want one containing %q", err, tc.err)
				}
				return
			}
			if err != nil {
				t.Fatal(err)
			}
			if entry.Standalone != tc.standalone {
				t.Errorf("Standalone = %v, want %v", entry.Standalone, tc.standalone)
			}
			for _, want := range tc.compose {
				if !strings.Contains(entry.Compose, want) {
					t.Errorf("compose lacks %q:\n%s", want, entry.Compose)
				}
			}
			for _, unwanted := range tc.notCompose {
				if strings.Contains(entry.Compose, unwanted) {
					t.Errorf("compose still has %q:\n%s", unwanted, entry.Compose)
				}
			}
			for _, want := range tc.notes {
				if !strings.Contains(entry.Notes, want) {
					t.Errorf("notes lack %q: %s", want, entry.Notes)
				}
			}
			for key, want := range tc.env {
				found := false
				for _, v := range entry.Env {
					if v.Key == key {
						found = true
						if v.Default != want {
							t.Errorf("%s default = %q, want %q", key, v.Default, want)
						}
					}
				}
				if !found {
					t.Errorf("env lacks %s", key)
				}
			}
		})
	}
}
