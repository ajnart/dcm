package tui

import (
	"context"
	"fmt"
	"slices"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/charmbracelet/x/ansi"

	"github.com/ajnart/self-host/internal/backup"
	"github.com/ajnart/self-host/internal/service"
)

const (
	encryptedArchive = "/home/alice/.self-host/backups/selfhost-20261008-231500.tar.zst.age"
	plainArchive     = "/home/alice/.self-host/backups/selfhost-20261001-090000.tar.zst"
	archivePhrase    = "quartz-A1?-horse"
)

func (f *fakeBackend) Backups(context.Context) ([]service.BackupInfo, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.backupLists++
	return f.archives, nil
}

func (f *fakeBackend) BackupApps(_ context.Context, file, passphrase string) ([]string, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	for _, a := range f.archives {
		if a.Path == file && a.Encrypted && passphrase != f.archivePass {
			return nil, backup.ErrPassphrase
		}
	}
	return f.archiveApps[file], nil
}

func (f *fakeBackend) listCalls() int {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.backupLists
}

func (f *fakeBackend) lastRequest(t *testing.T) Request {
	t.Helper()
	f.mu.Lock()
	defer f.mu.Unlock()
	if len(f.requests) == 0 {
		t.Fatal("no Action was dispatched")
	}
	return f.requests[len(f.requests)-1]
}

func (f *fakeBackend) requestCount() int {
	f.mu.Lock()
	defer f.mu.Unlock()
	return len(f.requests)
}

func fakeArchives(backend *fakeBackend) {
	backend.archives = []service.BackupInfo{
		{Path: encryptedArchive, Name: "selfhost-20261008-231500.tar.zst.age", Size: 1258291, Encrypted: true,
			Created: time.Date(2026, 10, 8, 23, 15, 0, 0, time.Local)},
		{Path: plainArchive, Name: "selfhost-20261001-090000.tar.zst", Size: 48230,
			Created: time.Date(2026, 10, 1, 9, 0, 0, 0, time.Local), Apps: []string{"jellyfin", "sonarr", "whoami"}},
	}
	backend.archiveApps = map[string][]string{
		encryptedArchive: {"jellyfin", "sonarr"},
		plainArchive:     {"jellyfin", "sonarr", "whoami"},
	}
	backend.archivePass = archivePhrase
}

// backupsHost is the Backups sub-tab with the two fake archives.
func backupsHost(t *testing.T, width, height int) (Model, *fakeBackend) {
	t.Helper()
	m, backend := sample(t, width, height)
	fakeArchives(backend)
	m = drive(t, m, press("5"))
	m = drive(t, m, press("]"))
	m = drive(t, m, press("]"))
	return m, backend
}

func TestBackupsListShowsDateSizeAndWhetherEachIsEncrypted(t *testing.T) {
	m, _ := backupsHost(t, 120, 30)

	out := screen(m)

	for _, want := range []string{
		"2026-10-08 23:15", "1.2 MB", "✓ encrypted", "passphrase needed to list Apps",
		"2026-10-01 09:00", "47.1 KB", "! not encrypted", "jellyfin, sonarr, whoami",
		"2 archives",
	} {
		if !strings.Contains(out, want) {
			t.Errorf("the list lacks %q\n%s", want, out)
		}
	}
}

func TestBackupsListSaysWhenThereAreNone(t *testing.T) {
	m, _ := sample(t, 120, 30)
	m = drive(t, m, press("5"))
	m = drive(t, m, press("]"))
	m = drive(t, m, press("]"))

	if out := screen(m); !strings.Contains(out, "No backups yet. Press b to back up now.") {
		t.Fatalf("the empty state is not shown\n%s", out)
	}
}

func TestBackUpNowWithAPassphraseDispatchesABackupCarryingIt(t *testing.T) {
	m, backend := backupsHost(t, 120, 30)

	m = drive(t, m, press("b"))
	if out := screen(m); !strings.Contains(out, "Passphrase (optional") {
		t.Fatalf("b should ask for a passphrase\n%s", out)
	}
	if backend.requestCount() != 0 {
		t.Fatal("nothing runs before enter")
	}
	m = typeText(t, m, archivePhrase)
	m = drive(t, m, press("enter"))
	if out := screen(m); !strings.Contains(out, "Type it again:") || backend.requestCount() != 0 {
		t.Fatalf("a non-empty passphrase is asked for twice before anything runs\n%s", out)
	}
	m = typeText(t, m, archivePhrase)
	m = drive(t, m, press("enter"))

	got := backend.lastRequest(t)
	if got.Action != ActionBackup || got.Passphrase != archivePhrase || len(got.IDs) != 0 {
		t.Fatalf("want a whole-Project backup with the passphrase, got %+v", got)
	}
	if m.surface != surfaceActivity {
		t.Fatal("the backup should play in Activity")
	}
}

