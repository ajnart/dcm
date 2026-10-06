// Package service implements every operation on a Project. The CLI and the
// TUI both call it; neither talks to Docker or the Project files directly.
package service

import (
	"context"
	"crypto/rand"
	"errors"
	"fmt"
	"math/big"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"time"

	"go.yaml.in/yaml/v3"

	"github.com/ajnart/self-host/internal/app"
	"github.com/ajnart/self-host/internal/catalog"
	"github.com/ajnart/self-host/internal/compose"
	"github.com/ajnart/self-host/internal/events"
	"github.com/ajnart/self-host/internal/helpers"
	"github.com/ajnart/self-host/internal/project"
	"github.com/ajnart/self-host/internal/system"
)

// ErrIncomplete means some Setup steps failed; the hints say how to finish.
var ErrIncomplete = errors.New("setup incomplete")

// ErrNoProject means no Project exists yet for this user.
var ErrNoProject = errors.New("no Project yet; run: self-host install <app|recipe>")

type Service struct {
	Deps    *system.Deps
	Log     *events.Logger
	Catalog *catalog.Catalog
	// PollInterval overrides how often Setup waits retry (tests use a short one).
	PollInterval time.Duration
}

func New(deps *system.Deps, log *events.Logger, cat *catalog.Catalog) *Service {
	return &Service{Deps: deps, Log: log, Catalog: cat}
}

// Owner is the user who owns the Project: the invoking user under sudo.
func (s *Service) Owner() (system.User, error) {
	current, err := s.Deps.CurrentUser()
	if err != nil {
		return system.User{}, err
	}
	name := s.Deps.Getenv("SUDO_USER")
	if current.UID != 0 || name == "" || name == "root" {
		return current, nil
	}
	owner, err := s.Deps.LookupUser(name)
	if err != nil {
		return system.User{}, fmt.Errorf("sudo user %s: %w", name, err)
	}
	if uid, err := strconv.Atoi(s.Deps.Getenv("SUDO_UID")); err == nil {
		owner.UID = uid
	}
	if gid, err := strconv.Atoi(s.Deps.Getenv("SUDO_GID")); err == nil {
		owner.GID = gid
	}
	return owner, nil
}

func (s *Service) Project() (*project.Project, error) {
	owner, err := s.Owner()
	if err != nil {
		return nil, err
	}
	return project.Open(owner), nil
}

func (s *Service) compose(p *project.Project) *compose.Compose {
	return compose.New(s.Deps, s.Log, p.Root, project.Name)
}

// Exposure values.
const (
	ExposureLAN   = "lan"
	ExposureLocal = "local"
)

func BindIP(exposure string) string {
	if exposure == ExposureLocal {
		return "127.0.0.1"
	}
	return "0.0.0.0"
}

// DetectSettings returns Host settings for a new Project.
func (s *Service) DetectSettings(owner system.User, exposure string) map[string]string {
	if exposure == "" {
		exposure = ExposureLAN
	}
	lan, err := s.Deps.LANIP()
	if err != nil || lan == "" {
		lan = "127.0.0.1"
	}
	return map[string]string{
		"TZ":             s.Deps.TimeZone(),
		"PUID":           strconv.Itoa(owner.UID),
		"PGID":           strconv.Itoa(owner.GID),
		"UMASK":          "022",
		"LAN_IP":         lan,
		"EXPOSURE":       exposure,
		"BIND_IP":        BindIP(exposure),
		"MEDIA_ROOT":     filepath.Join(owner.Home, "media"),
		"DOWNLOADS_ROOT": filepath.Join(owner.Home, "downloads"),
	}
}

// Defaults returns the Host settings a new Project would get.
func (s *Service) Defaults() (map[string]string, error) {
	owner, err := s.Owner()
	if err != nil {
		return nil, err
	}
	return s.DetectSettings(owner, ""), nil
}

// AppURL is what a person opens: LAN IP for lan exposure, loopback otherwise.
func AppURL(settings map[string]string, port int, path string) string {
	hostName := settings["LAN_IP"]
	if settings["EXPOSURE"] == ExposureLocal || hostName == "" {
		hostName = "127.0.0.1"
	}
	return fmt.Sprintf("http://%s:%d%s", hostName, port, path)
}

const passwordAlphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789"

// GeneratePassword returns a random alphanumeric secret.
func GeneratePassword(length int) string {
	b := make([]byte, length)
	for i := range b {
		n, err := rand.Int(rand.Reader, big.NewInt(int64(len(passwordAlphabet))))
		if err != nil {
			panic(err)
		}
		b[i] = passwordAlphabet[n.Int64()]
	}
	return string(b)
}

// secretStore persists every Set immediately.
type secretStore struct {
	p      *project.Project
	values map[string]string
}

func (s *secretStore) Get(key string) string { return s.values[key] }

func (s *secretStore) Set(key, value string) error {
	if err := project.ValidEnvValue(value); err != nil {
		return fmt.Errorf("secret %s: %w", key, err)
	}
	s.values[key] = value
	return s.p.SaveSecrets(s.values)
}

// SecretKey namespaces an App secret: SecretKey("sonarr", "api_key") = SONARR_API_KEY.
func SecretKey(appID, name string) string {
	return strings.ToUpper(strings.ReplaceAll(appID+"_"+name, "-", "_"))
}

// session is one locked, loaded Project.
type session struct {
	s        *Service
	p        *project.Project
	settings map[string]string
	secrets  *secretStore
	state    *project.State
	compose  *compose.Compose
}

