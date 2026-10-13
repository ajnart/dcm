// Package homarr is Homarr: a dashboard that brings self-hosted Apps,
// integrations and widgets onto one board. Its first administrator is created
// through its onboarding API and every later change uses a stored API key.
package homarr

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/url"
	"slices"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/ajnart/self-host/internal/app"
	"github.com/ajnart/self-host/internal/helpers"
)

// App is Homarr. Traps: docs/catalog/traps/homarr.md.
type App struct{}

func (App) Info() app.Info {
	return app.Info{
		ID: "homarr", Name: "Homarr", Category: "Dashboard",
		Description:   "Put all your apps on one home page, each a click away",
		Image:         "ghcr.io/homarr-labs/homarr:v2.4.1",
		Docs:          "https://homarr.dev/docs/getting-started/",
		Port:          7575,
		ContainerPort: 7575,
		Service:       "homarr",
	}
}

func (App) Inputs() []app.Input { return nil }

// Secrets declares the key Homarr encrypts stored secrets with. It has to
// exist before the first start and must never rotate, or stored secrets become
// undecryptable.
func (App) Secrets() []app.SecretSpec {
	return []app.SecretSpec{{Name: "secret_encryption_key", Length: 64, Hex: true}}
}

func (App) Compose(rc app.RenderContext) string {
	return `services:
  homarr:
    image: ghcr.io/homarr-labs/homarr:v2.4.1
    restart: unless-stopped
    environment:
      TZ: ${TZ}
      SECRET_ENCRYPTION_KEY: ${HOMARR_SECRET_ENCRYPTION_KEY}
    volumes:
      - ./appdata:/appdata
    ports:
      - ${BIND_IP}:` + strconv.Itoa(rc.Port) + `:7575
`
}

// session is a cookie jar: helpers.HTTP has none, so it sends the cookies the
// claim and login set and remembers the ones Homarr returns.
type session struct {
	jar      map[string]string
	loggedIn bool
}

func newSession() *session { return &session{jar: map[string]string{}} }

func (s *session) cookieHeader() string {
	names := make([]string, 0, len(s.jar))
	for name := range s.jar {
		names = append(names, name)
	}
	sort.Strings(names)
	parts := make([]string, 0, len(names))
	for _, name := range names {
		parts = append(parts, name+"="+s.jar[name])
	}
	return strings.Join(parts, "; ")
}

func (s *session) absorb(resp helpers.Response) {
	for _, raw := range resp.Header.Values("Set-Cookie") {
		pair, _, _ := strings.Cut(raw, ";")
		eq := strings.IndexByte(pair, '=')
		if eq <= 0 {
			continue
		}
		name := strings.TrimSpace(pair[:eq])
		value := strings.TrimSpace(pair[eq+1:])
		if strings.Contains(strings.ToLower(raw), "max-age=0") {
			delete(s.jar, name)
			continue
		}
		s.jar[name] = value
	}
}

func (s *session) do(ctx context.Context, h *helpers.H, req helpers.Request) (helpers.Response, error) {
	if len(s.jar) > 0 {
		header := map[string]string{}
		for name, value := range req.Header {
			header[name] = value
		}
		header["Cookie"] = s.cookieHeader()
		req.Header = header
	}
	resp, err := h.HTTP(ctx, req)
	if err != nil {
		return resp, err
	}
	s.absorb(resp)
	return resp, nil
}

// envelope is tRPC's SuperJSON reply: {"result":{"data":{"json":…}}} on
// success, {"error":{"json":{"message","code"}}} otherwise.
type envelope struct {
	Result struct {
		Data struct {
			JSON json.RawMessage `json:"json"`
		} `json:"data"`
	} `json:"result"`
	Error struct {
		JSON struct {
			Message string `json:"message"`
			Code    string `json:"code"`
		} `json:"json"`
	} `json:"error"`
}

