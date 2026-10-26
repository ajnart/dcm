package tui

import (
	"context"
	"errors"
	"slices"
	"strconv"
	"strings"
	"time"

	"charm.land/bubbles/v2/key"
	tea "charm.land/bubbletea/v2"
	"charm.land/huh/v2"

	"github.com/ajnart/self-host/internal/activity"
	"github.com/ajnart/self-host/internal/catalog"
	"github.com/ajnart/self-host/internal/host"
	"github.com/ajnart/self-host/internal/project"
	"github.com/ajnart/self-host/internal/service"
	"github.com/ajnart/self-host/internal/telemetry"
)

// step is one step of Onboarding, in order.
type step int

const (
	stepWelcome step = iota
	stepWhat
	stepWhere
	stepAccess
	stepWho
	stepLook
	stepReview
)

var stepNames = []string{"Welcome", "What", "Where", "Access", "Who", "Look", "Review"}

// answers is shared by pointer so huh's bindings survive Model copies and
// every step's form, built afresh each time the step opens, shows them.
type answers struct {
	// exposure is the stored value of the Access chosen: lan, or local from the command line.
	exposure     string
	easyNames    bool
	accessChosen bool
	accessChoice string
	cloudflare   bool
	// experience is the selected Experience level at Welcome:
	// new until the person chooses.
	experience               string
	picks                    picks
	tz, lan, puid, pgid      string
	media, downloads         string
	adminUser, adminPassword string
	inputs                   map[string]*string
}

// onboarding is the person's first run, from the host checks to an approved
// plan. Approving hands over to the Dashboard; onboarding stays until the
// Project exists, so an install that fails before that returns to Review.
type onboarding struct {
	step step
	form *huh.Form
	// list is the What step's Recipes and Apps, before the picked Apps' own inputs in form.
	list    *whatList
	answers *answers
	plan    *plan
	// hostChecks are the read-only disk and selected-port checks shown at Review.
	hostChecks []host.Check
	// intro is the scene that opens Onboarding, nil once Welcome shows.
	intro      *introScreen
	experience int
	// react is Welcome's reaction to a focus move or a selection.
	react welcomeReaction
	// look is the highlighted choice of the Look step, an index into glyphChoices.
	look int
	// access is the highlighted option of the Access step, an index into accessOptions.
	access int
	// task is the approved install; while it is set Pre-boot or the Dashboard is on screen.
	task int
	err  string
	// folders suggests and lists the folders of the Where step's folder fields.
	folders *folderPicker
	// notice announces Telemetry on the Welcome step, once per Home folder;
	// it is read when Welcome is first about to show, which noticeRead records.
	notice     string
	noticeRead bool
	// experienceSaved is set when the Profile already holds an Experience
	// level: Welcome does not ask, and Review does not save one.
	experienceSaved bool
	// opened is when Onboarding opened; introSkipped is set when the person
	// skipped the Intro. Both only feed the onboarding Telemetry event.
	opened       time.Time
	introSkipped bool
}

// onboardingAsk is what Onboarding asks of the Model after it handled a
// message: the things only the Model can do.
type onboardingAsk struct {
	quit, help, tick, doctor, approve bool
	errorText                         string
}

func newOnboarding(ctx *viewContext) *onboarding {
	o := &onboarding{answers: &answers{exposure: service.ExposureLAN, adminUser: "admin", inputs: map[string]*string{}},
		folders: newFolderPicker(ctx.backend), opened: ctx.opts.Now(), react: welcomeReaction{focusAge: -1, selectAge: -1}}
	o.answers.fill(ctx.defaults)
	o.openStep(ctx, stepWelcome)
	o.intro = newIntroScreen(ctx)
	return o
}

