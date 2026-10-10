package service

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/mail"
	"os"
	"regexp"
	"slices"
	"strings"
	"time"

	"github.com/ajnart/self-host/internal/app"
	"github.com/ajnart/self-host/internal/cloudflare"
	"github.com/ajnart/self-host/internal/events"
	"github.com/ajnart/self-host/internal/project"
)

const (
	cloudflareConnector  = "cloudflare-tunnel"
	cloudflareRecordFile = "cloudflare.json"
	// CloudflareAccess is the id of this option in status `access`.
	CloudflareAccess = "cloudflare"
	// cloudflareTokenInput is the private input that carries the API token.
	cloudflareTokenInput = "cloudflare.api_token"
)

// ErrPublicNotAccepted means the person has not given the separate yes that
// putting Apps on the internet needs.
var ErrPublicNotAccepted = errors.New("publishing needs a separate explicit yes")

// privateCategories stay private unless the person names the App and says so:
// what each one holds, in plain words.
var privateCategories = map[string]string{
	"Containers":    "it can control everything on this computer",
	"Databases":     "it is not a web page",
	"Downloads":     "its admin page often has a weak login or none",
	"Identity":      "it holds everyone's logins",
	"DNS":           "it controls the names of your whole network",
	"Ingress":       "it is the front door of your other Apps",
	"Remote access": "it is another way into your network",
	"Backups":       "it holds every password and key",
	"Monitoring":    "it shows what runs on this computer",
	"Observability": "it shows what runs on this computer",
	"Cameras":       "it shows live video of your home",
	"Storage":       "it holds raw files",
	"Passwords":     "it holds your passwords, the most valuable target you have",
}

const mediaWarning = "Cloudflare's terms restrict serving video through its free network, and the phone and TV apps for this App cannot get past the login page. " +
	"Tailscale (From anywhere, privately) is the better way to watch away from home."

func CloudflarePublicationWarning(info app.Info) (string, bool) {
	if why, private := privateCategories[info.Category]; private {
		return fmt.Sprintf("%s is a %s App: %s. Publishing it lets strangers reach its login page; a flaw could let them in.", info.Name, info.Category, why), true
	}
	if info.Category == "Media" {
		return mediaWarning, false
	}
	return "", false
}

// CloudflareOptions is what the person gives: the domain, who may sign in and
// the Apps they chose one by one.
type CloudflareOptions struct {
	// Domain is the main domain, already active on Cloudflare (example.com).
	Domain string
	Emails []string
	// Apps are the Apps to publish: the full list, not additions.
	Apps []string
	// Allow names Apps from a private category the person still wants public.
	Allow []string
	// APITokenFile is an owner-only file with the API token, or "-" for stdin.
	// APIToken carries it from memory. It is never stored.
	APITokenFile string
	APIToken     string
	// AcceptPublic is the separate yes that names the risk.
	AcceptPublic bool
}

// CloudflareApp is one App at one web address.
type CloudflareApp struct {
	App     string `json:"app"`
	Name    string `json:"name"`
	Address string `json:"address"`
	// Warning is set for an App that needs to be told about.
	Warning string `json:"warning,omitempty"`
}

// CloudflareRefusal is an App that stays private, and why.
type CloudflareRefusal struct {
	App    string `json:"app"`
	Reason string `json:"reason"`
}

// CloudflarePlan says, before anything happens, what would be published.
type CloudflarePlan struct {
	Domain  string              `json:"domain"`
	Emails  []string            `json:"emails"`
	Publish []CloudflareApp     `json:"publish"`
	Refused []CloudflareRefusal `json:"refused,omitempty"`
	// Dropped are names published before that this plan takes off the internet.
	Dropped []string `json:"dropped,omitempty"`
	// Risk is the sentence the separate yes is asked for.
	Risk string `json:"risk"`
	// TokenScopes are the permissions the API token needs.
	TokenScopes []string `json:"token_scopes"`

	hosts []cloudflare.Host
}

// CloudflareResult says what is published after a run.
type CloudflareResult struct {
	Published []CloudflareApp `json:"published"`
	// Failed names were not left on the internet: their DNS record was deleted.
	Failed []cloudflare.Failure `json:"failed,omitempty"`
}

