// Package telemetry sends the anonymous usage and error data of ADR 0006 to
// the project's PostHog. It is on by default and silent: it never delays or
// fails a command, never sends a path, host name, input, secret, App data or
// error text, and is off with SELF_HOST_NO_TELEMETRY=1, DO_NOT_TRACK=1, in CI
// and on development builds.
package telemetry

import (
	"context"
	"crypto/rand"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"regexp"
	"slices"
	"strings"
	"sync"
	"time"

	"github.com/posthog/posthog-go"

	"github.com/ajnart/self-host/internal/release"
)

const (
	// Endpoint is the project's PostHog, behind its own domain.
	Endpoint = "https://hog.ajnart.dev"
	// NoKey is the development placeholder for ProjectKey: no key, send nothing.
	NoKey = "development"
	// EnvOptOut turns Telemetry off when it is 1, like DO_NOT_TRACK.
	EnvOptOut = "SELF_HOST_NO_TELEMETRY"

	// Notice is the sentence a plain command prints once; NoticeShort is the
	// one line Onboarding's Welcome step shows.
	Notice      = "self-host sends anonymous usage data, never paths or secrets. Turn it off with SELF_HOST_NO_TELEMETRY=1 (details in the README)."
	NoticeShort = "Anonymous usage and error data is sent. Turn off: SELF_HOST_NO_TELEMETRY=1"

	idFile     = "telemetry-id"
	noticeFile = "telemetry-notice"

	defaultDeadline = 500 * time.Millisecond
)

// ProjectKey is the public PostHog project key, set at build time with
// -ldflags "-X github.com/ajnart/self-host/internal/telemetry.ProjectKey=…".
var ProjectKey = NoKey

// Outcome is how a command ended.
type Outcome string

const (
	OutcomeOK         Outcome = "ok"
	OutcomeFailed     Outcome = "failed"
	OutcomeIncomplete Outcome = "incomplete"
	OutcomeManual     Outcome = "manual"
)

// Store is the Home folder: where the install ID and the notice marker live.
type Store interface {
	ReadHomeFile(name string) ([]byte, error)
	WriteHomeFile(name string, data []byte, mode os.FileMode) error
}

// Options say where and how a Client sends. The zero value sends nothing.
type Options struct {
	// Key defaults to ProjectKey.
	Key               string
	Version, OS, Arch string
	Getenv            func(key string) string
	Store             Store
	Transport         http.RoundTripper
	// Deadline is all the time a command waits for the send; the rest is dropped.
	Deadline time.Duration
}

// Report is one finished command.
type Report struct {
	// Command is the subcommand path, such as "install" or "backup create".
	Command  string
	Duration time.Duration
	Outcome  Outcome
	// Apps and Recipes are catalog IDs the command named, Access the choice made.
	Apps, Recipes []string
	Access        string
	// FailedSteps are "app/step" IDs of steps that failed.
	FailedSteps []string
	// Failure is why the command failed; only its type is ever sent.
	Failure error
}

// MaxFeedbackBytes is the most a Feedback message may hold.
const MaxFeedbackBytes = 4096

// Feedback is a report written on purpose by an agent, already masked and
// approved by the person.
type Feedback struct {
	Message string
	// App is the catalog ID the Feedback is about; Summary is the short
	// Debug report summary of that App. Both are optional.
	App, Summary string
}

// Client sends Reports.
type Client struct{ o Options }

func New(o Options) *Client { return &Client{o} }

func (o Options) key() string {
	if o.Key != "" {
		return o.Key
	}
	return ProjectKey
}

func (o Options) off() bool {
	if o.Store == nil || o.Getenv == nil {
		return true
	}
	if key := o.key(); key == "" || key == NoKey {
		return true
	}
	if !release.IsRelease(o.Version) {
		return true
	}
	return o.Getenv("CI") != "" || o.Getenv(EnvOptOut) == "1" || o.Getenv("DO_NOT_TRACK") == "1"
}

// Enabled is false whenever any off switch applies.
func (c *Client) Enabled() bool { return !c.o.off() }