func (s *Service) open(ctx context.Context) (*session, error) {
	p, err := s.Project()
	if err != nil {
		return nil, err
	}
	if !p.Exists() {
		return nil, ErrNoProject
	}
	settings, err := p.LoadSettings()
	if err != nil {
		return nil, err
	}
	secrets, err := p.LoadSecrets()
	if err != nil {
		return nil, err
	}
	registerSecrets(s.Log, secrets)
	state, err := p.LoadState()
	if err != nil {
		return nil, err
	}
	return &session{s: s, p: p, settings: settings, secrets: &secretStore{p: p, values: secrets}, state: state, compose: s.compose(p)}, nil
}

func (s *Service) lock(p *project.Project) (func(), error) {
	return p.Lock(s.Deps.PID, s.Deps.ProcessAlive)
}

func (ss *session) helpers(a app.App) *helpers.H {
	info := a.Info()
	st := ss.state.Apps[info.ID]
	port := info.Port
	var inputs map[string]string
	if st != nil {
		port, inputs = st.Port, st.Inputs
	}
	return helpers.New(helpers.Config{
		App:      info.ID,
		Service:  info.Service,
		Dir:      ss.p.Path("apps", info.ID),
		BaseURL:  fmt.Sprintf("http://127.0.0.1:%d", port),
		URL:      AppURL(ss.settings, port, info.Path),
		Port:     port,
		Inputs:   inputs,
		Settings: ss.settings,
		Log:      ss.s.Log,
		HTTP:     ss.s.Deps.HTTP,
		Secrets:  ss.secrets,
		Exec:     ss.compose,
		Record:   ss.recorder(info.ID),
		Peer: func(id string) *helpers.H {
			peer, found := ss.s.Catalog.App(id)
			if !found || ss.state.Apps[id] == nil {
				return nil
			}
			return ss.helpers(peer)
		},
		PollInterval: ss.s.pollInterval(),
	})
}

func (s *Service) pollInterval() time.Duration { return s.PollInterval }

func (ss *session) recorder(id string) func(helpers.StepResult) {
	return func(r helpers.StepResult) {
		st := ss.state.Apps[id]
		if st == nil {
			return
		}
		if st.Steps == nil {
			st.Steps = map[string]project.StepRecord{}
		}
		if _, seen := st.Steps[r.ID]; !seen {
			st.StepOrder = append(st.StepOrder, r.ID)
		}
		st.Steps[r.ID] = project.StepRecord{Status: r.Status, Msg: r.Msg, Error: r.Error, Hint: r.Hint}
	}
}

// fragmentServices lists the service names declared in an app fragment.
func fragmentServices(path string) ([]string, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	var doc struct {
		Services map[string]any `yaml:"services"`
	}
	if err := yaml.Unmarshal(data, &doc); err != nil {
		return nil, fmt.Errorf("%s: %w", path, err)
	}
	names := make([]string, 0, len(doc.Services))
	for name := range doc.Services {
		names = append(names, name)
	}
	sort.Strings(names)
	return names, nil
}

func (ss *session) services(ids ...string) ([]string, error) {
	var all []string
	for _, id := range ids {
		names, err := fragmentServices(ss.p.FragmentPath(id))
		if err != nil {
			return nil, err
		}
		all = append(all, names...)
	}
	return all, nil
}

// runSetup runs Setup then Check for one App and records the outcome.
func (ss *session) runSetup(ctx context.Context, a app.App) error {
	id := a.Info().ID
	st := ss.state.Apps[id]
	st.Steps, st.StepOrder = nil, nil
	h := ss.helpers(a)
	err := a.Setup(ctx, h)
	if err == nil {
		err = h.Step(ctx, "check", "verify "+a.Info().Name+" works", helpers.StepSpec{
			Do:   func(ctx context.Context) error { return a.Check(ctx, h) },
			Hint: "Open " + h.URL + " and compare with the failed step above.",
		})
	}
	if err == nil {
		err = ss.runLinks(ctx, a)
	}
	st.Setup = "ok"
	if err != nil {
		st.Setup = "incomplete"
	}
	if saveErr := ss.p.SaveState(ss.state); saveErr != nil {
		return saveErr
	}
	return err
}

// runLinks applies a's Links to installed targets, and Links of installed
// Apps that point at a.
func (ss *session) runLinks(ctx context.Context, a app.App) error {
	id := a.Info().ID
	var errs []error
	for _, link := range a.Links() {
		if to := ss.readyPeer(link.Target); to != nil {
			errs = append(errs, link.Apply(ctx, ss.helpers(a), to))
		}
	}
	for _, other := range ss.s.Catalog.Apps() {
		otherID := other.Info().ID
		if otherID == id || !ss.ready(otherID) {
			continue
		}
		for _, link := range other.Links() {
			if link.Target == id {
				errs = append(errs, link.Apply(ctx, ss.helpers(other), ss.helpers(a)))
			}
		}
	}
	return errors.Join(errs...)
}

func (ss *session) ready(id string) bool {
	st := ss.state.Apps[id]
	return st != nil && st.Setup == "ok"
}

func (ss *session) readyPeer(id string) *helpers.H {
	peer, found := ss.s.Catalog.App(id)
	if !found || !ss.ready(id) {
		return nil
	}
	return ss.helpers(peer)
}

// registerSecrets redacts every stored secret except the Admin username,
// which is not secret and too common a word ("admin") to hide.
func registerSecrets(log *events.Logger, secrets map[string]string) {
	for key, value := range secrets {
		if key != "ADMIN_USER" {
			log.Secret(value)
		}
	}
}
