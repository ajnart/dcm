package tui

import (
	"errors"
	"strconv"
	"strings"

	"charm.land/huh/v2"
	"charm.land/lipgloss/v2"

	"github.com/ajnart/self-host/internal/catalog"
)

func validPassword(s string) error {
	if s == "" {
		return nil
	}
	if len(s) < 8 {
		return errors.New("at least 8 characters, or leave empty to generate one")
	}
	if strings.ContainsAny(s, "'\n\r") {
		return errors.New("quotes and newlines are not supported")
	}
	return nil
}

// mediaApps are the chosen Apps that keep files in the media and downloads folders.
func mediaApps(cat *catalog.Catalog, p picks) []string {
	var names []string
	for _, a := range p.apps(cat) {
		if a.Info().UsesMedia {
			names = append(names, a.Info().Name)
		}
	}
	return names
}

// buildForm is the form of the What, Where or Who step over the answers so
// far. Each step's own explanation sits above it; the fields explain
// themselves in one line each.
func (o *onboarding) buildForm(ctx *viewContext, s step) *huh.Form {
	v := o.answers
	cat := ctx.backend.Catalog()
	folders := o.folders
	media, downloads := folders.input(&v.media), folders.input(&v.downloads)
	var groups []*huh.Group
	height := o.formHeight(ctx, s)
	switch s {
	case stepWhat:
		groups = o.inputGroups(cat)
		height-- // huh adds a line for its error
	case stepWhere:
		groups = append(groups,
			huh.NewGroup(
				huh.NewInput().Key(whereLAN).Title("LAN address").Value(&v.lan),
				huh.NewInput().Key(whereTZ).Title("Time zone").Value(&v.tz),
				huh.NewInput().Key(wherePUID).Title("User ID (PUID)").Value(&v.puid).Validate(numeric),
				huh.NewInput().Key(wherePGID).Title("Group ID (PGID)").Value(&v.pgid).Validate(numeric),
			).Title("Host settings").Description("Detected from this machine."),
			huh.NewGroup(
				media.Key(whereMedia).Title("Media folder"),
				downloads.Key(whereDownloads).Title("Downloads folder"),
			).Title("Folders").WithHideFunc(func() bool { return len(mediaApps(cat, v.picks)) == 0 }))
		groups[1].Description("Used by " + strings.Join(mediaApps(cat, v.picks), ", ") + ".")
	case stepWho:
		groups = append(groups, huh.NewGroup(
			huh.NewInput().Title("Admin username").Value(&v.adminUser).
				Validate(func(s string) error {
					if strings.TrimSpace(s) == "" {
						return errors.New("required")
					}
					return nil
				}),
			huh.NewInput().Title("Admin password").Description("Leave empty to generate a strong one").
				EchoMode(huh.EchoModePassword).Value(&v.adminPassword).Validate(validPassword),
		).Title("Admin login"))
	}
	form := huh.NewForm(groups...).WithTheme(huh.ThemeFunc(huh.ThemeCharm)).WithShowHelp(s != stepWhere).WithWidth(formWidth(ctx.width))
	if s != stepWhere {
		return form.WithHeight(height)
	}
	media.WithKeyMap(folderKeyMap())
	downloads.WithKeyMap(folderKeyMap())
	// Where's pages are as tall as their own fields, so the explanation of
	// the focused field sits right under them, and scroll only past height.
	for _, g := range groups {
		raw := lipgloss.Height(g.Content())
		if g.Header() != "" {
			raw += lipgloss.Height(g.Header())
		}
		g.WithHeight(min(raw, height))
	}
	return form
}

func formWidth(width int) int { return min(max(width-8, 40), 100) }

// formHeight is what a form step has left under the step indicator and its
// explanation. The What list shares it with the hovered description, and
// Where keeps room under its form for the explanation of the focused field.
func (o *onboarding) formHeight(ctx *viewContext, s step) int {
	room := ctx.mainHeight() - 3 - len(o.stepIntro(ctx, s)) - 1
	if s == stepWhere {
		room -= whereExplainLines
		if len(mediaApps(ctx.backend.Catalog(), o.answers.picks)) > 0 {
			room -= folderListLines
		}
	}
	return max(room, 6)
}

