package activity

import (
	"cmp"
	"fmt"
	"slices"
	"strings"

	"github.com/ajnart/self-host/internal/events"
	"github.com/ajnart/self-host/internal/service"
)

// Action is the running or most recent Action: the events since the last
// run.start, or every event when there is none. Its pull is Snapshot.Pull.
type Action struct {
	Title string
	// Stages are the stages the Action reached, in the order pull, start,
	// Setup, credentials, Links, check.
	Stages []Stage
	// Apps are the Apps the Action touched, in first-seen order.
	Apps      []ActionApp
	Links     []Link
	Counts    ActionCounts
	Narrative string
	Running   bool
	Finished  bool
	// Error is the Action's own failure, from run.end.
	Error string
}

// Empty reports that there is no Action to show.
func (a Action) Empty() bool {
	return !a.Running && !a.Finished && len(a.Stages) == 0 && len(a.Apps) == 0
}

// ActionCounts are the counters next to the box titles.
type ActionCounts struct {
	AppsSetUp, AppsTotal      int
	LinksApplied, LinksTotal  int
	ImagesPulled, ImagesTotal int
}

type Stage struct {
	Name  string
	State State
}

// ActionApp is one App of the Action with the Setup, credential and check
// steps it ran, in run order. State is Running while it is the App being set
// up, and Done once its container started or its check passed; Ready is set
// once its check passed or the Action finished with it done.
type ActionApp struct {
	Key, ID, Name string
	State         State
	Ready         bool
	Steps         []Step
}

// Link is a Link step of the Action, drawn from the App that consumes it
// to its target. Waiting is the reason a Link has not run yet.
type Link struct {
	Key, Source, Target string
	Purpose             string
	State               State
	Waiting             string
	Error, Hint         string
}

const (
	StagePull        = "Pull"
	StageStart       = "Start"
	StageSetup       = "Setup"
	StageCredentials = "Credentials"
	StageLinks       = "Links"
	StageCheck       = "Check"
)

var stageOrder = []string{StagePull, StageStart, StageSetup, StageCredentials, StageLinks, StageCheck}

// ActionKey is the key of the Action's own row, which changes when it finishes.
const ActionKey = "action"

func buildAction(status service.Status, evs []events.Event, pull Pull) Action {
	evs = sinceRunStart(evs)
	names := map[string]string{}
	for _, app := range status.Apps {
		names[app.ID] = app.Name
	}
	name := func(id string) string {
		if names[id] != "" {
			return names[id]
		}
		return id
	}
	var out Action
	stages := map[string]*stageSteps{}
	// reached is, per App, the stages it has a step in.
	reached := map[string]map[string]bool{}
	var apps []*ActionApp
	byApp := map[string]*ActionApp{}
	started := map[string]State{}
	var links []*Link
	current := ""
	var lastRunning events.Event
	for _, e := range evs {
		switch e.Event {
		case events.RunStart:
			out.Title, out.Running = e.Msg, true
			continue
		case events.RunEnd:
			out.Running, out.Finished, out.Error = false, true, e.Error
			continue
		}
		state, ok := eventState(e.Event)
		if !ok || e.Step == "" || e.Step == service.StageRender {
			continue
		}
		stage := stageOf(e.Step)
		if stages[stage] == nil {
			stages[stage] = &stageSteps{states: map[string]State{}}
		}
		stages[stage].set(stepKey(e.App, e.Step), state)
		if state == Running {
			lastRunning = e
		}
		if e.App == "" {
			continue
		}
		if reached[e.App] == nil {
			reached[e.App] = map[string]bool{}
		}
		reached[e.App][stage] = true
		app := byApp[e.App]
		if app == nil {
			app = &ActionApp{Key: "app:" + e.App, ID: e.App, Name: name(e.App)}
			byApp[e.App] = app
			apps = append(apps, app)
		}
		switch stage {
		case StagePull, StageStart:
			if e.Step == service.StageStart || state == Failed {
				started[e.App] = state
			}
			continue
		case StageLinks:
			link := newLink(e, state, name)
			if i := slices.IndexFunc(links, func(l *Link) bool { return l.Key == link.Key }); i >= 0 {
				*links[i] = link
			} else {
				links = append(links, &link)
			}
			continue
		}
		current = e.App
		step := newStep(e.Step, state, e.Msg, e.Error, e.Hint)
		step.Key = stepKey(e.App, e.Step)
		step.Credential = credentialName(e.Step)
		if i := slices.IndexFunc(app.Steps, func(s Step) bool { return s.ID == e.Step }); i >= 0 {
			app.Steps[i] = step
		} else {
			app.Steps = append(app.Steps, step)
		}
	}
	for _, app := range apps {
		app.State = appState(*app, started[app.ID], app.ID == current && out.Running, out.Finished)
		app.Ready = app.State == Done && (out.Finished || slices.ContainsFunc(app.Steps, func(s Step) bool {
			return s.ID == "check" && (s.State == Done || s.State == Skipped)
		}))
		if app.Ready {
			out.Counts.AppsSetUp++
		}
		out.Counts.AppsTotal++
		out.Apps = append(out.Apps, *app)
	}
	for _, link := range links {
		if link.State == Done || link.State == Skipped {
			out.Counts.LinksApplied++
		}
		out.Counts.LinksTotal++
		out.Links = append(out.Links, *link)
	}
	for _, stage := range stageOrder {
		if steps := stages[stage]; steps != nil {
			out.Stages = append(out.Stages, Stage{Name: stage, State: stageState(out, stage, steps, reached)})
		}
	}
	out.Counts.ImagesPulled, out.Counts.ImagesTotal = pull.Done, pull.Total
	out.Narrative = narrative(out, lastRunning, pull, name)
	return out
}