// cloudflareRecord is what self-host remembers of what it published. It holds
// no secret: the API token is never stored and the run token lives in
// secrets.env.
type cloudflareRecord struct {
	Version      int      `json:"version"`
	Domain       string   `json:"domain"`
	Emails       []string `json:"emails"`
	RemovalNames []string `json:"removal_names,omitempty"`
	Hosts        []struct {
		App  string `json:"app"`
		Name string `json:"name"`
	} `json:"hosts"`
}

func (r cloudflareRecord) names() []string {
	out := make([]string, len(r.Hosts))
	for i, h := range r.Hosts {
		out[i] = h.Name
	}
	for _, name := range r.RemovalNames {
		if !slices.Contains(out, name) {
			out = append(out, name)
		}
	}
	return out
}

func loadCloudflareRecord(p *project.Project) (cloudflareRecord, bool, error) {
	data, err := p.ReadHomeFile(cloudflareRecordFile)
	if errors.Is(err, os.ErrNotExist) {
		return cloudflareRecord{}, false, nil
	}
	if err != nil {
		return cloudflareRecord{}, false, err
	}
	var rec cloudflareRecord
	if err := json.Unmarshal(data, &rec); err != nil {
		return cloudflareRecord{}, false, fmt.Errorf("%s: %w", cloudflareRecordFile, err)
	}
	return rec, len(rec.Hosts) > 0 || len(rec.RemovalNames) > 0, nil
}

// cloudflareAddresses are the web addresses an App has through Cloudflare.
func (ss *session) cloudflareAddresses(id string) []string {
	rec, found, err := loadCloudflareRecord(ss.p)
	if err != nil || !found {
		return nil
	}
	var out []string
	for _, h := range rec.Hosts {
		if h.App != id {
			continue
		}
		path := ""
		if a, ok := ss.s.Catalog.App(id); ok {
			path = a.Info().Path
		}
		out = append(out, "https://"+h.Name+path)
	}
	return out
}

// cloudflareNames derives what self-host calls its own things on Cloudflare.
func cloudflareNames(p *project.Project) (tunnel, policy, comment string) {
	tunnel = "self-host"
	if p.ComposeName != project.Name {
		tunnel += "-" + p.ComposeName
	}
	return tunnel, "self-host: allowed people (" + p.ComposeName + ")", "managed by self-host project=" + p.ComposeName
}

var domainName = regexp.MustCompile(`^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$`)

func cleanDomain(domain string) (string, error) {
	d := strings.TrimSuffix(strings.ToLower(strings.TrimSpace(domain)), ".")
	if !domainName.MatchString(d) {
		return "", fmt.Errorf("%q is not a domain name; give your main domain on its own, like example.com", domain)
	}
	return d, nil
}

func cleanEmails(emails []string) ([]string, error) {
	var out []string
	for _, e := range emails {
		for _, one := range strings.Split(e, ",") {
			one = strings.TrimSpace(one)
			if one == "" {
				continue
			}
			addr, err := mail.ParseAddress(one)
			if err != nil || addr.Address != one || !strings.Contains(one[strings.Index(one, "@"):], ".") {
				return nil, fmt.Errorf("%q is not an email address; a mistyped one would fail silently at the login page", one)
			}
			one = strings.ToLower(one)
			if !slices.Contains(out, one) {
				out = append(out, one)
			}
		}
	}
	if len(out) == 0 {
		return nil, errors.New("name at least one email address that may sign in (--email)")
	}
	return out, nil
}

