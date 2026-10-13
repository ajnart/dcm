// Package deluge is the Deluge BitTorrent client with its Web UI.
// Traps: docs/catalog/traps/deluge.md.
package deluge

import (
	"context"
	"encoding/json"
	"errors"
	"math"
	"net/http"
	"strconv"
	"time"

	"github.com/ajnart/self-host/internal/app"
	"github.com/ajnart/self-host/internal/helpers"
)

type App struct{}

func (App) Info() app.Info {
	return app.Info{
		ID: "deluge", Name: "Deluge", Category: "Downloads",
		Description:   "Download torrents in the background, with a simple web page to manage them",
		Image:         "lscr.io/linuxserver/deluge:2.2.0-ls381",
		Docs:          "https://deluge.readthedocs.io/en/latest/",
		Port:          8112,
		ContainerPort: 8112,
		Service:       "deluge",
	}
}

func (App) Inputs() []app.Input { return nil }

func (App) Compose(rc app.RenderContext) string {
	port := strconv.Itoa(rc.Port)
	return `services:
  deluge:
    image: lscr.io/linuxserver/deluge:2.2.0-ls381
    restart: unless-stopped
    environment:
      PUID: ${PUID}
      PGID: ${PGID}
      TZ: ${TZ}
    volumes:
      - ./config:/config
      - ./media-data:/downloads
    ports:
      - ${BIND_IP}:` + port + `:8112
`
}

// initialPassword is the shared default Deluge Web UI password the image ships
// with; Setup rotates it to the Admin login.
const initialPassword = "deluge"

type rpcResponse struct {
	ID     *int            `json:"id"`
	Error  json.RawMessage `json:"error"`
	Result json.RawMessage `json:"result"`
}

func newSession(h *helpers.H) *helpers.Session {
	if h.Config.HTTP != nil {
		client := *h.Config.HTTP
		client.Jar = nil
		isolated := *h
		isolated.Config.HTTP = &client
		h = &isolated
	}
	return h.Session()
}

func rpc(ctx context.Context, s *helpers.Session, method string, params ...any) (rpcResponse, error) {
	if params == nil {
		params = []any{}
	}
	resp, err := s.HTTP(ctx, helpers.Request{Method: http.MethodPost, Path: "/json", NoRedirect: true,
		JSON: map[string]any{"method": method, "params": params, "id": 1}})
	if err != nil {
		return rpcResponse{}, err
	}
	if resp.Status != http.StatusOK {
		return rpcResponse{}, errors.New("Deluge rejected the Web API request; run self-host setup deluge")
	}
	var body rpcResponse
	if err := resp.Decode(&body); err != nil {
		return rpcResponse{}, errors.New("Deluge returned an invalid Web API response")
	}
	if body.ID == nil || *body.ID != 1 || len(body.Error) == 0 || string(body.Error) != "null" || len(body.Result) == 0 {
		return rpcResponse{}, errors.New("Deluge returned a JSON-RPC error or incomplete response; run self-host setup deluge")
	}
	return body, nil
}

func (r rpcResponse) boolean() (bool, error) {
	var value *bool
	if json.Unmarshal(r.Result, &value) != nil || value == nil {
		return false, errors.New("Deluge did not return the required Web API result")
	}
	return *value, nil
}

func login(ctx context.Context, h *helpers.H, password string) (*helpers.Session, error) {
	if password == "" {
		return nil, errors.New("Deluge Web password is missing; run self-host setup deluge")
	}
	s := newSession(h)
	body, err := rpc(ctx, s, "auth.login", password)
	if err != nil {
		return nil, err
	}
	ok, err := body.boolean()
	if err != nil || !ok {
		return nil, err
	}
	cookie := s.Cookie("_session_id")
	if cookie == "" {
		return nil, errors.New("Deluge did not issue an authenticated Web session")
	}
	h.Log.Secret(cookie)
	session, err := rpc(ctx, s, "auth.check_session")
	if err != nil {
		return nil, err
	}
	valid, err := session.boolean()
	if err != nil {
		return nil, err
	}
	if !valid {
		return nil, errors.New("Deluge rejected the new Web session; run self-host setup deluge")
	}
	return s, nil
}

func WebPassword(h *helpers.H) string {
	return h.Secret(h.Key("web_password"))
}