func decodeProcedure(resp helpers.Response) (any, error) {
	var env envelope
	if err := json.Unmarshal(resp.Body, &env); err != nil {
		return nil, fmt.Errorf("Homarr returned an invalid response (HTTP %d)", resp.Status)
	}
	if env.Error.JSON.Message != "" || !resp.OK() {
		message := env.Error.JSON.Message
		if message == "" {
			message = strings.TrimSpace(string(resp.Body))
		}
		return nil, fmt.Errorf("Homarr rejected the call (HTTP %d): %s", resp.Status, message)
	}
	var value any
	if len(env.Result.Data.JSON) > 0 {
		if err := json.Unmarshal(env.Result.Data.JSON, &value); err != nil {
			return nil, err
		}
	}
	return value, nil
}

func procedurePath(proc string, input any) (string, error) {
	path := "/api/trpc/" + proc
	if input == nil {
		return path, nil
	}
	raw, err := json.Marshal(map[string]any{"json": input})
	if err != nil {
		return "", err
	}
	return path + "?input=" + url.QueryEscape(string(raw)), nil
}

// mutation POSTs a tRPC write, sending {} when the procedure takes no input.
func (s *session) mutation(ctx context.Context, h *helpers.H, proc string, input any) (any, error) {
	req := helpers.Request{Method: "POST", Path: "/api/trpc/" + proc}
	if input == nil {
		req.Body = []byte("{}")
		req.Header = map[string]string{"Content-Type": "application/json"}
	} else {
		req.JSON = map[string]any{"json": input}
	}
	resp, err := s.do(ctx, h, req)
	if err != nil {
		return nil, err
	}
	return decodeProcedure(resp)
}

func (s *session) query(ctx context.Context, h *helpers.H, proc string, input any) (any, error) {
	path, err := procedurePath(proc, input)
	if err != nil {
		return nil, err
	}
	resp, err := s.do(ctx, h, helpers.Request{Path: path})
	if err != nil {
		return nil, err
	}
	return decodeProcedure(resp)
}

// login signs in through the credentials provider and proves the session is
// the administrator. It is remembered for the run.
func (s *session) login(ctx context.Context, h *helpers.H) error {
	if s.loggedIn {
		return nil
	}
	resp, err := s.do(ctx, h, helpers.Request{Path: "/api/auth/csrf"})
	if err != nil {
		return err
	}
	var csrf struct {
		Token string `json:"csrfToken"`
	}
	if err := resp.Decode(&csrf); err != nil || csrf.Token == "" {
		return errors.New("Homarr did not return a CSRF token")
	}
	form := url.Values{
		"name":        {h.AdminUser()},
		"password":    {h.AdminPassword()},
		"csrfToken":   {csrf.Token},
		"callbackUrl": {h.URL},
	}
	resp, err = s.do(ctx, h, helpers.Request{
		Method: "POST", Path: "/api/auth/callback/credentials", Form: form,
		Header: map[string]string{"X-Auth-Return-Redirect": "1"},
	})
	if err != nil {
		return err
	}
	if !resp.OK() {
		return fmt.Errorf("the login form returned HTTP %d", resp.Status)
	}
	resp, err = s.do(ctx, h, helpers.Request{Path: "/api/auth/session"})
	if err != nil {
		return err
	}
	var current struct {
		User struct {
			Name        string   `json:"name"`
			Permissions []string `json:"permissions"`
		} `json:"user"`
	}
	if err := resp.Decode(&current); err != nil {
		return err
	}
	if current.User.Name != strings.ToLower(h.AdminUser()) || !slices.Contains(current.User.Permissions, "admin") {
		return errors.New("the Admin login did not establish an administrator session")
	}
	s.loggedIn = true
	return nil
}

// admin reports whether the Admin login signs in; a failed login is a normal
// state for the step to fix, not an error.
func (s *session) admin(ctx context.Context, h *helpers.H) (bool, error) {
	if err := s.login(ctx, h); err != nil {
		return false, nil
	}
	return true, nil
}