func sinceRunStart(evs []events.Event) []events.Event {
	for i := len(evs) - 1; i >= 0; i-- {
		if evs[i].Event == events.RunStart {
			return evs[i:]
		}
	}
	return evs
}

func eventState(event string) (State, bool) {
	switch event {
	case events.StepStart:
		return Running, true
	case events.StepOK:
		return Done, true
	case events.StepSkip:
		return Skipped, true
	case events.StepManual:
		return Manual, true
	case events.StepFail:
		return Failed, true
	}
	return "", false
}

func stepKey(app, step string) string { return "step:" + app + "/" + step }

func stageOf(step string) string {
	switch {
	case step == service.StagePull:
		return StagePull
	case step == service.StageStart:
		return StageStart
	case step == "check":
		return StageCheck
	case strings.HasPrefix(step, "link-"):
		return StageLinks
	case credentialName(step) != "":
		return StageCredentials
	}
	return StageSetup
}

// credentialSteps mirror the Apps' step IDs that create or save a
// credential, in order: a step ID containing the pattern, or starting with
// it for a prefix, names that credential.
var credentialSteps = []struct {
	pattern, name string
	prefix        bool
}{
	{"api-key", "API key", false},
	{"auth-key", "API key", false},
	{"server-key", "API key", false},
	{"token", "token", false},
	{"password", "password", false},
	{"admin", "Admin login", true},
	{"rotate-admin", "Admin login", false},
	{"owner", "Admin login", false},
	{"credentials", "Admin login", false},
}

// credentialName names the credential a Setup step creates or saves, from
// the step's ID alone: the snapshot never carries a value.
func credentialName(step string) string {
	for _, c := range credentialSteps {
		if c.prefix && strings.HasPrefix(step, c.pattern) || !c.prefix && strings.Contains(step, c.pattern) {
			return c.name
		}
	}
	return ""
}

// stageSteps is the latest state of each step of a stage, in first-seen
// order, so a step that ran twice counts once.
type stageSteps struct {
	keys   []string
	states map[string]State
}

// latest is the latest state of every step of the stage.
func (s *stageSteps) latest() []State {
	var states []State
	for _, key := range s.keys {
		states = append(states, s.states[key])
	}
	return states
}

func (s *stageSteps) set(key string, state State) {
	if _, seen := s.states[key]; !seen {
		s.keys = append(s.keys, key)
	}
	s.states[key] = state
}

// stageRank is the order in which an App goes through the stages: Setup
// and its credentials interleave, and Links follow the check.
var stageRank = map[string]int{StagePull: 0, StageStart: 1, StageSetup: 2, StageCredentials: 2, StageCheck: 3, StageLinks: 4}

// stageState is a stage's state for the whole Action: running while any App
// is in it, failed or manual when one App ended there, done only once every
// App of the Action is past it, and not run otherwise.
func stageState(a Action, stage string, steps *stageSteps, reached map[string]map[string]bool) State {
	states := steps.latest()
	if slices.Contains(states, Running) {
		return Running
	}
	if stage == StageSetup && slices.ContainsFunc(a.Apps, func(app ActionApp) bool {
		setup := reached[app.ID][StageSetup] || reached[app.ID][StageCredentials]
		return app.State == Running && setup && !reached[app.ID][StageCheck]
	}) {
		return Running
	}
	for _, want := range []State{Failed, Manual} {
		if slices.Contains(states, want) {
			return want
		}
	}
	for _, app := range a.Apps {
		if !past(a, app, stage, steps, reached[app.ID]) {
			return NotRun
		}
	}
	if slices.Contains(states, Done) {
		return Done
	}
	return Skipped
}