// fill sets every detected Host setting the person has not answered yet.
func (a *answers) fill(defaults map[string]string) {
	for _, f := range []struct {
		value *string
		key   string
	}{{&a.tz, "TZ"}, {&a.lan, "LAN_IP"}, {&a.puid, "PUID"}, {&a.pgid, "PGID"}, {&a.media, "MEDIA_ROOT"}, {&a.downloads, "DOWNLOADS_ROOT"}} {
		if *f.value == "" {
			*f.value = defaults[f.key]
		}
	}
}

func (o *onboarding) Update(ctx *viewContext, msg tea.Msg) (tea.Cmd, onboardingAsk) {
	if press, ok := msg.(tea.KeyPressMsg); ok {
		return o.key(ctx, press)
	}
	if o.form != nil {
		return o.updateForm(ctx, msg)
	}
	return nil, onboardingAsk{}
}

func (o *onboarding) detected(defaults map[string]string) {
	o.answers.fill(defaults)
	if !o.answers.accessChosen {
		o.answers.accessChoice = ""
	}
}

func (o *onboarding) resize(width int) {
	if o.form != nil {
		o.form.WithWidth(formWidth(width))
	}
}

func (o *onboarding) cloudflareChosen() bool { return o.answers != nil && o.answers.cloudflare }

func (o *onboarding) pendingSecrets(cat *catalog.Catalog) []string {
	if o == nil || o.answers == nil {
		return nil
	}
	secrets := []string{o.answers.adminPassword}
	for _, a := range cat.Apps() {
		for _, input := range a.Inputs() {
			if value := o.answers.inputs[a.Info().ID+"."+input.Key]; input.Private && value != nil {
				secrets = append(secrets, *value)
			}
		}
	}
	return secrets
}

// focusedKey is the key of the focused form field, or "" off a form.
func (o *onboarding) focusedKey() string {
	if o.form == nil {
		return ""
	}
	if f := o.form.GetFocusedField(); f != nil {
		return f.GetKey()
	}
	return ""
}

// tabAsEnter makes Tab on a folder field with nothing to complete move on, as
// it does on the other Where fields.
func (o *onboarding) tabAsEnter(msg tea.Msg) tea.Msg {
	press, ok := msg.(tea.KeyPressMsg)
	if !ok || press.Code != tea.KeyTab || press.Mod != 0 {
		return msg
	}
	typed := o.answers.media
	switch o.focusedKey() {
	case whereMedia:
	case whereDownloads:
		typed = o.answers.downloads
	default:
		return msg
	}
	if len(o.folders.suggestions(typed)) > 0 {
		return msg
	}
	return tea.KeyPressMsg{Code: tea.KeyEnter}
}

// helpPage is the page `?` opens: the help page of the highlighted Access
// option, on the Access step. A text input takes `?` itself.
func (o *onboarding) helpPage() (helpPage, bool) {
	if o.step != stepAccess || o.form != nil {
		return helpPage{}, false
	}
	return accessPage(accessOptions[o.access], o.answers.lan), true
}

// installEnded returns to Review, answers kept and the error shown, when
// the approved install ended before it created the Project. It reports that
// it did.
func (o *onboarding) installEnded(tasks *taskManager, finished []int) bool {
	if o.task == 0 || !slices.Contains(finished, o.task) {
		return false
	}
	o.err = ""
	if task := tasks.get(o.task); task != nil {
		o.err = task.snapshot().err
	}
	o.task, o.step, o.form = 0, stepReview, nil
	return true
}