func (s *session) currentStep(ctx context.Context, h *helpers.H) (string, error) {
	value, err := s.query(ctx, h, "onboard.currentStep", nil)
	if err != nil {
		return "", err
	}
	record, _ := value.(map[string]any)
	step, _ := record["current"].(string)
	return step, nil
}

// createAdmin claims onboarding and creates the first administrator. When the
// instance already has one that the Admin login cannot sign in to, it stops
// rather than taking another administrator's instance.
func (s *session) createAdmin(ctx context.Context, h *helpers.H) error {
	step, err := s.currentStep(ctx, h)
	if err != nil {
		return err
	}
	if step == "start" || step == "user" {
		resp, err := s.do(ctx, h, helpers.Request{Method: "POST", Path: "/api/onboarding/claim"})
		if err != nil {
			return err
		}
		if !resp.OK() {
			return fmt.Errorf("Homarr onboarding claim returned HTTP %d", resp.Status)
		}
	}
	if step == "start" {
		if _, err := s.mutation(ctx, h, "onboard.nextStep", nil); err != nil {
			return err
		}
		step = "user"
	}
	if step == "user" {
		user := strings.ToLower(h.AdminUser())
		_, err := s.mutation(ctx, h, "user.initUser", map[string]any{
			"username":        user,
			"password":        h.AdminPassword(),
			"confirmPassword": h.AdminPassword(),
			"email":           user + "@selfhost.local",
		})
		return err
	}
	return errors.New("another administrator already owns Homarr")
}

func (s *session) atFinish(ctx context.Context, h *helpers.H) (bool, error) {
	if err := s.login(ctx, h); err != nil {
		return false, err
	}
	step, err := s.currentStep(ctx, h)
	if err != nil {
		return false, err
	}
	return step == "finish", nil
}

func (s *session) completeSetup(ctx context.Context, h *helpers.H) error {
	if err := s.login(ctx, h); err != nil {
		return err
	}
	_, err := s.mutation(ctx, h, "onboard.completeSetup", map[string]any{
		"server": map[string]any{"defaultLocale": "en", "defaultColorScheme": "dark", "analyticsEnabled": false},
		"board": map[string]any{
			"name": "Home", "primaryColor": "#228BE6", "secondaryColor": "#15AABF",
			"itemRadius": "md", "layoutPreset": "balanced", "leftSidebar": false, "rightSidebar": false,
		},
		"selectedIntegrationIds": []any{}, "selectedAppIds": []any{},
		"integrations": []any{}, "apps": []any{},
		"selectedDockerSourceIds": []any{}, "selectedWidgetKinds": []any{},
	})
	return err
}

func apiKeyHeader(h *helpers.H) map[string]string {
	return map[string]string{"ApiKey": h.Secret(h.Key("api_key"))}
}

// apiKeyWorks proves the stored API key is accepted by a tRPC read.
func apiKeyWorks(ctx context.Context, h *helpers.H) (bool, error) {
	if h.Secret(h.Key("api_key")) == "" {
		return false, nil
	}
	resp, err := h.HTTP(ctx, helpers.Request{Path: "/api/trpc/apiKeys.getAll", Header: apiKeyHeader(h)})
	if err != nil {
		return false, err
	}
	if resp.Status == 401 || resp.Status == 403 {
		return false, nil
	}
	if !resp.OK() {
		return false, fmt.Errorf("Homarr API-key check returned HTTP %d", resp.Status)
	}
	value, err := decodeProcedure(resp)
	if err != nil {
		return false, err
	}
	if _, ok := value.([]any); !ok {
		return false, errors.New("Homarr API-key check was inconclusive")
	}
	return true, nil
}