func TestBackUpNowWithNoPassphraseDispatchesAnUnencryptedBackup(t *testing.T) {
	m, backend := backupsHost(t, 120, 30)

	m = drive(t, m, press("b"))
	m = drive(t, m, press("enter"))

	if strings.Contains(screen(m), "Type it again") {
		t.Fatal("an empty passphrase has no second prompt")
	}
	got := backend.lastRequest(t)
	if got.Action != ActionBackup || got.Passphrase != "" {
		t.Fatalf("want an unencrypted backup, got %+v", got)
	}
}

func TestADifferentSecondEntryDispatchesNothingAndAsksAgainFromTheFirst(t *testing.T) {
	m, backend := backupsHost(t, 120, 30)
	const typo = "quartz-A1?-hoarse"

	m = drive(t, m, press("b"))
	m = typeText(t, m, archivePhrase)
	m = drive(t, m, press("enter"))
	m = typeText(t, m, typo)
	m = drive(t, m, press("enter"))

	out := screen(m)
	if backend.requestCount() != 0 {
		t.Fatalf("a mismatch must dispatch nothing, got %+v", backend.requests)
	}
	if !strings.Contains(out, "The two entries differ") || !strings.Contains(out, "Passphrase (optional") || strings.Contains(out, "Type it again:") {
		t.Fatalf("a mismatch is reported and the first entry is asked again\n%s", out)
	}
	for _, phrase := range []string{archivePhrase, typo} {
		if strings.Contains(out, phrase) {
			t.Fatalf("the screen shows %q\n%s", phrase, out)
		}
	}
	m = typeText(t, m, archivePhrase)
	m = drive(t, m, press("enter"))
	m = typeText(t, m, archivePhrase)
	m = drive(t, m, press("enter"))
	if got := backend.lastRequest(t); got.Action != ActionBackup || got.Passphrase != archivePhrase || backend.requestCount() != 1 {
		t.Fatalf("matching entries after a retry dispatch once, got %+v", backend.requests)
	}
}

func TestBackUpNowCanBeCancelled(t *testing.T) {
	m, backend := backupsHost(t, 120, 30)

	m = drive(t, m, press("b"))
	m = typeText(t, m, "abc")
	m = drive(t, m, press("esc"))

	if backend.requestCount() != 0 || m.surface != surfaceSettings || !strings.Contains(screen(m), "2 archives") {
		t.Fatalf("esc should return to the list\n%s", screen(m))
	}
}

func TestTheBackupPassphraseIsMaskedAndKeysGoToTheInput(t *testing.T) {
	m, _ := backupsHost(t, 120, 30)

	m = drive(t, m, press("b"))
	m = typeText(t, m, archivePhrase)

	out := screen(m)
	if strings.Contains(out, "quartz") || strings.Contains(out, archivePhrase) {
		t.Fatalf("the passphrase is on screen\n%s", out)
	}
	if !strings.Contains(out, strings.Repeat("•", len(archivePhrase))) {
		t.Fatalf("expected one dot per typed character\n%s", out)
	}
	if m.quitting || m.surface != surfaceSettings {
		t.Fatal("q, a, digits and ? are text while typing")
	}
}

// phraseTraces is every place a person or a log could see the passphrase:
// every tab's screen, the status line, and every task's title, error and events.
func phraseTraces(t *testing.T, m Model, phrase string) []string {
	t.Helper()
	var found []string
	for _, tab := range []string{"1", "2", "3", "4", "5"} {
		view := drive(t, m, press(tab))
		if strings.Contains(screen(view), phrase) {
			found = append(found, "screen of tab "+tab)
		}
		if strings.Contains(statusLine(screen(view)), phrase) {
			found = append(found, "status line of tab "+tab)
		}
	}
	for _, task := range m.tasks.snapshots() {
		if strings.Contains(task.title+" "+task.err+" "+fmt.Sprintf("%+v", task.events), phrase) {
			found = append(found, "task "+task.title)
		}
	}
	return found
}