// past reports that the App is through a stage: the Action finished, the
// App is ready or reached a later stage, or its one pull or start step ended.
func past(a Action, app ActionApp, stage string, steps *stageSteps, reached map[string]bool) bool {
	if a.Finished || app.Ready {
		return true
	}
	for other := range reached {
		if stageRank[other] > stageRank[stage] {
			return true
		}
	}
	if stage != StagePull && stage != StageStart {
		return false
	}
	state, ok := steps.states[stepKey(app.ID, stageStep[stage])]
	return ok && state != Running
}

var stageStep = map[string]string{StagePull: service.StagePull, StageStart: service.StageStart}

func appState(app ActionApp, started State, current, finished bool) State {
	ready := started == Done
	for _, step := range app.Steps {
		switch step.State {
		case Failed, Manual:
			return step.State
		case Running:
			return Running
		}
		if step.ID == "check" {
			ready = true
		}
	}
	switch {
	case started == Failed:
		return Failed
	case started == Running:
		return Running
	case current && !slices.ContainsFunc(app.Steps, func(s Step) bool { return s.ID == "check" }):
		return Running
	case ready || finished:
		return Done
	}
	return NotRun
}

func newLink(e events.Event, state State, name func(string) string) Link {
	target := strings.TrimPrefix(e.Step, "link-")
	link := Link{Key: "link:" + e.App + "/" + target, Source: name(e.App), Target: name(target),
		Purpose: e.Msg, State: state, Error: e.Error, Hint: e.Hint}
	if state == Skipped && strings.HasPrefix(e.Msg, "waiting for ") {
		link.State, link.Waiting, link.Purpose = NotRun, e.Msg, ""
	}
	return link
}

// narrative says in plain words what the Action is doing now, or how it
// ended.
func narrative(a Action, running events.Event, pull Pull, name func(string) string) string {
	if a.Finished {
		if a.Error != "" {
			return "The Action failed: " + firstLine(a.Error)
		}
		for _, app := range a.Apps {
			for _, step := range app.Steps {
				if step.State == Failed {
					return app.Name + " failed: " + firstLine(cmp.Or(step.Error, step.Msg))
				}
			}
		}
		for _, link := range a.Links {
			if link.State == Failed {
				return "Linking " + link.Source + " to " + link.Target + " failed: " + firstLine(cmp.Or(link.Error, link.Purpose))
			}
		}
		if msg := needsYou(a); msg != "" {
			return msg
		}
		switch len(a.Apps) {
		case 0:
			return "Done"
		case 1:
			return a.Apps[0].Name + " is ready"
		}
		return fmt.Sprintf("All %d Apps are ready", len(a.Apps))
	}
	if !a.Running && len(a.Stages) == 0 {
		return ""
	}
	if a.stage(StagePull) == Running {
		if pull.Total > 0 {
			return "Pulling " + plural(pull.Total, "image", "images")
		}
		return "Pulling images"
	}
	if a.stage(StageStart) == Running {
		var starting []string
		for _, app := range a.Apps {
			if app.State == Running {
				starting = append(starting, app.Name)
			}
		}
		if len(starting) == 1 {
			return "Starting " + starting[0]
		}
		return "Starting " + plural(len(starting), "App", "Apps")
	}
	if running.Step != "" && runningStill(a, running) {
		app := name(running.App)
		switch stageOf(running.Step) {
		case StageCheck:
			return "Checking " + app
		case StageLinks:
			return "Linking " + app + " to " + name(strings.TrimPrefix(running.Step, "link-"))
		}
		if running.Msg != "" {
			return "Setting up " + app + ": " + running.Msg
		}
		return "Setting up " + app
	}
	if msg := needsYou(a); msg != "" {
		return msg
	}
	return "Working on " + a.Title
}

func (a Action) stage(name string) State {
	for _, s := range a.Stages {
		if s.Name == name {
			return s.State
		}
	}
	return ""
}

func runningStill(a Action, e events.Event) bool {
	for _, app := range a.Apps {
		for _, step := range app.Steps {
			if step.Key == stepKey(e.App, e.Step) {
				return step.State == Running
			}
		}
	}
	for _, link := range a.Links {
		if link.Key == "link:"+e.App+"/"+strings.TrimPrefix(e.Step, "link-") {
			return link.State == Running
		}
	}
	return false
}

func needsYou(a Action) string {
	for _, app := range a.Apps {
		for _, step := range app.Steps {
			if step.State == Manual {
				return app.Name + " needs you: " + firstLine(cmp.Or(step.Hint, step.Msg))
			}
		}
	}
	return ""
}

func firstLine(s string) string {
	line, _, _ := strings.Cut(s, "\n")
	return line
}

func plural(n int, one, many string) string {
	if n == 1 {
		return "1 " + one
	}
	return fmt.Sprintf("%d %s", n, many)
}