// CloudflarePlan checks the choices against the Project and says what would
// be published. It reads nothing from Cloudflare and changes nothing.
func (s *Service) CloudflarePlan(ctx context.Context, opts CloudflareOptions) (CloudflarePlan, error) {
	var plan CloudflarePlan
	domain, err := cleanDomain(opts.Domain)
	if err != nil {
		return plan, err
	}
	emails, err := cleanEmails(opts.Emails)
	if err != nil {
		return plan, err
	}
	if len(opts.Apps) == 0 {
		return plan, errors.New("choose the Apps to publish, one by one (--app); nothing is published by default")
	}
	ss, err := s.open(ctx)
	if err != nil {
		return plan, err
	}
	rec, published, err := loadCloudflareRecord(ss.p)
	if err != nil {
		return plan, err
	}
	if published && rec.Domain != domain {
		return plan, fmt.Errorf("your Apps are already published under %s; remove that first with: self-host cloudflare remove", rec.Domain)
	}
	plan = CloudflarePlan{Domain: domain, Emails: emails, TokenScopes: cloudflare.Scopes}
	var chosen []string
	for _, id := range opts.Apps {
		if slices.Contains(chosen, id) {
			continue
		}
		chosen = append(chosen, id)
		a, found := s.Catalog.App(id)
		if !found || ss.state.Apps[id] == nil {
			return plan, fmt.Errorf("%s is not installed; install it first (see: self-host status)", id)
		}
		info := a.Info()
		if info.NoWebUI || info.ContainerPort <= 0 {
			plan.Refused = append(plan.Refused, CloudflareRefusal{App: id, Reason: info.Name + " has no web page, so it cannot be published"})
			continue
		}
		warning := ""
		if why, private := privateCategories[info.Category]; private {
			if !slices.Contains(opts.Allow, id) {
				plan.Refused = append(plan.Refused, CloudflareRefusal{App: id, Reason: fmt.Sprintf("%s stays private: %s. To publish it anyway, name it with --allow-private %s", info.Name, why, id)})
				continue
			}
			warning = fmt.Sprintf("%s is a %s App: %s. You chose to publish it anyway.", info.Name, info.Category, why)
		}
		if info.Category == "Media" {
			warning = mediaWarning
		}
		name := id + "." + domain
		plan.Publish = append(plan.Publish, CloudflareApp{App: id, Name: name, Address: "https://" + name + info.Path, Warning: warning})
		plan.hosts = append(plan.hosts, cloudflare.Host{App: id, Name: name, Origin: fmt.Sprintf("http://%s:%d", info.Service, info.ContainerPort)})
	}
	for _, name := range rec.names() {
		if !slices.ContainsFunc(plan.Publish, func(a CloudflareApp) bool { return a.Name == name }) {
			plan.Dropped = append(plan.Dropped, name)
		}
	}
	plan.Risk = cloudflareRisk(plan)
	return plan, nil
}

func cloudflareRisk(plan CloudflarePlan) string {
	var addresses []string
	for _, a := range plan.Publish {
		addresses = append(addresses, a.Address)
	}
	return "This puts " + strings.Join(addresses, ", ") + " on the internet. Anyone in the world can reach the login page and try to get in; " +
		"only " + strings.Join(plan.Emails, ", ") + " get past it, with a code sent to their email. If the login page or an App has a flaw, " +
		"strangers could get in, and everything that passes through is visible to Cloudflare."
}

// CloudflarePublish puts the chosen Apps at their own web addresses behind a
// login page, then checks every address from this computer.
func (s *Service) CloudflarePublish(ctx context.Context, opts CloudflareOptions) (CloudflareResult, error) {
	var result CloudflareResult
	plan, err := s.CloudflarePlan(ctx, opts)
	if err != nil {
		return result, err
	}
	if len(plan.Publish) == 0 {
		return result, errors.New("nothing can be published: " + refusals(plan))
	}
	if !opts.AcceptPublic {
		return result, fmt.Errorf("%w. %s Ask the person for a yes, then pass --accept-public", ErrPublicNotAccepted, plan.Risk)
	}
	if _, found := s.Catalog.App(cloudflareConnector); !found {
		return result, errors.New("the Cloudflare Tunnel App is not in this catalog")
	}
	token, err := s.cloudflareToken(opts)
	if err != nil {
		return result, err
	}
	p, err := s.Project()
	if err != nil {
		return result, err
	}
	tunnel, policy, comment := cloudflareNames(p)
	s.Log.Emit(events.Event{Event: events.RunStart, Msg: "publish at your own web address"})
	for _, a := range plan.Publish {
		if a.Warning != "" {
			s.Log.Emit(events.Event{Event: events.StepWarn, App: a.App, Step: "publish", Msg: a.Warning})
		}
	}
	for _, r := range plan.Refused {
		s.Log.Emit(events.Event{Event: events.StepSkip, App: r.App, Step: "publish", Msg: r.Reason})
	}
	res, err := cloudflare.Publish(ctx, s.cloudflareClient(token), cloudflare.Spec{
		Domain: plan.Domain, TunnelName: tunnel, PolicyName: policy, Comment: comment,
		Emails: plan.Emails, Hosts: plan.hosts, Dropped: plan.Dropped,
	}, cloudflare.Hooks{
		Prepare:        func(ctx context.Context) error { return s.saveCloudflareRecord(ctx, plan, nil) },
		Progress:       func(msg string) { s.Log.Emit(events.Event{Event: events.Info, Msg: msg}) },
		StartConnector: s.startCloudflareConnector,
		StopConnector:  s.stopCloudflareConnector,
		Probe:          s.probeLoginPage,
	})
	if err != nil {
		return result, s.endCloudflareRun(err)
	}
	for _, a := range plan.Publish {
		if slices.Contains(res.Verified, a.Name) {
			result.Published = append(result.Published, a)
			s.Log.Emit(events.Event{Event: events.StepOK, App: a.App, Step: "publish", Msg: a.Address + " asks for a login", URL: a.Address})
		}
	}
	result.Failed = res.Failed
	for _, f := range res.Failed {
		s.Log.Emit(events.Event{Event: events.StepFail, App: strings.SplitN(f.Name, ".", 2)[0], Step: "publish", Error: f.Name + ": " + f.Reason,
			Hint: "Its DNS record was deleted again, so it is not on the internet. Check the Cloudflare Zero Trust dashboard, then run the command again."})
	}
	if err := s.saveCloudflareRecord(ctx, plan, result.Published); err != nil {
		return result, s.endCloudflareRun(err)
	}
	if len(res.Failed) > 0 {
		return result, s.endCloudflareRun(fmt.Errorf("%w: %d of %d addresses did not show the login page and were taken back off the internet",
			ErrIncomplete, len(res.Failed), len(plan.Publish)))
	}
	return result, s.endCloudflareRun(nil)
}