func TestThePassphraseNeverReachesTheScreenStatusLineOrTaskEvents(t *testing.T) {
	m, backend := backupsHost(t, 120, 30)

	m = drive(t, m, press("b"))
	m = typeText(t, m, archivePhrase)
	m = drive(t, m, press("enter"))
	if out := screen(m); strings.Contains(out, archivePhrase) || strings.Contains(statusLine(out), "quartz") {
		t.Fatalf("the first entry leaked onto the screen\n%s", out)
	}
	m = typeText(t, m, archivePhrase)
	if out := screen(m); strings.Contains(out, archivePhrase) || !strings.Contains(out, strings.Repeat("•", len(archivePhrase))) {
		t.Fatalf("the second entry must be masked\n%s", out)
	}
	m = drive(t, m, press("enter"))
	if got := backend.lastRequest(t); got.Passphrase != archivePhrase {
		t.Fatalf("the Service must receive the passphrase, got %+v", got)
	}
	if found := phraseTraces(t, m, archivePhrase); len(found) != 0 {
		t.Fatalf("the backup passphrase leaked into %v", found)
	}

	m = drive(t, m, press("5"))
	m = drive(t, m, press("enter"))
	m = typeText(t, m, archivePhrase)
	m = drive(t, m, press("enter"))
	if out := screen(m); strings.Contains(out, archivePhrase) {
		t.Fatalf("the restore preview shows the passphrase\n%s", out)
	}
	m = drive(t, m, press("enter"))
	m = drive(t, m, press("enter"))
	if got := backend.lastRequest(t); got.Action != ActionRestore || got.Passphrase != archivePhrase {
		t.Fatalf("the Service must receive the restore passphrase, got %+v", got)
	}
	if found := phraseTraces(t, m, archivePhrase); len(found) != 0 {
		t.Fatalf("the restore passphrase leaked into %v", found)
	}
}

func TestAWrongRestorePassphraseIsRefusedAndAsksAgain(t *testing.T) {
	m, backend := backupsHost(t, 120, 30)

	m = drive(t, m, press("enter"))
	if out := screen(m); !strings.Contains(out, "This backup is encrypted. Passphrase:") || strings.Contains(out, "Whole Project") {
		t.Fatalf("an encrypted archive asks for the passphrase before listing Apps\n%s", out)
	}
	m = typeText(t, m, "wrong")
	m = drive(t, m, press("enter"))

	out := screen(m)
	if !strings.Contains(out, "wrong passphrase for this encrypted backup") || strings.Contains(out, "Whole Project") {
		t.Fatalf("the wrong passphrase should be refused\n%s", out)
	}
	m = typeText(t, m, archivePhrase)
	m = drive(t, m, press("enter"))
	if out := screen(m); !strings.Contains(out, "Whole Project") || !strings.Contains(out, "jellyfin") || !strings.Contains(out, "sonarr") {
		t.Fatalf("the right passphrase should open the preview\n%s", out)
	}
	if backend.requestCount() != 0 {
		t.Fatal("opening an archive restores nothing")
	}
}

func TestRestoreNeedsASecondEnterAndDispatchesTheWholeProject(t *testing.T) {
	m, backend := backupsHost(t, 120, 30)

	m = drive(t, m, press("enter"))
	m = typeText(t, m, archivePhrase)
	m = drive(t, m, press("enter"))
	m = drive(t, m, press("enter"))
	if backend.requestCount() != 0 {
		t.Fatal("the first enter must only ask for confirmation")
	}
	if out := screen(m); !strings.Contains(out, "Press enter again to restore every App in this backup") {
		t.Fatalf("the confirmation is not shown\n%s", out)
	}
	m = drive(t, m, press("enter"))

	got := backend.lastRequest(t)
	if got.Action != ActionRestore || got.File != encryptedArchive || len(got.IDs) != 0 || got.Passphrase != archivePhrase {
		t.Fatalf("want the whole archive restored with its passphrase, got %+v", got)
	}
	if m.surface != surfaceActivity {
		t.Fatal("the restore should play in Activity")
	}
}