func webSession(ctx context.Context, h *helpers.H) (*helpers.Session, error) {
	password := WebPassword(h)
	if password == initialPassword {
		return nil, errors.New("Deluge still uses its shared initial Web password; run self-host setup deluge")
	}
	s, err := login(ctx, h, password)
	if err != nil {
		return nil, err
	}
	if s == nil {
		return nil, errors.New("the saved Deluge Web password was rejected; restore it through the Project secret boundary or change it to the Admin login, then run self-host setup deluge")
	}
	return s, nil
}

func canLogin(ctx context.Context, h *helpers.H, password string) (bool, error) {
	s, err := login(ctx, h, password)
	if s != nil {
		defer rpc(ctx, s, "auth.delete_session")
	}
	return s != nil, err
}

func establishPassword(ctx context.Context, h *helpers.H) error {
	password := h.AdminPassword()
	if password == "" || password == initialPassword {
		return errors.New("a non-default Admin password is required for Deluge Setup")
	}
	if ok, err := canLogin(ctx, h, password); err != nil {
		return err
	} else if ok {
		return h.SetSecret(h.Key("web_password"), password)
	}
	s, err := login(ctx, h, initialPassword)
	if err != nil {
		return err
	}
	if s == nil {
		return errors.New("the initial and Admin passwords were rejected; restore the saved Deluge Web password through the Project secret boundary or change it to the Admin login, then run self-host setup deluge")
	}
	defer rpc(ctx, s, "auth.delete_session")
	rotated, err := rpc(ctx, s, "auth.change_password", initialPassword, password)
	if err != nil {
		return err
	}
	ok, err := rotated.boolean()
	if err != nil {
		return err
	}
	if !ok {
		return errors.New("Deluge did not confirm the Web password change")
	}
	if ok, err := canLogin(ctx, h, password); err != nil {
		return err
	} else if !ok {
		return errors.New("Deluge rejected the changed Web password; run self-host setup deluge")
	}
	return h.SetSecret(h.Key("web_password"), password)
}

func connectDaemon(ctx context.Context, h *helpers.H) error {
	s, err := webSession(ctx, h)
	if err != nil {
		return err
	}
	defer rpc(ctx, s, "auth.delete_session")
	connected, err := daemonConnected(ctx, s)
	if err != nil {
		return err
	}
	if connected {
		return verifyQueue(ctx, s)
	}
	configuration, err := rpc(ctx, s, "web.get_config")
	if err != nil {
		return err
	}
	var config struct {
		DefaultDaemon *string `json:"default_daemon"`
	}
	if json.Unmarshal(configuration.Result, &config) != nil || config.DefaultDaemon == nil {
		return errors.New("Deluge did not return its Web connection settings")
	}
	response, err := rpc(ctx, s, "web.get_hosts")
	if err != nil {
		return err
	}
	var hosts [][]json.RawMessage
	if json.Unmarshal(response.Result, &hosts) != nil || hosts == nil {
		return errors.New("Deluge did not return its saved daemon connections")
	}
	id := ""
	for _, host := range hosts {
		if len(host) != 4 {
			return errors.New("Deluge returned an incomplete daemon connection")
		}
		var candidate, address string
		var port int
		if json.Unmarshal(host[0], &candidate) != nil || json.Unmarshal(host[1], &address) != nil || json.Unmarshal(host[2], &port) != nil {
			return errors.New("Deluge returned an invalid daemon connection")
		}
		if candidate == "" || port != 58846 || address != "127.0.0.1" && address != "localhost" && address != "::1" {
			continue
		}
		if *config.DefaultDaemon != "" && candidate != *config.DefaultDaemon {
			continue
		}
		if id != "" {
			return helpers.ErrManual
		}
		id = candidate
	}
	if id == "" {
		return helpers.ErrManual
	}
	connected, err = daemonConnected(ctx, s)
	if err != nil {
		return err
	}
	if connected {
		return verifyQueue(ctx, s)
	}
	if _, err := rpc(ctx, s, "web.connect", id); err != nil {
		return err
	}
	if err := verifyQueue(ctx, s); err != nil {
		return err
	}
	if *config.DefaultDaemon == "" {
		if _, err := rpc(ctx, s, "web.set_config", map[string]any{"default_daemon": id}); err != nil {
			return err
		}
		response, err := rpc(ctx, s, "web.get_config")
		if err != nil {
			return err
		}
		if json.Unmarshal(response.Result, &config) != nil || config.DefaultDaemon == nil || *config.DefaultDaemon != id {
			return errors.New("Deluge did not preserve its local daemon connection for restart")
		}
	}
	return nil
}

