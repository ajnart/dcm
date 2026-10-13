// Package service implements every operation on a Project. The CLI and the
// TUI both call it; neither talks to Docker or the Project files directly.
package service

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"math/big"
	"path/filepath"
	"regexp"
	"slices"
	"strconv"
	"strings"
	"time"

	"github.com/ajnart/self-host/internal/app"
	"github.com/ajnart/self-host/internal/catalog"
	"github.com/ajnart/self-host/internal/compose"
	"github.com/ajnart/self-host/internal/events"
	"github.com/ajnart/self-host/internal/helpers"
	"github.com/ajnart/self-host/internal/host"
	"github.com/ajnart/self-host/internal/project"
	stepstatus "github.com/ajnart/self-host/internal/status"
	"github.com/ajnart/self-host/internal/system"
)

// ErrIncomplete means some Setup steps failed; the hints say how to finish.
var ErrIncomplete = errors.New("setup incomplete")

var ErrManual = errors.New("setup needs manual steps")

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
	p := project.Open(owner)
	// Tests and side-by-side installs point at another folder and Compose
	// project, so they never touch ~/.self-host.
	if root := s.Deps.Getenv("SELF_HOST_HOME"); root != "" {
		if !filepath.IsAbs(root) {
			return nil, fmt.Errorf("SELF_HOST_HOME must be an absolute path, got %q", root)
		}
		p.Root = root
	}
	if name := s.Deps.Getenv("SELF_HOST_COMPOSE_PROJECT"); name != "" {
		if !composeName.MatchString(name) {
			return nil, fmt.Errorf("SELF_HOST_COMPOSE_PROJECT %q: use lowercase letters, digits, - and _", name)
		}
		p.ComposeName = name
	}
	return p, nil
}

var composeName = regexp.MustCompile(`^[a-z0-9][a-z0-9_-]*$`)

func (s *Service) compose(p *project.Project) *compose.Compose {
	return compose.New(s.Deps, s.Log, p.Root, p.ComposeName)
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
	return s.detectSettings(context.Background(), owner, exposure)
}