func refusals(plan CloudflarePlan) string {
	var out []string
	for _, r := range plan.Refused {
		out = append(out, r.Reason)
	}
	return strings.Join(out, "; ")
}

func (s *Service) endCloudflareRun(err error) error {
	if err == nil {
		s.Log.Emit(events.Event{Event: events.RunEnd, Msg: "done"})
		return nil
	}
	if errors.Is(err, ErrIncomplete) {
		s.Log.Emit(events.Event{Event: events.RunEnd, Msg: err.Error()})
	}
	return s.Log.RedactError(err)
}

func (s *Service) cloudflareClient(token string) *cloudflare.Client {
	return &cloudflare.Client{Token: token, HTTP: s.Deps.HTTP}
}

// cloudflareToken reads the API token for this one run, never keeping it.
func (s *Service) cloudflareToken(opts CloudflareOptions) (string, error) {
	value := opts.APIToken
	if value == "" {
		file := opts.APITokenFile
		if file == "" {
			return "", fmt.Errorf("give the Cloudflare API token privately: --set-file %s=PATH to an owner-only file, or =- to read it from stdin", cloudflareTokenInput)
		}
		if file == "-" {
			if s.Deps.In == nil {
				return "", errors.New("the Cloudflare API token: stdin is not available")
			}
			data, err := io.ReadAll(io.LimitReader(s.Deps.In, maxPrivateInputBytes+1))
			if err != nil || len(data) > maxPrivateInputBytes {
				return "", errors.New("the Cloudflare API token: cannot read stdin (maximum 64 KiB)")
			}
			value = strings.TrimRight(string(data), "\r\n")
		} else {
			owner, err := s.Owner()
			if err != nil {
				return "", err
			}
			if value, err = readPrivateInput(file, owner.UID); err != nil {
				return "", fmt.Errorf("the Cloudflare API token: %w", err)
			}
		}
	}
	s.Log.Secret(value)
	if err := validPrivateValue(value); err != nil {
		return "", fmt.Errorf("the Cloudflare API token: %w", err)
	}
	if value == "" {
		return "", errors.New("the Cloudflare API token is empty")
	}
	return value, nil
}

// startCloudflareConnector installs the connector with the tunnel's run token,
// which travels in memory to the Project's secret store and nowhere else.
func (s *Service) startCloudflareConnector(ctx context.Context, runToken string) error {
	s.Log.Secret(runToken)
	return s.Install(ctx, InstallOptions{
		Targets:       []string{cloudflareConnector},
		PrivateInputs: map[string]map[string]string{cloudflareConnector: {"token": runToken}},
	})
}

const (
	probeAttempts = 5
	probeWait     = 3 * time.Second
)