func (o *onboarding) key(ctx *viewContext, msg tea.KeyPressMsg) (tea.Cmd, onboardingAsk) {
	if o.intro != nil {
		return o.introKey(ctx, msg)
	}
	if key.Matches(msg, ctx.keys.Help) {
		if _, found := o.helpPage(); found {
			return nil, onboardingAsk{help: true}
		}
	}
	if o.list != nil {
		return o.whatKey(ctx, msg)
	}
	if o.form != nil {
		if msg.String() == "esc" && !takesEsc(o.form) {
			if o.step == stepAccess {
				return o.openStep(ctx, stepAccess), onboardingAsk{}
			}
			if o.step == stepWhat {
				return o.openStep(ctx, stepWhat), onboardingAsk{}
			}
			return o.openStep(ctx, o.step-1), onboardingAsk{}
		}
		return o.updateForm(ctx, msg)
	}
	var ask onboardingAsk
	switch msg.String() {
	case "q", "ctrl+c":
		return nil, onboardingAsk{quit: true}
	case "esc":
		if o.step > stepWelcome {
			return o.openStep(ctx, o.step-1), onboardingAsk{}
		}
	case "up", "k":
		switch o.step {
		case stepWelcome:
			if !o.experienceSaved {
				before := o.experience
				o.experience = max(o.experience-1, 0)
				ask.tick = o.reactFocus(ctx, before)
			}
		case stepLook:
			o.look = max(o.look-1, 0)
		case stepAccess:
			o.access = max(o.access-1, 0)
			ctx.setFlash("", levelInfo)
		}
	case "down", "j":
		switch o.step {
		case stepWelcome:
			if !o.experienceSaved {
				before := o.experience
				o.experience = min(o.experience+1, len(experienceChoices)-1)
				ask.tick = o.reactFocus(ctx, before)
			}
		case stepLook:
			o.look = min(o.look+1, len(glyphChoices)-1)
		case stepAccess:
			o.access = min(o.access+1, len(accessOptions)-1)
			ctx.setFlash("", levelInfo)
		}
	case "space":
		switch o.step {
		case stepWelcome:
			if !o.experienceSaved {
				before := o.answers.experience
				o.answers.experience = experienceChoices[o.experience].level
				ask.tick = o.reactSelect(ctx, before)
			}
		case stepLook:
			ctx.glyphs = glyphChoices[o.look].glyphs
		case stepAccess:
			choice := accessOptions[o.access]
			if choice.explainsOnly() {
				ctx.setFlash(accessNote(choice, o.answers.exposure), levelInfo)
				break
			}
			o.answers.accessChoice, o.answers.accessChosen = choice.id, true
			ctx.setFlash("", levelInfo)
		}
	case "a":
		if o.step == stepReview && o.err != "" {
			return o.openStep(ctx, stepAccess), onboardingAsk{}
		}
	case "w":
		if o.step == stepReview && o.err != "" {
			return o.openStep(ctx, stepWhere), onboardingAsk{}
		}
	case "c":
		if o.step == stepReview && o.err != "" {
			return copyError(o.err), onboardingAsk{}
		}
	case "e":
		if o.step == stepReview && o.err != "" {
			return nil, onboardingAsk{errorText: o.err}
		}
	case "enter":
		return o.next(ctx)
	case "r":
		if o.step == stepReview {
			o.checkPlan(ctx)
		}
	}
	return nil, ask
}

// takesEsc reports that the focused field uses esc itself, as a filtering
// list does to stop filtering.
func takesEsc(f *huh.Form) bool {
	field := f.GetFocusedField()
	if field == nil {
		return false
	}
	for _, b := range field.KeyBinds() {
		if b.Enabled() && slices.Contains(b.Keys(), "esc") {
			return true
		}
	}
	return false
}