func (s *Service) detectSettings(ctx context.Context, owner system.User, exposure string) map[string]string {
	if exposure == "" {
		exposure = ExposureLAN
	}
	lan, err := s.Deps.LANIP()
	if err != nil || lan == "" {
		lan = "127.0.0.1"
	}
	settings := map[string]string{
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
	if rootless, err := host.Rootless(ctx, s.Deps); err == nil && rootless {
		// Container root maps to the rootless daemon's host user, who owns
		// the Project folders. Project ownership itself stays unchanged.
		settings["PUID"], settings["PGID"] = "0", "0"
	}
	return settings
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

// GenerateHex returns length random hexadecimal digits.
func GenerateHex(length int) string {
	b := make([]byte, (length+1)/2)
	if _, err := rand.Read(b); err != nil {
		panic(err)
	}
	return hex.EncodeToString(b)[:length]
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
	s                    *Service
	p                    *project.Project
	settings             map[string]string
	secrets              *secretStore
	state                *project.State
	compose              *compose.Compose
	navigationAddresses  map[string][]string
	nameFailure          bool
	navigationContainers map[string]compose.Container
	navigationError      error
	navigationWarnings   []string
	deferDashboard       bool
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
	// Older releases stored private inputs in state. Register them even for
	// read-only reports; migration itself happens only under the mutation lock.
	for id, st := range state.Apps {
		if a, found := s.Catalog.App(id); found && st != nil {
			for _, input := range a.Inputs() {
				if input.Private {
					s.Log.Secret(st.Inputs[input.Key])
				}
			}
		}
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
	inputs := map[string]string{}
	if st != nil {
		port = st.Port
		for key, value := range st.Inputs {
			inputs[key] = value
		}
	}
	for _, input := range a.Inputs() {
		if input.Private {
			inputs[input.Key] = ss.secrets.Get(SecretKey(info.ID, input.Key))
		}
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
		InstalledApps: ss.installedApps,
		PollInterval:  ss.s.pollInterval(),
		Now:           ss.s.Deps.Now,
		Sleep:         ss.s.Deps.Sleep,
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
		st.Steps[r.ID] = project.StepRecord{Status: r.Status, Msg: ss.s.Log.Redact(r.Msg), Error: ss.s.Log.Redact(r.Error), Hint: ss.s.Log.Redact(r.Hint)}
	}
}

func (ss *session) services(ids ...string) ([]string, error) {
	var all []string
	for _, id := range ids {
		names, err := ss.p.FragmentServices(id)
		if err != nil {
			return nil, err
		}
		all = append(all, names...)
	}
	return all, nil
}

// startServices is services minus those a DeferredStarter App holds back from
// Compose up until its Setup has what they need.
func (ss *session) startServices(ids ...string) ([]string, error) {
	var all []string
	for _, id := range ids {
		if id == cloudflareConnector {
			blocked, err := ss.cloudflareSuspended()
			if err != nil {
				return nil, err
			}
			if blocked {
				continue
			}
		}
		names, err := ss.services(id)
		if err != nil {
			return nil, err
		}
		if a, found := ss.s.Catalog.App(id); found {
			if deferrer, ok := a.(app.DeferredStarter); ok {
				deferred := deferrer.Deferred(ss.helpers(a))
				names = slices.DeleteFunc(names, func(name string) bool { return slices.Contains(deferred, name) })
			}
		}
		all = append(all, names...)
	}
	return all, nil
}

// up starts services. With none named, Compose would start every service of
// the Project, including those an App holds back.
func (ss *session) up(ctx context.Context, services []string) error {
	if len(services) == 0 {
		return nil
	}
	return ss.compose.Up(ctx, services...)
}

// runSetup runs an App's Setup, its Check and its own Links, then the Links
// other ready Apps declare towards it. A Link failure is recorded on the App
// that declares the Link. It returns every App whose Setup is now incomplete.
func (ss *session) runSetup(ctx context.Context, a app.App) ([]string, error) {
	installed, err := ss.p.AppIDs()
	if err != nil {
		return nil, err
	}
	id := a.Info().ID
	st := ss.state.Apps[id]
	for step := range st.Steps {
		if !IsStage(step) {
			delete(st.Steps, step)
		}
	}
	st.StepOrder = slices.DeleteFunc(st.StepOrder, func(step string) bool { return !IsStage(step) })
	h := ss.helpers(a)
	err = a.Setup(ctx, h)
	if id == tailscaleID || id == cloudflareConnector {
		ss.invalidateNavigation()
	}
	if err == nil {
		err = h.Step(ctx, "check", "verify "+a.Info().Name+" works", helpers.StepSpec{
			Do:   func(ctx context.Context) error { return a.Check(ctx, h) },
			Hint: "Open " + h.URL + " and compare with the failed step above.",
		})
	}
	ss.reportUnexpected(h, "setup", err)
	if err == nil {
		for _, link := range a.Links() {
			ss.applyLink(ctx, a, link, installed)
		}
	}
	st.Setup = setupResult(st)
	var incomplete []string
	if st.Setup == stepstatus.SetupIncomplete {
		incomplete = append(incomplete, id)
	}
	if ss.ready(id) {
		for _, other := range ss.s.Catalog.Apps() {
			otherID := other.Info().ID
			if otherID == id || !ss.ready(otherID) {
				continue
			}
			links := other.Links()
			if !slices.ContainsFunc(links, func(l app.Link) bool { return l.Target == id }) {
				continue
			}
			// A Link that failed earlier may have been waiting on this App
			// indirectly (Seerr's servers need its Jellyfin Link), so retry it.
			for _, link := range links {
				if link.Target != id && !ss.failed(otherID, link.ID) {
					continue
				}
				ss.applyLink(ctx, other, link, installed)
				otherState := ss.state.Apps[otherID]
				otherState.Setup = setupResult(otherState)
				if otherState.Setup == stepstatus.SetupIncomplete {
					incomplete = append(incomplete, otherID)
				}
			}
		}
	}
	return incomplete, ss.p.SaveState(ss.state)
}

// applyLink runs one Link of from, or reports that it waits for its target.
func (ss *session) applyLink(ctx context.Context, from app.App, link app.Link, installed []string) {
	h := ss.helpers(from)
	if !slices.Contains(installed, link.Target) {
		return
	}
	to := ss.readyPeer(link.Target)
	if to == nil {
		h.Skip(link.ID, linkWaitingMessage(link.Target))
		return
	}
	ss.reportUnexpected(h, link.ID, link.Apply(ctx, h, to))
}

func linkWaitingMessage(target string) string {
	return "waiting for " + target + " to finish Setup"
}

func omitAbsentPeerWait(owner app.App, stepID string, record project.StepRecord, installed []string) bool {
	if record.Status != stepstatus.StepSkip {
		return false
	}
	for _, link := range owner.Links() {
		if link.ID != stepID || slices.Contains(installed, link.Target) {
			continue
		}
		return record.Msg == linkWaitingMessage(link.Target) || record.Msg == "waiting for "+link.Target+" (install it, or finish its Setup)"
	}
	return false
}

// reportUnexpected records an error that did not come from a failed step,
// so it is visible and counts against the App.
func (ss *session) reportUnexpected(h *helpers.H, step string, err error) {
	if err == nil || errors.Is(err, helpers.ErrStepFailed) || errors.Is(err, helpers.ErrManual) {
		return
	}
	h.Log.Emit(events.Event{Event: events.StepFail, App: h.App, Step: step, Error: err.Error(), URL: h.URL})
	h.Record(helpers.StepResult{ID: step, Status: stepstatus.StepFail, Error: err.Error()})
}

func (ss *session) failed(id, step string) bool {
	st := ss.state.Apps[id]
	return st != nil && st.Steps[step].Status == stepstatus.StepFail
}

// setupResult gives failures precedence over manual steps. Install
// stages are Compose work that Setup cannot retry, so they do not count.
func setupResult(st *project.AppState) stepstatus.Setup {
	result := stepstatus.SetupOK
	for id, step := range st.Steps {
		if step.Status == stepstatus.StepManual && !IsStage(id) {
			result = stepstatus.SetupManual
		}
		if step.Status == stepstatus.StepFail && !IsStage(id) {
			return stepstatus.SetupIncomplete
		}
	}
	return result
}

const (
	StageRender = "render"
	StagePull   = "pull"
	StageStart  = "start"
)

// IsStage reports whether a step is an install stage (render, pull, start)
// recorded by the mutation module rather than by the App's Setup.
func IsStage(id string) bool {
	return id == StageRender || id == StagePull || id == StageStart
}

// isLinkStep reports whether a step belongs to a Link rather than to the
// App's own Setup.
func isLinkStep(id string) bool {
	return strings.HasPrefix(id, "link-") || strings.HasPrefix(id, "unlink-")
}

// ready reports whether an App's own Setup has no failed or manual steps, so
// Links may use it. Failed Links do not count: they belong to their App and
// must not block or hide other Links.
func (ss *session) ready(id string) bool {
	st := ss.state.Apps[id]
	if st == nil || st.Setup == stepstatus.SetupPending || st.Setup == "" {
		return false
	}
	for stepID, step := range st.Steps {
		if step.Status.NeedsAttention() && !isLinkStep(stepID) && !IsStage(stepID) {
			return false
		}
	}
	return true
}

func (ss *session) readyPeer(id string) *helpers.H {
	peer, found := ss.s.Catalog.App(id)
	if !found || !ss.ready(id) {
		return nil
	}
	return ss.helpers(peer)
}

// registerSecrets redacts stored secrets while keeping the shared username
// and Forgejo's administrator alias visible in recovery hints.
func registerSecrets(log *events.Logger, secrets map[string]string) {
	for key, value := range secrets {
		if key != "ADMIN_USER" && key != "FORGEJO_ADMIN_USER" {
			log.Secret(value)
		}
	}
}