func TestRestoreOfAPlainArchiveSkipsThePassphraseAndDispatchesOneApp(t *testing.T) {
	m, backend := backupsHost(t, 120, 30)

	m = drive(t, m, press("down"))
	m = drive(t, m, press("enter"))
	out := screen(m)
	if strings.Contains(out, "Passphrase") || !strings.Contains(out, "Whole Project") || !strings.Contains(out, "whoami") {
		t.Fatalf("a plain archive opens the preview at once\n%s", out)
	}
	m = drive(t, m, press("down"))
	m = drive(t, m, press("down"))
	m = drive(t, m, press("enter"))
	if !strings.Contains(screen(m), "Press enter again to restore sonarr") {
		t.Fatalf("the confirmation names the App\n%s", screen(m))
	}
	m = drive(t, m, press("enter"))

	got := backend.lastRequest(t)
	if got.Action != ActionRestore || got.File != plainArchive || !slices.Equal(got.IDs, []string{"sonarr"}) || got.Passphrase != "" {
		t.Fatalf("want sonarr restored from the plain archive, got %+v", got)
	}
	if status := statusLine(screen(m)); !strings.Contains(status, "restore sonarr from selfhost-20261001-090000.tar.zst") {
		t.Fatalf("the status line names the Action: %q", status)
	}
}

func TestMovingOrEscapingDisarmsARestore(t *testing.T) {
	m, backend := backupsHost(t, 120, 30)
	m = drive(t, m, press("down"))
	m = drive(t, m, press("enter"))
	m = drive(t, m, press("enter"))

	m = drive(t, m, press("down"))
	m = drive(t, m, press("enter"))
	if backend.requestCount() != 0 {
		t.Fatal("moving the choice must disarm the restore")
	}
	m = drive(t, m, press("esc"))
	if out := screen(m); backend.requestCount() != 0 || !strings.Contains(out, "2 archives") {
		t.Fatalf("esc should close the preview without restoring\n%s", out)
	}
	m = drive(t, m, press("enter"))
	m = drive(t, m, press("enter"))
	if backend.requestCount() != 0 {
		t.Fatal("a reopened preview must be unarmed")
	}
}

func TestNoKeyDeletesAnArchive(t *testing.T) {
	m, backend := backupsHost(t, 120, 30)

	for _, k := range []string{"d", "D", "x", "X", "delete", "backspace", "r", "m", "u"} {
		m = drive(t, m, press(k))
	}
	m = drive(t, m, press("enter"))
	for _, k := range []string{"d", "D", "x", "X", "backspace", "r", "m", "u"} {
		m = drive(t, m, press(k))
	}

	if backend.requestCount() != 0 {
		t.Fatalf("no key may dispatch anything, got %+v", backend.requests)
	}
	m = drive(t, m, press("esc"))
	out := screen(m)
	if !strings.Contains(out, "2 archives") || !strings.Contains(out, "2026-10-08 23:15") || !strings.Contains(out, "2026-10-01 09:00") {
		t.Fatalf("both archives must remain\n%s", out)
	}
}

func TestBackupAndRestoreWaitForARunningAction(t *testing.T) {
	m, backend := backupsHost(t, 120, 30)
	m.tasks.start("update jellyfin")
	t.Cleanup(m.tasks.cancelAll)

	m = drive(t, m, press("b"))
	if strings.Contains(screen(m), "Passphrase") {
		t.Fatalf("b must not open while an Action runs\n%s", screen(m))
	}
	m = drive(t, m, press("enter"))

	if backend.requestCount() != 0 || strings.Contains(screen(m), "Whole Project") {
		t.Fatalf("restore must wait for the running Action\n%s", screen(m))
	}
	if !strings.Contains(screen(m), "wait for the running Action before backing up or restoring") {
		t.Fatalf("the pane should say why\n%s", screen(m))
	}
}

func TestBackupKeysSayWhyWhileAnActionRuns(t *testing.T) {
	const wait = "wait for the running Action before backing up or restoring"

	m, _ := backupsHost(t, 120, 30)
	m.tasks.start("update jellyfin")
	t.Cleanup(m.tasks.cancelAll)
	for _, k := range []string{"b", "enter"} {
		next := drive(t, m, press(k))
		next = drive(t, next, press(k))
		if status := statusLine(screen(next)); !strings.Contains(status, wait) {
			t.Fatalf("%s should flash why nothing happened, status %q", k, status)
		}
	}

	m, _ = backupsHost(t, 120, 30)
	m = drive(t, m, press("down"))
	m = drive(t, m, press("enter"))
	m = drive(t, m, press("enter"))
	m.tasks.start("update jellyfin")
	t.Cleanup(m.tasks.cancelAll)
	m = drive(t, m, press("enter"))
	if status := statusLine(screen(m)); !strings.Contains(status, wait) {
		t.Fatalf("the restore key should flash why nothing ran, status %q", status)
	}
}