// Announce reports whether the notice is due now, and records that it was
// shown: true once per Home folder while Telemetry is on. Nothing is sent
// before the notice was announced.
func (c *Client) Announce() bool {
	if !c.Enabled() || c.announced() {
		return false
	}
	return c.o.Store.WriteHomeFile(noticeFile, []byte("shown\n"), 0o644) == nil
}

func (c *Client) announced() bool {
	_, err := c.o.Store.ReadHomeFile(noticeFile)
	return err == nil
}

var (
	uuidPattern = regexp.MustCompile(`^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$`)
	idPattern   = regexp.MustCompile(`^[a-z0-9][a-z0-9._-]{0,63}$`)
	typePattern = regexp.MustCompile(`^\*?[A-Za-z0-9_]+(\.[A-Za-z0-9_]+)?$`)
)

// accessChoices are the Access values that may be sent.
var accessChoices = []string{"lan", "local"}

// installID is the random ID in the Home folder, made on first use.
func (c *Client) installID() (string, bool) {
	if data, err := c.o.Store.ReadHomeFile(idFile); err == nil {
		if id := strings.TrimSpace(string(data)); uuidPattern.MatchString(id) {
			return id, true
		}
	}
	id, err := newUUID()
	if err != nil {
		return "", false
	}
	return id, c.o.Store.WriteHomeFile(idFile, []byte(id+"\n"), 0o644) == nil
}

func newUUID() (string, error) {
	var b [16]byte
	if _, err := io.ReadFull(rand.Reader, b[:]); err != nil {
		return "", err
	}
	b[6] = b[6]&0x0f | 0x40
	b[8] = b[8]&0x3f | 0x80
	return fmt.Sprintf("%x-%x-%x-%x-%x", b[0:4], b[4:6], b[6:8], b[8:10], b[10:]), nil
}

type silent struct{}

func (silent) Debugf(string, ...any) {}
func (silent) Logf(string, ...any)   {}
func (silent) Warnf(string, ...any)  {}
func (silent) Errorf(string, ...any) {}

// Send reports one finished command. It returns within the deadline whatever
// the network does; what is not sent by then is dropped.
func (c *Client) Send(r Report) {
	if !c.Enabled() || !c.announced() {
		return
	}
	c.deliver(func(id string) []posthog.Message {
		props := c.properties(r)
		messages := []posthog.Message{posthog.Capture{DistinctId: id, Event: "command", Properties: props}}
		if r.Outcome == OutcomeFailed || r.Outcome == OutcomeIncomplete {
			messages = append(messages, c.exception(id, r, props))
		}
		return messages
	})
}

// SendFeedback sends one Feedback as a "feedback" event, with the same install
// ID, anonymity and endpoint as every other event, and reports whether
// PostHog took it before the deadline. The person has just seen and agreed to
// exactly this text, so it does not wait for the notice; every off switch
// still applies.
func (c *Client) SendFeedback(f Feedback) bool {
	if !c.Enabled() {
		return false
	}
	return c.deliver(func(id string) []posthog.Message {
		return []posthog.Message{posthog.Capture{DistinctId: id, Event: "feedback", Properties: c.feedbackProperties(f)}}
	})
}

type delivery struct {
	mu   sync.Mutex
	sent int
}

func (d *delivery) Success(posthog.APIMessage)        { d.mu.Lock(); d.sent++; d.mu.Unlock() }
func (d *delivery) Failure(posthog.APIMessage, error) {}

