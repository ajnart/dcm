// Package telemetry sends the anonymous usage and error data of ADR 0006 to
// the project's PostHog. It is on by default and silent: it never delays or
// fails a command, never sends an absolute path, host name, input, secret, App
// data or error text, and is off with SELF_HOST_NO_TELEMETRY=1, DO_NOT_TRACK=1,
// in CI and on development builds.
// Feedback is the one event carrying person-approved free text, masked by the CLI.
package telemetry

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"path"
	"reflect"
	"regexp"
	"runtime"
	"slices"
	"strconv"
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
	WikiURL   = "https://github.com/ajnart/selfhost-skills/wiki/Telemetry"

	// Notice is the sentence a plain command prints once; NoticeShort is the
	// two lines Onboarding's Welcome step shows. Neither names an off switch.
	Notice      = "Anonymous usage data helps improve self-host: no IP, no personal data. Details: " + WikiURL
	NoticeShort = "Anonymous usage data helps improve self-host: no IP, no personal data.\nDetails: " + WikiURL

	idFile     = "telemetry-id"
	noticeFile = "telemetry-notice"

	defaultDeadline  = 500 * time.Millisecond
	feedbackDeadline = 5 * time.Second
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

// Store is the Home folder: where the notice marker lives, and where an older
// install ID may still sit.
type Store interface {
	ReadHomeFile(name string) ([]byte, error)
	WriteHomeFile(name string, data []byte, mode os.FileMode) error
}

type ConfigStore interface {
	ReadConfigFile(name string) ([]byte, error)
	WriteConfigFile(name string, data []byte, mode os.FileMode) error
}

// Options say where and how a Client sends. The zero value sends nothing.
type Options struct {
	// Key defaults to ProjectKey.
	Key               string
	Version, OS, Arch string
	Getenv            func(key string) string
	Store             Store
	Config            ConfigStore
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
	Steps       []Step
	// Failure is why the command failed; only its type is ever sent.
	Failure error
	Panic   any
	Stack   Stack
}

type StepOutcome string

const (
	StepOK      StepOutcome = "ok"
	StepSkipped StepOutcome = "skipped"
	StepWarned  StepOutcome = "warned"
	StepFailed  StepOutcome = "failed"
	StepManual  StepOutcome = "manual"
)

type Step struct {
	ID       string
	Outcome  StepOutcome
	Duration time.Duration
}

// MaxFeedbackBytes is the most a Feedback message may hold.
const MaxFeedbackBytes = 4096

var ErrFeedbackTooLarge = fmt.Errorf("the message exceeds the limit of %d bytes; nothing was sent. Shorten it and run feedback again", MaxFeedbackBytes)

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

const (
	maxSteps  = 100
	maxLogs   = 20
	maxFrames = 32
)

var (
	uuidPattern = regexp.MustCompile(`^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$`)
	idPattern   = regexp.MustCompile(`^[a-z0-9][a-z0-9._-]{0,63}$`)
	typePattern = regexp.MustCompile(`^\*?[A-Za-z0-9_]+(\.[A-Za-z0-9_]+)?$`)
)

// accessChoices are the Access values that may be sent.
var accessChoices = []string{"home", "local"}

// installID is the random ID in the user config folder, made on first use.
// An ID that older versions kept in the Home folder moves there.
func (c *Client) installID() (string, bool) {
	if c.o.Config == nil {
		return "", false
	}
	if id, ok := validID(c.o.Config.ReadConfigFile(idFile)); ok {
		return id, true
	}
	if id, ok := validID(c.o.Store.ReadHomeFile(idFile)); ok {
		return id, c.o.Config.WriteConfigFile(idFile, []byte(id+"\n"), 0o600) == nil
	}
	id, err := newUUID()
	if err != nil {
		return "", false
	}
	return id, c.o.Config.WriteConfigFile(idFile, []byte(id+"\n"), 0o600) == nil
}

func validID(data []byte, err error) (string, bool) {
	id := strings.TrimSpace(string(data))
	return id, err == nil && uuidPattern.MatchString(id)
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
	}, func(id string) []logRecord { return c.logRecords(id, r) }, defaultDeadline)
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
	}, nil, feedbackDeadline)
}