func TestTheListRefreshesWhenABackupFinishes(t *testing.T) {
	m, backend := backupsHost(t, 120, 30)
	before := backend.listCalls()

	m = drive(t, m, press("b"))
	m = drive(t, m, press("enter"))

	if backend.listCalls() <= before || m.tasks.running() != 0 {
		t.Fatal("the archives should be listed again once the backup is done")
	}
}

func TestEveryBackupsStateFitsEightyColumns(t *testing.T) {
	for _, tc := range []struct {
		name  string
		steps []string
	}{
		{"list", nil},
		{"passphrase", []string{"b"}},
		{"passphrase mismatch", []string{"b", "x", "enter", "y", "enter"}},
		{"restore passphrase", []string{"enter"}},
		{"restore preview", []string{"down", "enter"}},
		{"restore armed", []string{"down", "enter", "enter"}},
	} {
		m, _ := backupsHost(t, 80, 24)
		for _, k := range tc.steps {
			m = drive(t, m, press(k))
		}
		for _, line := range strings.Split(screen(m), "\n") {
			if ansi.StringWidth(line) > 80 {
				t.Fatalf("%s: line wider than 80 columns: %q", tc.name, line)
			}
		}
	}
}

func TestALongArchiveListScrollsToKeepTheCursorInView(t *testing.T) {
	m, backend := sample(t, 80, 24)
	for i := 0; i < 30; i++ {
		name := "selfhost-202609" + strconv.Itoa(10+i) + "-090000.tar.zst"
		backend.archives = append(backend.archives, service.BackupInfo{Path: "/p/" + name, Name: name, Size: 1024,
			Created: time.Date(2026, 9, 10+i, 9, 0, 0, 0, time.Local), Apps: []string{"jellyfin"}})
	}
	m = drive(t, m, press("5"))
	m = drive(t, m, press("]"))
	m = drive(t, m, press("]"))

	for range 25 {
		m = drive(t, m, press("down"))
	}

	out := screen(m)
	if !strings.Contains(out, "> 2026-10-05 09:00") || strings.Contains(out, "2026-09-10 09:00") {
		t.Fatalf("the highlighted row should be on screen and the first scrolled off\n%s", out)
	}
}

func TestGoldenBackups(t *testing.T) {
	for _, size := range []struct {
		suffix        string
		width, height int
	}{{"", 120, 30}, {"-narrow", 80, 24}} {
		for _, tc := range []struct {
			name  string
			steps func(t *testing.T, m Model) Model
		}{
			{"list", func(t *testing.T, m Model) Model { return m }},
			{"passphrase", func(t *testing.T, m Model) Model {
				m = drive(t, m, press("b"))
				return typeText(t, m, "hunter2")
			}},
			{"passphrase-again", func(t *testing.T, m Model) Model {
				m = drive(t, m, press("b"))
				m = typeText(t, m, "hunter2")
				m = drive(t, m, press("enter"))
				return typeText(t, m, "hunter")
			}},
			{"passphrase-mismatch", func(t *testing.T, m Model) Model {
				m = drive(t, m, press("b"))
				m = typeText(t, m, "hunter2")
				m = drive(t, m, press("enter"))
				m = typeText(t, m, "hunter")
				return drive(t, m, press("enter"))
			}},
			{"restore", func(t *testing.T, m Model) Model {
				m = drive(t, m, press("down"))
				m = drive(t, m, press("enter"))
				return drive(t, m, press("down"))
			}},
			{"restore-armed", func(t *testing.T, m Model) Model {
				m = drive(t, m, press("enter"))
				m = typeText(t, m, archivePhrase)
				m = drive(t, m, press("enter"))
				return drive(t, m, press("enter"))
			}},
		} {
			t.Run(tc.name+size.suffix, func(t *testing.T) {
				m, _ := backupsHost(t, size.width, size.height)

				m = tc.steps(t, m)

				golden(t, "settings-backups-"+tc.name+size.suffix, trimLines(screen(m)))
			})
		}
	}
}