// deliver sends what build makes of the install ID and waits up to the
// deadline for PostHog to answer.
func (c *Client) deliver(build func(id string) []posthog.Message) bool {
	id, ok := c.installID()
	if !ok {
		return false
	}
	deadline := c.o.Deadline
	if deadline <= 0 {
		deadline = defaultDeadline
	}
	retries := 0
	taken := &delivery{}
	client, err := posthog.NewWithConfig(c.o.key(), posthog.Config{
		Endpoint:           Endpoint,
		Transport:          c.o.Transport,
		Logger:             silent{},
		MaxRetries:         &retries,
		BatchUploadTimeout: deadline,
		Callback:           taken,
	})
	if err != nil {
		return false
	}
	messages := build(id)
	for _, m := range messages {
		client.Enqueue(m)
	}
	ctx, cancel := context.WithTimeout(context.Background(), deadline)
	defer cancel()
	done := make(chan struct{})
	go func() {
		client.CloseWithContext(ctx)
		close(done)
	}()
	select {
	case <-done:
	case <-ctx.Done():
	}
	taken.mu.Lock()
	defer taken.mu.Unlock()
	return taken.sent == len(messages)
}

func (c *Client) feedbackProperties(f Feedback) posthog.Properties {
	props := posthog.Properties{
		"$process_person_profile": false,
		"message":                 f.Message,
		"version":                 c.o.Version,
		"os":                      c.o.OS,
		"arch":                    c.o.Arch,
	}
	if idPattern.MatchString(f.App) {
		props["app"] = f.App
	}
	if f.Summary != "" {
		props["summary"] = f.Summary
	}
	return props
}

func (c *Client) properties(r Report) posthog.Properties {
	props := posthog.Properties{
		"$process_person_profile": false,
		"command":                 clean(r.Command, commandWords),
		"duration_ms":             r.Duration.Milliseconds(),
		"outcome":                 string(r.Outcome),
		"version":                 c.o.Version,
		"os":                      c.o.OS,
		"arch":                    c.o.Arch,
	}
	if apps := cleanIDs(r.Apps, idPattern); len(apps) > 0 {
		props["apps"] = apps
	}
	if recipes := cleanIDs(r.Recipes, idPattern); len(recipes) > 0 {
		props["recipes"] = recipes
	}
	if slices.Contains(accessChoices, r.Access) {
		props["access"] = r.Access
	}
	if steps := cleanIDs(r.FailedSteps, stepPattern); len(steps) > 0 {
		props["failed_steps"] = steps
	}
	return props
}

var (
	commandWords = regexp.MustCompile(`^[a-z0-9][a-z0-9 -]{0,63}$`)
	stepPattern  = regexp.MustCompile(`^[a-z0-9][a-z0-9._-]{0,63}(/[a-z0-9][a-z0-9._:-]{0,63})?$`)
)

func clean(s string, pattern *regexp.Regexp) string {
	if pattern.MatchString(s) {
		return s
	}
	return "unknown"
}

func cleanIDs(ids []string, pattern *regexp.Regexp) []string {
	var out []string
	for _, id := range ids {
		if pattern.MatchString(id) {
			out = append(out, id)
		}
	}
	return out
}

// exception is the error of a failed command: its type and failed steps,
// never its text, which could carry a path, a host name or a secret.
func (c *Client) exception(id string, r Report, props posthog.Properties) posthog.Exception {
	typ := errorType(r.Failure)
	steps, _ := props["failed_steps"].([]string)
	steps = slices.Sorted(slices.Values(steps))
	value := "command failed"
	if len(steps) > 0 {
		typ, value = "StepFailed", "failed at "+strings.Join(steps, ", ")
	}
	fingerprint := strings.Join([]string{clean(r.Command, commandWords), typ, strings.Join(steps, ",")}, "|")
	handled := true
	return posthog.Exception{
		DistinctId: id,
		Properties: props,
		ExceptionList: []posthog.ExceptionItem{{
			Type:      typ,
			Value:     value,
			Mechanism: &posthog.ExceptionMechanism{Handled: &handled},
		}},
		ExceptionFingerprint: &fingerprint,
	}
}

// errorType names the innermost error's Go type, such as "*fs.PathError".
func errorType(err error) string {
	if err == nil {
		return "Error"
	}
	for {
		next := errors.Unwrap(err)
		if next == nil {
			break
		}
		err = next
	}
	if name := fmt.Sprintf("%T", err); typePattern.MatchString(name) {
		return name
	}
	return "Error"
}