// stepIntro is why a step asks, in one or two calm sentences.
func (o *onboarding) stepIntro(ctx *viewContext, s step) []string {
	text := ""
	switch s {
	case stepWhat:
		text = "Pick the Apps you want to run, or a Recipe: a ready-made set of Apps that work together. You can add more later from the Catalog."
		if o.answers.picks["homarr"] {
			text += " Homarr is preselected as your Apps' home page; unpick its App row to skip it."
		}
	case stepWhere:
		text = "This computer's address on your network, the settings your Apps share and where they keep their files."
	case stepAccess:
		text = "Choose how phones, TVs and laptops will open your Apps. Home network needs nothing to set up. " +
			"You can change this later in Settings, under Access."
	case stepWho:
		text = "One Admin login signs in to every App, so there is only one to remember. Choose a password, or leave it empty: " +
			"self-host generates a strong one, keeps it in your Project and shows it with self-host credentials. " +
			"The password is hidden as you type and never shown again."
	case stepLook:
		text = "self-host can draw its icons with a Nerd Font, a terminal font with extra symbols, or with plain symbols every font has. " +
			"Bars and spinners look the same either way."
	}
	return strings.Split(wrap(text, min(max(ctx.width-4, 20), 96)), "\n")
}

// The Where fields, by the key each answers to.
const (
	whereLAN       = "lan"
	whereTZ        = "tz"
	wherePUID      = "puid"
	wherePGID      = "pgid"
	whereMedia     = "media"
	whereDownloads = "downloads"
)

// whereExplainLines is the room Where keeps under its form for the
// explanation of the focused field, a blank line and two of text, and for the
// two lines a failed validation adds to the form.
const whereExplainLines = 5

// folderListLines is the room the folder fields add under their explanation
// for the folders inside the typed path.
const folderListLines = 2

// whereExplanations are the one-line explanations of the Where fields that
// do not change with the answers.
var whereExplanations = map[string]string{
	whereLAN:       "App links use this address, so TVs and phones can open them. It only builds links: the Access step decides who can connect.",
	whereTZ:        "The clock your Apps use for schedules and logs, for example Europe/Paris.",
	wherePUID:      "The user ID that owns the files your Apps write, so you can open them. Detected from this machine.",
	wherePGID:      "The group ID that owns those files. Detected from this machine.",
	whereMedia:     "Where movies, shows and music live. The folder must exist or sit inside one that does. " + folderKeysHint,
	whereDownloads: "Where downloads land before they move to media. The folder must exist or sit inside one that does. " + folderKeysHint,
}

// inputGroups ask each chosen App's own inputs; an answer survives the
// form being built again when the person comes back.
func (o *onboarding) inputGroups(cat *catalog.Catalog) []*huh.Group {
	v := o.answers
	var groups []*huh.Group
	for _, a := range v.picks.apps(cat) {
		inputs := a.Inputs()
		if len(inputs) == 0 {
			continue
		}
		id := a.Info().ID
		var fields []huh.Field
		for _, in := range inputs {
			value := v.inputs[id+"."+in.Key]
			if value == nil {
				value = new(string)
				if !in.Private {
					*value = in.Default
				}
				v.inputs[id+"."+in.Key] = value
			}
			field := huh.NewInput().Title(in.Prompt).Description(in.Help).Value(value)
			if in.Private {
				field = field.EchoMode(huh.EchoModePassword)
			}
			if in.Required {
				field = field.Validate(func(s string) error {
					if strings.TrimSpace(s) == "" {
						return errors.New("required")
					}
					return nil
				})
			}
			fields = append(fields, field)
		}
		groups = append(groups, huh.NewGroup(fields...).Title(a.Info().Name).Description(a.Info().Name+" needs a few answers of its own."))
	}
	return groups
}

func numeric(s string) error {
	if _, err := strconv.Atoi(strings.TrimSpace(s)); err != nil {
		return errors.New("a number")
	}
	return nil
}