func daemonConnected(ctx context.Context, s *helpers.Session) (bool, error) {
	connected, err := rpc(ctx, s, "web.connected")
	if err != nil {
		return false, err
	}
	return connected.boolean()
}

func verifyQueue(ctx context.Context, s *helpers.Session) error {
	ok, err := daemonConnected(ctx, s)
	if err != nil {
		return err
	}
	if !ok {
		return errors.New("Deluge Web authentication succeeded but its daemon is disconnected; run self-host setup deluge or select the local daemon in its Connection Manager")
	}
	response, err := rpc(ctx, s, "web.update_ui", []string{"name", "state", "progress"}, map[string]any{})
	if err != nil {
		return err
	}
	var queue struct {
		Connected *bool                      `json:"connected"`
		Torrents  map[string]json.RawMessage `json:"torrents"`
		Stats     struct {
			Download *float64 `json:"download_rate"`
			Upload   *float64 `json:"upload_rate"`
		} `json:"stats"`
	}
	if json.Unmarshal(response.Result, &queue) != nil || queue.Connected == nil || !*queue.Connected || queue.Torrents == nil {
		return errors.New("Deluge did not return a connected download queue; run self-host setup deluge")
	}
	for _, rate := range []*float64{queue.Stats.Download, queue.Stats.Upload} {
		if rate == nil || *rate < 0 || math.IsNaN(*rate) || math.IsInf(*rate, 0) {
			return errors.New("Deluge did not return valid transfer rates; run self-host setup deluge")
		}
	}
	return nil
}

func VerifyHomarr(ctx context.Context, h *helpers.H) error {
	s, err := webSession(ctx, h)
	if err != nil {
		return err
	}
	defer rpc(ctx, s, "auth.delete_session")
	return verifyQueue(ctx, s)
}

func ready(ctx context.Context, h *helpers.H, path string) error {
	probe := func(ctx context.Context) (bool, error) {
		resp, err := h.HTTP(ctx, helpers.Request{Path: path})
		if err != nil {
			return false, err
		}
		return resp.Status < 500, nil
	}
	return h.Step(ctx, "ready", "wait for the web server on "+path, helpers.StepSpec{
		Check: probe,
		Do:    func(ctx context.Context) error { return h.Poll(ctx, 2*time.Minute, probe) },
		Hint:  "Check the App's logs: self-host logs " + h.App,
	})
}

func (App) Setup(ctx context.Context, h *helpers.H) error {
	if err := ready(ctx, h, "/"); err != nil {
		return err
	}
	if err := h.Step(ctx, "web-password", "verify and save the Deluge Web password", helpers.StepSpec{
		Check: func(ctx context.Context) (bool, error) {
			password := WebPassword(h)
			if password == "" || password == initialPassword {
				return false, nil
			}
			return canLogin(ctx, h, password)
		},
		Do: func(ctx context.Context) error { return establishPassword(ctx, h) },
		Hint: "Open " + h.URL + " and change the Deluge Web password to the one shown by `self-host credentials`, " +
			"then run: self-host setup deluge",
		Credential: "admin",
	}); err != nil {
		return err
	}
	return h.Step(ctx, "daemon", "verify the Deluge daemon and download queue", helpers.StepSpec{
		Check: func(ctx context.Context) (bool, error) {
			err := VerifyHomarr(ctx, h)
			return err == nil, err
		},
		Do:         func(ctx context.Context) error { return connectDaemon(ctx, h) },
		Hint:       "Open " + h.URL + " and select the local daemon in Connection Manager. If more than one is listed, choose the intended daemon and enable automatic connection. Then run: self-host setup deluge",
		Credential: "admin",
	})
}

func (App) Check(ctx context.Context, h *helpers.H) error {
	return VerifyHomarr(ctx, h)
}

func (App) Links() []app.Link { return nil }