func (o *onboarding) next(ctx *viewContext) (tea.Cmd, onboardingAsk) {
	switch o.step {
	case stepAccess:
		choice, found := accessByID(o.answers.accessChoice)
		if !found {
			choice = accessOptions[0]
		}
		if choice.id == "tailscale" {
			if _, found := ctx.backend.Catalog().App("tailscale"); !found {
				ctx.setFlash("Tailscale is not in this Catalog", levelWarn)
				return nil, onboardingAsk{}
			}
			o.answers.picks["tailscale"] = true
			value := o.answers.inputs["tailscale.auth_key"]
			if value == nil {
				value = new(string)
				o.answers.inputs["tailscale.auth_key"] = value
			}
			input := huh.NewInput().Title("Tailscale auth key").Description("First enable HTTPS at login.tailscale.com/admin/dns: App names appear in a public certificate log. Then make a reusable, pre-approved key at login.tailscale.com/admin/settings/keys. Paste it only here, never into chat.").Value(value).EchoMode(huh.EchoModePassword).Validate(func(s string) error {
				if strings.TrimSpace(s) == "" {
					return errors.New("required")
				}
				return nil
			})
			o.form = huh.NewForm(huh.NewGroup(input)).WithWidth(formWidth(ctx.width)).WithHeight(o.formHeight(ctx, stepAccess))
			return o.form.Init(), onboardingAsk{}
		}
		if choice.explainsOnly() {
			ctx.setFlash(accessNote(choice, o.answers.exposure), levelInfo)
			return nil, onboardingAsk{}
		}
		if choice.id == "cloudflare" {
			o.answers.cloudflare = true
			ctx.setFlash("Choose your web addresses in Settings after the Apps are installed; nothing goes public yet", levelInfo)
			return o.openStep(ctx, stepWho), onboardingAsk{}
		}
		o.answers.cloudflare = false
		o.answers.exposure = choice.value
		o.answers.easyNames, o.answers.accessChosen = choice.id == "names", true
		delete(o.answers.picks, "tailscale")
	case stepLook:
		return o.openStep(ctx, stepReview), onboardingAsk{}
	case stepReview:
		if host.Worst(o.hostChecks) == host.Fail {
			return nil, onboardingAsk{}
		}
		if check := o.reviewNamesCheck(); !check.Available {
			o.err = check.Message
			return nil, onboardingAsk{}
		}
		return nil, onboardingAsk{approve: true}
	}
	return o.openStep(ctx, o.step+1), onboardingAsk{}
}

// openStep shows a step; the form steps get a form over the answers so far.
func (o *onboarding) openStep(ctx *viewContext, s step) tea.Cmd {
	o.step, o.form, o.list = s, nil, nil
	switch s {
	case stepWelcome:
		o.experienceSaved = ctx.backend.Experience(context.Background()) != ""
		if o.answers.experience == "" {
			o.answers.experience = project.ExperienceNew
		}
		o.experience = max(slices.IndexFunc(experienceChoices, func(c experienceChoice) bool { return c.level == o.answers.experience }), 0)
	case stepWhat:
		if o.answers.picks == nil {
			o.answers.picks = picks{}
			if _, found := ctx.backend.Catalog().App("homarr"); found {
				o.answers.picks["homarr"] = true
			}
		}
		o.list = newWhatList(ctx)
	case stepWhere, stepWho:
		o.form = o.buildForm(ctx, s)
		return o.form.Init()
	case stepAccess:
		o.access = max(slices.IndexFunc(accessOptions, func(a accessOption) bool { return a.value == o.answers.exposure }), 0)
		if o.answers.easyNames {
			o.access = 1
		}
		if o.answers.cloudflare {
			o.access = slices.IndexFunc(accessOptions, func(a accessOption) bool { return a.id == "cloudflare" })
		}
		if o.answers.picks["tailscale"] {
			o.access = slices.IndexFunc(accessOptions, func(a accessOption) bool { return a.id == "tailscale" })
		}
		if o.answers.accessChoice != "" {
			o.access = max(slices.IndexFunc(accessOptions, func(a accessOption) bool { return a.id == o.answers.accessChoice }), 0)
		}
		o.answers.accessChoice = accessOptions[o.access].id
	case stepLook:
		o.look = slices.IndexFunc(glyphChoices, func(c glyphChoice) bool { return c.glyphs == ctx.glyphs })
		o.look = max(o.look, 0)
	case stepReview:
		o.err = ""
		o.checkPlan(ctx)
		if check := o.reviewNamesCheck(); !check.Available {
			o.err = check.Message
		}
	}
	return nil
}

