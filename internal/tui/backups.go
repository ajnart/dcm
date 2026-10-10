package tui

import (
	"context"
	"strconv"
	"strings"

	"charm.land/bubbles/v2/key"
	"charm.land/bubbles/v2/textinput"
	tea "charm.land/bubbletea/v2"

	"github.com/ajnart/self-host/internal/service"
)

type (
	// backupsMsg carries the archives found in the Project's backups folder.
	backupsMsg struct {
		list []service.BackupInfo
		err  error
	}
	// backupAppsMsg carries the Apps in an archive's manifest, read with the
	// passphrase the person gave.
	backupAppsMsg struct {
		file string
		apps []string
		err  error
	}
)

func loadBackups(backend Backend) tea.Cmd {
	return func() tea.Msg {
		list, err := backend.Backups(context.Background())
		return backupsMsg{list: list, err: err}
	}
}

func loadBackupApps(backend Backend, file, passphrase string) tea.Cmd {
	return func() tea.Msg {
		apps, err := backend.BackupApps(context.Background(), file, passphrase)
		return backupAppsMsg{file: file, apps: apps, err: err}
	}
}

// backupMode is what the Backups sub-tab is doing: listing, or one of the
// steps that take every key until they finish or are cancelled.
type backupMode int

const (
	backupList backupMode = iota
	// backupAsk asks for the passphrase of a new backup.
	backupAsk
	// backupConfirm asks for a new backup's passphrase a second time.
	backupConfirm
	// restoreAsk asks for the passphrase of an encrypted archive, to read
	// which Apps it holds.
	restoreAsk
	// restorePreview offers what to restore and runs it on a second enter.
	restorePreview
)

// backupsPane is the Backups sub-tab: the archives, the passphrase prompts
// and the restore preview. The passphrase lives only in the masked input and
// in pass, and is cleared once the Action is dispatched or cancelled.
type backupsPane struct {
	list   []service.BackupInfo
	loaded bool
	err    string
	cursor int
	offset int

	mode  backupMode
	input textinput.Model
	// opening is set while an encrypted archive's manifest is being read.
	opening bool
	// file is the archive being restored, apps its manifest's App IDs and
	// scope the highlighted choice: 0 is the whole Project, n the n-th App.
	file        service.BackupInfo
	apps        []string
	scope       int
	scopeOffset int
	pass        string
	armed       bool
	promptErr   string
}

const waitToBackUp = reasonBusy + " before backing up or restoring"

var (
	backupsKeys = []key.Binding{
		hint("↑/↓", "select"), hint("b", "back up"), hint("enter", "restore"), hint("[/]", "sub-tab"), hint("esc", "back"),
	}
	backupAskKeys     = []key.Binding{hint("enter", "accept"), hint("esc", "cancel")}
	restorePreviewKey = []key.Binding{hint("↑/↓", "select"), hint("enter", "restore"), hint("esc", "cancel")}
)

// modal reports that the pane takes every key.
func (b *backupsPane) modal() bool { return b.mode != backupList }

func (b *backupsPane) keys() []key.Binding {
	switch b.mode {
	case backupAsk, backupConfirm, restoreAsk:
		return backupAskKeys
	case restorePreview:
		if b.armed {
			return []key.Binding{hint("enter", "confirm restore"), hint("esc", "cancel")}
		}
		return restorePreviewKey
	}
	return backupsKeys
}

func (b *backupsPane) apply(msg backupsMsg) {
	b.loaded, b.err = true, ""
	if msg.err != nil {
		b.err = msg.err.Error()
		return
	}
	b.list = msg.list
	b.cursor = max(min(b.cursor, len(b.list)-1), 0)
}

// opened handles the manifest of the archive being restored: the preview, or
// the reason the passphrase did not open it.
func (b *backupsPane) opened(msg backupAppsMsg) {
	if b.mode != restoreAsk || !b.opening || msg.file != b.file.Path {
		return
	}
	b.opening = false
	if msg.err != nil {
		b.promptErr = msg.err.Error()
		b.input.SetValue("")
		return
	}
	b.apps, b.mode, b.scope, b.scopeOffset, b.armed = msg.apps, restorePreview, 0, 0, false
}

// reset returns to the list and forgets the passphrase.
func (b *backupsPane) reset() {
	b.mode, b.opening, b.armed = backupList, false, false
	b.pass, b.promptErr = "", ""
	b.apps, b.scope = nil, 0
	b.input.SetValue("")
}

