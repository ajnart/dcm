package activity

// Glyphs is a glyph set: the icons that carry meaning, which are an App's
// category, the Docker, key and link stages, and the brand mark. Bars,
// spinners and state dots are not part of it, so progress never depends on
// a font. The zero value draws as Simple.
type Glyphs string

const (
	// NerdFont draws Nerd Fonts v3 icons, which need a patched font.
	NerdFont Glyphs = "nerd-font"
	// Simple draws Unicode symbols that every terminal font has.
	Simple Glyphs = "simple"
)

// ParseGlyphs is the glyph set saved under name; anything else is Simple.
func ParseGlyphs(name string) Glyphs {
	if Glyphs(name) == NerdFont {
		return NerdFont
	}
	return Simple
}

// Label is the set's name as a person reads it.
func (g Glyphs) Label() string {
	if g == NerdFont {
		return "Nerd Font"
	}
	return "Simple"
}

func (g Glyphs) Brand() string  { return g.icons().brand }
func (g Glyphs) Docker() string { return g.icons().docker }
func (g Glyphs) Key() string    { return g.icons().key }
func (g Glyphs) Link() string   { return g.icons().link }

// Category is the icon of an App category, or the set's fallback for a
// category it does not know.
func (g Glyphs) Category(name string) string {
	icons := g.icons()
	if icon, ok := icons.categories[name]; ok {
		return icon
	}
	return icons.fallback
}

func (g Glyphs) icons() iconSet {
	if g == NerdFont {
		return nerdFontIcons
	}
	return simpleIcons
}

type iconSet struct {
	brand, docker, key, link, fallback string
	categories                         map[string]string
}

// nerdFontIcons are Material Design icons (nf-md-*) of Nerd Fonts v3.
var nerdFontIcons = iconSet{
	brand:    "\U000F070B", // nf-md-rhombus
	docker:   "\U000F0868", // nf-md-docker
	key:      "\U000F0306", // nf-md-key
	link:     "\U000F0339", // nf-md-link_variant
	fallback: "\U000F08C6", // nf-md-application
	categories: map[string]string{
		"Analytics":       "\U000F0128", // nf-md-chart_bar
		"Backups":         "\U000F006F", // nf-md-backup_restore
		"Cameras":         "\U000F07AE", // nf-md-cctv
		"Communication":   "\U000F0369", // nf-md-message_text
		"Containers":      "\U000F0868", // nf-md-docker
		"DNS":             "\U000F01D6", // nf-md-dns
		"Dashboard":       "\U000F056E", // nf-md-view_dashboard
		"Databases":       "\U000F01BC", // nf-md-database
		"Developer tools": "\U000F0169", // nf-md-code_braces
		"Documents":       "\U000F0219", // nf-md-file_document
		"Downloads":       "\U000F01DA", // nf-md-download
		"Files":           "\U000F024B", // nf-md-folder
		"Home automation": "\U000F07D1", // nf-md-home_automation
		"Identity":        "\U000F000B", // nf-md-account_key
		"Ingress":         "\U000F09BB", // nf-md-arrow_decision
		"Local AI":        "\U000F06A9", // nf-md-robot
		"Media":           "\U000F0FCE", // nf-md-movie_open
		"Monitoring":      "\U000F05F6", // nf-md-heart_pulse
		"Observability":   "\U000F0E93", // nf-md-chart_timeline_variant
		"Passwords":       "\U000F033E", // nf-md-lock
		"Photos":          "\U000F02F9", // nf-md-image_multiple
		"Productivity":    "\U000F082E", // nf-md-notebook
		"Remote access":   "\U000F0582", // nf-md-vpn
		"Requests":        "\U000F11D2", // nf-md-movie_search
		"Storage":         "\U000F02CA", // nf-md-harddisk
	},
}

// simpleIcons are one-cell Unicode symbols: the reel's ◆ brand and ↓ for
// downloads, and common symbols for the roles the reel has none for.
var simpleIcons = iconSet{
	brand:    "◆",
	docker:   "▣",
	key:      "✱",
	link:     "⇄",
	fallback: "◇",
	categories: map[string]string{
		"Analytics":       "↗",
		"Backups":         "↺",
		"Cameras":         "⊙",
		"Communication":   "✉",
		"Containers":      "▣",
		"DNS":             "⊘",
		"Dashboard":       "▦",
		"Databases":       "≣",
		"Developer tools": "λ",
		"Documents":       "▤",
		"Downloads":       "↓",
		"Files":           "☁",
		"Home automation": "⌂",
		"Identity":        "☺",
		"Ingress":         "⇥",
		"Local AI":        "✦",
		"Media":           "▶",
		"Monitoring":      "♥",
		"Observability":   "∿",
		"Passwords":       "✱",
		"Photos":          "▨",
		"Productivity":    "✎",
		"Remote access":   "⋈",
		"Requests":        "⊕",
		"Storage":         "▥",
	},
}