func (o *onboarding) checkPlan(ctx *viewContext) {
	o.plan = planFromAnswers(ctx.backend, o.answers)
	o.hostChecks = ctx.backend.OnboardingChecks(context.Background(), o.plan.opts)
	for i, c := range o.hostChecks {
		o.hostChecks[i] = dockerDown(c)
	}
	for _, check := range o.hostChecks {
		if check.ID == "port" && check.Level != host.Fail && check.Input != "" && check.Port > 0 {
			o.plan.opts.Sets = append(o.plan.opts.Sets, check.App+"."+check.Input+"="+strconv.Itoa(check.Port))
		}
	}
}

func (o *onboarding) reviewNamesCheck() service.NamesCheck {
	if o.plan != nil && o.plan.opts.EasyNames {
		return service.EasyNamesAddressCheck(o.plan.opts.Settings["LAN_IP"])
	}
	return service.NamesCheck{Available: true}
}

// approved is what the approved Review saves and reports beside the install:
// the glyph set, the Experience level and the onboarding Telemetry event.
func (o *onboarding) approved(ctx *viewContext) tea.Cmd {
	cmds := []tea.Cmd{saveGlyphsWithInstall(ctx.backend, ctx.glyphs), o.report(ctx)}
	if !o.experienceSaved {
		cmds = append(cmds, saveExperienceWithInstall(ctx.backend, o.answers.experience))
	}
	return tea.Batch(cmds...)
}

// report sends the onboarding Telemetry event of the approved Review.
func (o *onboarding) report(ctx *viewContext) tea.Cmd {
	experience := o.answers.experience
	if o.experienceSaved {
		experience = ctx.backend.Experience(context.Background())
	}
	doctor := "ok"
	if host.Worst(ctx.checks) == host.Warn {
		doctor = "warn"
	}
	report := telemetry.Onboarding{
		Experience:   experience,
		Glyphs:       string(activity.ParseGlyphs(string(ctx.glyphs))),
		IntroSkipped: o.introSkipped,
		Doctor:       doctor,
		Duration:     ctx.opts.Now().Sub(o.opened),
	}
	if o.plan != nil {
		report.Apps = o.plan.opts.Targets
		report.Access = o.plan.opts.Exposure
		if report.Access == service.ExposureLAN {
			report.Access = "home"
		}
	}
	backend := ctx.backend
	return func() tea.Msg {
		backend.ReportOnboarding(report)
		return nil
	}
}

// saveGlyphsWithInstall saves the glyph set with the Project in step with
// the install that creates it. A failure only warns, and the install goes on.
func saveGlyphsWithInstall(backend Backend, g activity.Glyphs) tea.Cmd {
	return func() tea.Msg {
		if err := backend.SetGlyphs(context.Background(), g); err != nil {
			return flashMsg{text: "! could not save the icons choice (" + firstLine(err.Error()) + "); change it later in Settings", level: levelWarn}
		}
		return nil
	}
}

// saveExperienceWithInstall saves the Experience level in the Profile in step
// with the install. A failure only warns, and the install goes on.
func saveExperienceWithInstall(backend Backend, level string) tea.Cmd {
	return func() tea.Msg {
		if err := backend.SetExperience(context.Background(), level); err != nil {
			return flashMsg{text: "! could not save your Experience level (" + firstLine(err.Error()) + "); change it later with self-host profile", level: levelWarn}
		}
		return nil
	}
}

func (o *onboarding) backToWelcome(ctx *viewContext) tea.Cmd {
	o.step, o.form, o.list = stepWelcome, nil, nil
	ctx.setFlash("back at Welcome; nothing was installed", levelInfo)
	return nil
}

func (o *onboarding) updateForm(ctx *viewContext, msg tea.Msg) (tea.Cmd, onboardingAsk) {
	msg = o.tabAsEnter(msg)
	next, cmd := o.form.Update(msg)
	o.form = next.(*huh.Form)
	switch o.form.State {
	case huh.StateAborted:
		return o.backToWelcome(ctx), onboardingAsk{}
	case huh.StateCompleted:
		return o.openStep(ctx, o.step+1), onboardingAsk{}
	}
	return cmd, onboardingAsk{}
}