func (b *backupsPane) key(ctx *viewContext, msg tea.KeyPressMsg) tea.Cmd {
	switch {
	case key.Matches(msg, ctx.keys.Up):
		b.cursor = max(b.cursor-1, 0)
	case key.Matches(msg, ctx.keys.Down):
		b.cursor = max(min(b.cursor+1, len(b.list)-1), 0)
	case msg.String() == "b":
		if ctx.tasks.running() > 0 {
			ctx.setFlash(waitToBackUp, levelWarn)
			return nil
		}
		b.mode = backupAsk
		return b.askPassphrase(ctx)
	case msg.String() == "enter" && len(b.list) > 0:
		if ctx.tasks.running() > 0 {
			ctx.setFlash(waitToBackUp, levelWarn)
			return nil
		}
		b.file, b.armed = b.list[b.cursor], false
		if !b.file.Encrypted {
			b.apps, b.mode, b.scope, b.scopeOffset = b.file.Apps, restorePreview, 0, 0
			return nil
		}
		b.mode = restoreAsk
		return b.askPassphrase(ctx)
	}
	return nil
}

func (b *backupsPane) askPassphrase(ctx *viewContext) tea.Cmd {
	b.input = textinput.New()
	b.input.Prompt = ""
	b.input.EchoMode = textinput.EchoPassword
	b.input.EchoCharacter = '•'
	b.input.SetWidth(max(min(ctx.width-24, 40), 20))
	b.input.Focus()
	b.promptErr = ""
	return textinput.Blink
}

func (b *backupsPane) modalKey(ctx *viewContext, msg tea.KeyPressMsg) tea.Cmd {
	if msg.String() == "esc" {
		b.reset()
		return nil
	}
	switch b.mode {
	case backupAsk:
		if msg.String() == "enter" {
			if b.input.Value() == "" {
				b.reset()
				return ctx.run(Request{Action: ActionBackup}, "backup")
			}
			b.pass, b.mode, b.promptErr = b.input.Value(), backupConfirm, ""
			b.input.SetValue("")
			return nil
		}
	case backupConfirm:
		if msg.String() == "enter" {
			if b.input.Value() != b.pass {
				b.pass, b.mode, b.promptErr = "", backupAsk, "The two entries differ, so nothing was backed up. Start again."
				b.input.SetValue("")
				return nil
			}
			req := Request{Action: ActionBackup, Passphrase: b.pass}
			b.reset()
			return ctx.run(req, "backup")
		}
	case restoreAsk:
		if b.opening {
			return nil
		}
		if msg.String() == "enter" {
			if b.input.Value() == "" {
				b.promptErr = "enter the passphrase"
				return nil
			}
			b.pass, b.opening, b.promptErr = b.input.Value(), true, ""
			return loadBackupApps(ctx.backend, b.file.Path, b.pass)
		}
	case restorePreview:
		return b.previewKey(ctx, msg)
	}
	var cmd tea.Cmd
	b.input, cmd = b.input.Update(msg)
	return cmd
}

// previewKey moves between the Whole Project and each App; enter arms the
// restore and a second enter runs it.
func (b *backupsPane) previewKey(ctx *viewContext, msg tea.KeyPressMsg) tea.Cmd {
	switch {
	case key.Matches(msg, ctx.keys.Up):
		b.scope, b.armed = max(b.scope-1, 0), false
	case key.Matches(msg, ctx.keys.Down):
		b.scope, b.armed = min(b.scope+1, len(b.apps)), false
	case msg.String() == "enter":
		if !b.armed {
			b.armed = true
			return nil
		}
		if ctx.tasks.running() > 0 {
			b.reset()
			ctx.setFlash(waitToBackUp, levelWarn)
			return nil
		}
		req := Request{Action: ActionRestore, File: b.file.Path, Passphrase: b.pass}
		title := "restore all from " + b.file.Name
		if b.scope > 0 {
			req.IDs = []string{b.apps[b.scope-1]}
			title = "restore " + req.IDs[0] + " from " + b.file.Name
		}
		b.reset()
		return ctx.run(req, title)
	}
	return nil
}

// scopeName is what a scope choice restores.
func (b *backupsPane) scopeName(scope int) string {
	if scope == 0 {
		return "Whole Project"
	}
	return b.apps[scope-1]
}

func (b *backupsPane) box(ctx *viewContext, width, height int) string {
	avail := max(height-3, 3)
	switch b.mode {
	case backupAsk, backupConfirm, restoreAsk:
		return b.promptBox(ctx, width)
	case restorePreview:
		return b.previewBox(ctx, width, avail)
	}
	return b.listBox(ctx, width, avail)
}

func (b *backupsPane) listBox(ctx *viewContext, width, avail int) string {
	t := ctx.theme
	inner := max(width-4, 12)
	var lines []string
	note := ""
	switch {
	case b.err != "":
		lines = []string{t.fg(t.fail).Render(b.err)}
	case !b.loaded:
		lines = []string{"  " + t.dim().Render("Looking for backups…")}
	case len(b.list) == 0:
		lines = []string{"  " + t.dim().Render("No backups yet. Press b to back up now.")}
	default:
		window := max(avail-4, 1)
		b.offset = scrolled(b.cursor, b.offset, window, len(b.list))
		lines = append(lines, truncate("  "+t.dim().Render(pad("Date", 18)+pad("Size", 10)+pad("Encrypted", 17)+"Apps"), inner))
		for i := b.offset; i < b.offset+window && i < len(b.list); i++ {
			lines = append(lines, b.row(ctx, i, inner))
		}
		note = strconv.Itoa(len(b.list)) + " archives"
		if len(b.list) == 1 {
			note = "1 archive"
		}
	}
	foot := t.dim().Render("A backup holds configuration, databases and secrets, not media.")
	if ctx.tasks.running() > 0 {
		foot = t.fg(t.warn).Render(waitToBackUp + ".")
	}
	lines = append(lines, "", "  "+foot)
	return t.box("Backups", note, strings.Join(lines, "\n"), width, len(lines)+2, true)
}