func (s *session) createAPIKey(ctx context.Context, h *helpers.H) error {
	if err := s.login(ctx, h); err != nil {
		return err
	}
	value, err := s.mutation(ctx, h, "apiKeys.create", nil)
	if err != nil {
		return err
	}
	record, _ := value.(map[string]any)
	key, _ := record["apiKey"].(string)
	if !strings.Contains(key, ".") {
		return errors.New("Homarr did not return a usable API key")
	}
	return h.SetSecret(h.Key("api_key"), key)
}

func (App) Setup(ctx context.Context, h *helpers.H) error {
	if err := h.Ready(ctx, "/api/health/live", helpers.Timeout(2*time.Minute)); err != nil {
		return err
	}
	if ok, err := apiKeyWorks(ctx, h); err != nil {
		return err
	} else if ok {
		if err := supportedVersion(ctx, h); err != nil {
			return err
		}
	}
	s := newSession()
	err := h.Step(ctx, "admin", "sign in as the administrator "+h.AdminUser(), helpers.StepSpec{
		Check: func(ctx context.Context) (bool, error) { return s.admin(ctx, h) },
		Do:    func(ctx context.Context) error { return s.createAdmin(ctx, h) },
		Hint: "Open " + h.URL + " and create or sign in as the administrator " + h.AdminUser() +
			" with the password from `self-host credentials`. If another administrator was created first, " +
			"sign in with those credentials instead.",
		Credential: "admin",
	})
	if err != nil {
		return err
	}
	err = h.Step(ctx, "onboarding", "finish the Homarr board setup", helpers.StepSpec{
		Check:      func(ctx context.Context) (bool, error) { return s.atFinish(ctx, h) },
		Do:         func(ctx context.Context) error { return s.completeSetup(ctx, h) },
		Hint:       "Open " + h.URL + " and finish the setup wizard, naming the board Home.",
		Credential: "admin",
	})
	if err != nil {
		return err
	}
	err = h.Step(ctx, "api-key", "create and store a Homarr API key", helpers.StepSpec{
		Check: func(ctx context.Context) (bool, error) { return apiKeyWorks(ctx, h) },
		Do:    func(ctx context.Context) error { return s.createAPIKey(ctx, h) },
		Hint: "Open " + h.URL + "/manage/api, create an API key and save it in secrets.env as " +
			h.Key("api_key") + ".",
		Credential: "admin",
	})
	if err != nil {
		return err
	}
	if err := supportedVersion(ctx, h); err != nil {
		return err
	}
	if h.InstalledApps != nil {
		if err := h.Step(ctx, "app-tiles", "reconcile installed App tiles", helpers.StepSpec{
			Check: func(ctx context.Context) (bool, error) { return installedTiles(ctx, h, false) },
			Do:    func(ctx context.Context) error { _, err := installedTiles(ctx, h, true); return err },
			Hint:  "Run self-host setup homarr to reconcile installed App tiles; tiles prove navigation only.",
		}); err != nil {
			return err
		}
	}
	if err := ensureAssistant(ctx, h); err != nil {
		return err
	}
	return h.Step(ctx, "notebook", "place the Homarr notebook", helpers.StepSpec{
		Check:      func(ctx context.Context) (bool, error) { return notebookCurrent(ctx, h) },
		Do:         func(ctx context.Context) error { return updateNotebook(ctx, h) },
		Hint:       "Open " + h.URL + " and add a Notebook widget, or rerun this step.",
		Credential: "admin",
	})
}

func (App) Check(ctx context.Context, h *helpers.H) error {
	ok, err := apiKeyWorks(ctx, h)
	if err != nil {
		return fmt.Errorf("the Homarr API key could not be checked: %w", err)
	}
	if !ok {
		return errors.New("the stored Homarr API key is not accepted")
	}
	if err := supportedVersion(ctx, h); err != nil {
		return err
	}
	if err := newSession().login(ctx, h); err != nil {
		return fmt.Errorf("the Admin login %s cannot sign in to Homarr: %w", h.AdminUser(), err)
	}
	return nil
}