type delivery struct {
	mu   sync.Mutex
	sent int
}

func (d *delivery) Success(posthog.APIMessage)        { d.mu.Lock(); d.sent++; d.mu.Unlock() }
func (d *delivery) Failure(posthog.APIMessage, error) {}

// deliver sends what build makes of the install ID, and the log records,
// and waits up to the deadline for PostHog to answer.
func (c *Client) deliver(build func(id string) []posthog.Message, logs func(id string) []logRecord, fallback time.Duration) bool {
	id, ok := c.installID()
	if !ok {
		return false
	}
	deadline := c.o.Deadline
	if deadline <= 0 {
		deadline = fallback
	}
	retries := 0
	geoIPOff := true
	taken := &delivery{}
	client, err := posthog.NewWithConfig(c.o.key(), posthog.Config{
		Endpoint:           Endpoint,
		Transport:          c.o.Transport,
		Logger:             silent{},
		MaxRetries:         &retries,
		DisableGeoIP:       &geoIPOff,
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
	finished := make(chan struct{}, 2)
	pending := 1
	go func() {
		client.CloseWithContext(ctx)
		finished <- struct{}{}
	}()
	if logs != nil {
		if records := logs(id); len(records) > 0 {
			pending++
			go func() {
				c.postLogs(ctx, records)
				finished <- struct{}{}
			}()
		}
	}
wait:
	for ; pending > 0; pending-- {
		select {
		case <-finished:
		case <-ctx.Done():
			break wait
		}
	}
	taken.mu.Lock()
	defer taken.mu.Unlock()
	return taken.sent == len(messages)
}

type logRecord struct {
	severity   int
	text, body string
	attributes [][2]string
}

func (c *Client) logRecords(id string, r Report) []logRecord {
	var records []logRecord
	command := clean(r.Command, commandWords)
	for _, step := range cleanSteps(r.Steps) {
		record := logRecord{attributes: [][2]string{
			{"posthogDistinctId", id},
			{"command", command},
			{"step", step.ID},
			{"version", c.o.Version},
			{"os", c.o.OS},
			{"arch", c.o.Arch},
		}}
		switch step.Outcome {
		case StepFailed:
			record.severity, record.text, record.body = 17, "ERROR", "step failed"
		case StepWarned:
			record.severity, record.text, record.body = 13, "WARN", "step warned"
		default:
			continue
		}
		records = append(records, record)
		if len(records) == maxLogs {
			break
		}
	}
	return records
}

func (c *Client) postLogs(ctx context.Context, records []logRecord) {
	now := strconv.FormatInt(time.Now().UnixNano(), 10)
	var out []map[string]any
	for _, r := range records {
		attributes := make([]map[string]any, 0, len(r.attributes))
		for _, a := range r.attributes {
			attributes = append(attributes, map[string]any{"key": a[0], "value": map[string]any{"stringValue": a[1]}})
		}
		out = append(out, map[string]any{
			"timeUnixNano":   now,
			"severityNumber": r.severity,
			"severityText":   r.text,
			"body":           map[string]any{"stringValue": r.body},
			"attributes":     attributes,
		})
	}
	body, err := json.Marshal(map[string]any{"resourceLogs": []any{map[string]any{
		"resource": map[string]any{"attributes": []any{
			map[string]any{"key": "service.name", "value": map[string]any{"stringValue": "self-host"}},
		}},
		"scopeLogs": []any{map[string]any{
			"scope":      map[string]any{"name": "self-host"},
			"logRecords": out,
		}},
	}}})
	if err != nil {
		return
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, Endpoint+"/i/v1/logs", bytes.NewReader(body))
	if err != nil {
		return
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+c.o.key())
	resp, err := (&http.Client{Transport: c.o.Transport}).Do(req)
	if err != nil {
		return
	}
	io.Copy(io.Discard, resp.Body)
	resp.Body.Close()
}

func (c *Client) feedbackProperties(f Feedback) posthog.Properties {
	props := posthog.Properties{
		"message": f.Message,
		"version": c.o.Version,
		"os":      c.o.OS,
		"arch":    c.o.Arch,
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
		"command":     clean(r.Command, commandWords),
		"duration_ms": r.Duration.Milliseconds(),
		"outcome":     string(r.Outcome),
		"version":     c.o.Version,
		"os":          c.o.OS,
		"arch":        c.o.Arch,
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
	if steps := cleanSteps(r.Steps); len(steps) > 0 {
		sent := make([]map[string]any, 0, len(steps))
		for _, step := range steps {
			sent = append(sent, map[string]any{"id": step.ID, "outcome": string(step.Outcome), "duration_ms": step.Duration.Milliseconds()})
		}
		props["steps"] = sent
	}
	return props
}

var stepOutcomes = []StepOutcome{StepOK, StepSkipped, StepWarned, StepFailed, StepManual}

func cleanSteps(steps []Step) []Step {
	var out []Step
	for _, step := range steps {
		if stepPattern.MatchString(step.ID) && slices.Contains(stepOutcomes, step.Outcome) {
			out = append(out, step)
			if len(out) == maxSteps {
				break
			}
		}
	}
	return out
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

// exception is the error of a failed or crashed command: its type, failed
// steps and in-app stack frames, never its text, which could carry a path, a
// host name or a secret.
func (c *Client) exception(id string, r Report, props posthog.Properties) posthog.Exception {
	steps, _ := props["failed_steps"].([]string)
	steps = slices.Sorted(slices.Values(steps))
	command := clean(r.Command, commandWords)
	frames := r.Stack.frames()
	if len(frames) == 0 {
		frames = CaptureStack(0).frames()
	}
	var typ, value, fingerprint string
	handled := r.Panic == nil
	if handled {
		typ, value = errorType(r.Failure), "command failed"
		if len(steps) > 0 {
			typ, value = "StepFailed", "failed at "+strings.Join(steps, ", ")
		}
		fingerprint = strings.Join([]string{command, typ, strings.Join(steps, ",")}, "|")
	} else {
		typ, value = valueType(r.Panic), "panic"
		top := "unknown"
		if len(frames) > 0 {
			top = frames[len(frames)-1].Function
		}
		fingerprint = strings.Join([]string{command, "panic:" + typ, top}, "|")
	}
	return posthog.Exception{
		DistinctId: id,
		Properties: props,
		ExceptionList: []posthog.ExceptionItem{{
			Type:       typ,
			Value:      value,
			Mechanism:  &posthog.ExceptionMechanism{Handled: &handled},
			Stacktrace: &posthog.ExceptionStacktrace{Type: "raw", Frames: frames},
		}},
		ExceptionFingerprint: &fingerprint,
	}
}

type Stack []uintptr

func CaptureStack(skip int) Stack {
	pcs := make([]uintptr, 64)
	return pcs[:runtime.Callers(skip+2, pcs)]
}

var (
	modulePath = strings.TrimSuffix(reflect.TypeOf(Client{}).PkgPath(), "/internal/telemetry")
	fileName   = regexp.MustCompile(`^[A-Za-z0-9_.-]+\.go$`)
	packageDir = regexp.MustCompile(`^[A-Za-z0-9_-]+(/[A-Za-z0-9_-]+)*$`)
)

func (s Stack) frames() []posthog.StackFrame {
	if len(s) == 0 {
		return nil
	}
	var innermostFirst []posthog.StackFrame
	next := runtime.CallersFrames(s)
	for {
		frame, more := next.Next()
		if function, ok := strings.CutPrefix(frame.Function, modulePath+"/"); ok {
			if dir, _, found := strings.Cut(function, "."); found {
				dir = strings.TrimSuffix(dir, "_test")
				file := path.Base(strings.ReplaceAll(frame.File, `\`, "/"))
				if packageDir.MatchString(dir) && fileName.MatchString(file) {
					innermostFirst = append(innermostFirst, posthog.StackFrame{
						Filename: dir + "/" + file,
						LineNo:   frame.Line,
						Function: function,
						InApp:    true,
						Platform: "go",
					})
				}
			}
		}
		if !more {
			break
		}
	}
	if len(innermostFirst) > maxFrames {
		innermostFirst = innermostFirst[:maxFrames]
	}
	slices.Reverse(innermostFirst)
	return innermostFirst
}

func valueType(v any) string {
	if name := fmt.Sprintf("%T", v); typePattern.MatchString(name) {
		return name
	}
	return "Error"
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