// probeLoginPage asks for a name from this computer with no cookies and does
// not follow redirects, retrying while the name is still spreading.
func (s *Service) probeLoginPage(ctx context.Context, name string) (cloudflare.Probe, error) {
	client := http.Client{Timeout: 10 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	if s.Deps.HTTP != nil {
		client.Transport = s.Deps.HTTP.Transport
	}
	var last cloudflare.Probe
	var lastErr error
	for attempt := 0; attempt < probeAttempts; attempt++ {
		if attempt > 0 {
			if err := s.Deps.Sleep(ctx, probeWait); err != nil {
				return last, err
			}
		}
		req, err := http.NewRequestWithContext(ctx, http.MethodGet, "https://"+name+"/", nil)
		if err != nil {
			return last, err
		}
		req.Header.Set("User-Agent", "self-host")
		resp, err := client.Do(req)
		if err != nil {
			lastErr = err
			continue
		}
		resp.Body.Close()
		last, lastErr = cloudflare.Probe{Status: resp.StatusCode, Location: resp.Header.Get("Location")}, nil
		if resp.StatusCode == http.StatusFound {
			break
		}
	}
	return last, lastErr
}

func (s *Service) saveCloudflareRecord(ctx context.Context, plan CloudflarePlan, published []CloudflareApp) error {
	p, err := s.Project()
	if err != nil {
		return err
	}
	unlock, err := p.LockContext(ctx, s.Deps.PID, s.Deps.ProcessAlive)
	if err != nil {
		return err
	}
	defer unlock()
	if len(plan.Publish) == 0 && len(plan.Dropped) == 0 {
		if err := os.Remove(p.Path(cloudflareRecordFile)); err != nil && !errors.Is(err, os.ErrNotExist) {
			return err
		}
		return nil
	}
	rec := cloudflareRecord{Version: 1, Domain: plan.Domain, Emails: plan.Emails}
	for _, a := range plan.Publish {
		rec.RemovalNames = append(rec.RemovalNames, a.Name)
	}
	rec.RemovalNames = append(rec.RemovalNames, plan.Dropped...)
	for _, a := range published {
		rec.Hosts = append(rec.Hosts, struct {
			App  string `json:"app"`
			Name string `json:"name"`
		}{a.App, a.Name})
	}
	data, err := json.MarshalIndent(rec, "", "  ")
	if err != nil {
		return err
	}
	return p.WriteHomeFile(cloudflareRecordFile, append(data, '\n'), 0o644)
}

// CloudflareRemove takes everything self-host published through Cloudflare
// back down, in reverse order. The one-time PIN login and the Zero Trust
// organization are shared with other things and stay.
func (s *Service) CloudflareRemove(ctx context.Context, opts CloudflareOptions) error {
	ss, err := s.open(ctx)
	if err != nil {
		return err
	}
	rec, published, err := loadCloudflareRecord(ss.p)
	if err != nil {
		return err
	}
	if !published {
		return errors.New("nothing is published through Cloudflare, so there is nothing to remove")
	}
	token, err := s.cloudflareToken(opts)
	if err != nil {
		return err
	}
	tunnel, policy, comment := cloudflareNames(ss.p)
	s.Log.Emit(events.Event{Event: events.RunStart, Msg: "remove your own web addresses"})
	err = cloudflare.Remove(ctx, s.cloudflareClient(token), cloudflare.RemoveSpec{
		Domain: rec.Domain, TunnelName: tunnel, PolicyName: policy, Comment: comment, Names: rec.names(),
	}, cloudflare.RemoveHooks{
		Progress:      func(msg string) { s.Log.Emit(events.Event{Event: events.Info, Msg: msg}) },
		StopConnector: s.stopCloudflareConnector,
	})
	if err != nil {
		return s.endCloudflareRun(err)
	}
	if err := s.saveCloudflareRecord(ctx, CloudflarePlan{}, nil); err != nil {
		return s.endCloudflareRun(err)
	}
	return s.endCloudflareRun(nil)
}

// stopCloudflareConnector removes the connector and forgets its run token,
// which is dead once the tunnel is deleted.
func (s *Service) stopCloudflareConnector(ctx context.Context) error {
	ss, err := s.open(ctx)
	if err != nil {
		return err
	}
	if ss.state.Apps[cloudflareConnector] != nil {
		if err := s.Remove(ctx, []string{cloudflareConnector}, false); err != nil {
			return err
		}
	}
	p, err := s.Project()
	if err != nil {
		return err
	}
	unlock, err := p.LockContext(ctx, s.Deps.PID, s.Deps.ProcessAlive)
	if err != nil {
		return err
	}
	defer unlock()
	secrets, err := p.LoadSecrets()
	if err != nil {
		return err
	}
	key := SecretKey(cloudflareConnector, "token")
	if _, found := secrets[key]; !found {
		return nil
	}
	delete(secrets, key)
	return p.SaveSecrets(secrets)
}