func (b *backupsPane) row(ctx *viewContext, i, width int) string {
	t := ctx.theme
	info := b.list[i]
	cursor, date := "  ", t.body()
	if i == b.cursor {
		cursor, date = t.cursor(), t.active()
	}
	enc := t.fg(t.warn).Render(pad("! not encrypted", 17))
	if info.Encrypted {
		enc = t.fg(t.ok).Render(pad("✓ encrypted", 17))
	}
	apps := t.dim().Render("passphrase needed to list Apps")
	if !info.Encrypted {
		apps = t.body().Render(strings.Join(info.Apps, ", "))
	}
	return truncate(cursor+date.Render(pad(info.Created.Local().Format("2006-01-02 15:04"), 18))+
		t.body().Render(pad(service.HumanSize(info.Size), 10))+enc+apps, width)
}

// promptBox asks for a passphrase, for a new backup or for an archive that
// is encrypted. The input shows dots only.
func (b *backupsPane) promptBox(ctx *viewContext, width int) string {
	t := ctx.theme
	var lines []string
	switch b.mode {
	case backupAsk:
		lines = []string{
			"  " + t.heading().Render("Back up now"),
			"  " + t.body().Render("Passphrase (optional; leave empty for no encryption)"),
		}
	case backupConfirm:
		lines = []string{
			"  " + t.heading().Render("Back up now"),
			"  " + t.body().Render("Type it again:"),
		}
	default:
		lines = []string{
			"  " + t.heading().Render("Restore from "+b.file.Name),
			"  " + t.body().Render("This backup is encrypted. Passphrase:"),
		}
	}
	line := "  " + b.input.View()
	if b.opening {
		line += t.dim().Render("  opening…")
	}
	lines = append(lines, line)
	if b.promptErr != "" {
		lines = append(lines, "  "+t.fg(t.fail).Render(b.promptErr))
	}
	if b.mode == backupAsk {
		lines = append(lines, "", "  "+t.dim().Render("Without a passphrase the archive holds your passwords and API keys in the clear."),
			"  "+t.dim().Render("An encrypted backup cannot be restored without its passphrase."))
	}
	return t.box("Backups", "", strings.Join(lines, "\n"), width, len(lines)+2, true)
}

// previewBox offers the whole Project or one App of the archive, and what
// restoring it will do.
func (b *backupsPane) previewBox(ctx *viewContext, width, avail int) string {
	t := ctx.theme
	inner := max(width-4, 12)
	lines := []string{
		"  " + t.heading().Render("Restore from "+b.file.Name),
		"  " + t.dim().Render(b.file.Created.Local().Format("2006-01-02 15:04")+" · "+service.HumanSize(b.file.Size)),
		"",
	}
	choices := 1 + len(b.apps)
	window := max(min(choices, avail-7), 1)
	b.scopeOffset = scrolled(b.scope, b.scopeOffset, window, choices)
	for i := b.scopeOffset; i < b.scopeOffset+window && i < choices; i++ {
		line := radioRow(t, i == b.scope, i == b.scope, b.scopeName(i))
		if i == 0 {
			line += t.dim().Render("  " + strings.Join(b.apps, ", "))
		}
		lines = append(lines, truncate(line, inner))
	}
	plan := "Restores every App in this backup: replaces their folders, secrets and state, then starts them."
	confirm := "Press enter again to restore every App in this backup. Their current folders, secrets and state are replaced."
	if b.scope > 0 {
		id := b.apps[b.scope-1]
		plan = "Restores " + id + ": replaces apps/" + id + "/, its secrets and state, then starts it."
		confirm = "Press enter again to restore " + id + ". Its current apps/" + id + "/, secrets and state are replaced."
	}
	text, style := plan, t.body()
	if b.armed {
		text, style = confirm, t.fg(t.fail)
	}
	lines = append(lines, "")
	for _, line := range strings.Split(wrap(text, inner-2), "\n") {
		lines = append(lines, "  "+style.Render(line))
	}
	return t.box("Backups", "", strings.Join(lines, "\n"), width, len(lines)+2, true)
}

// BarMode is the bar's mode text while the restore preview holds the keys;
// they are choices, not typing.
func (v *settingsView) BarMode(t theme) string {
	if v.tab != tabBackups || v.backups.mode != restorePreview {
		return ""
	}
	return t.fg(t.accentText).Bold(true).Render("restore") + t.dim().Render(" · enter twice to run")
}
