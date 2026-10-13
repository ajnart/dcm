package tui

import (
	"errors"
	"io/fs"
	"slices"
	"strings"
	"testing"

	"github.com/ajnart/self-host/internal/systemtest"
)

func pickerFor(folders *systemtest.Folders) *folderPicker {
	return &folderPicker{home: "/home/alice", list: folders.List}
}

func TestFolderPickerListsTheFoldersInsideTheTypedPath(t *testing.T) {
	folders := &systemtest.Folders{}
	folders.Add("/", "media", "mnt", "srv")
	folders.Add("/media", "movies", "music", "tv")
	picker := pickerFor(folders)

	for typed, want := range map[string][]string{
		"/media/":   {"/media/movies/", "/media/music/", "/media/tv/"},
		"/media/t":  {"/media/tv/"},
		"/media/T":  nil,
		"/m":        {"/media/", "/mnt/"},
		"/media/mo": {"/media/movies/"},
		"/media/x":  nil,
		"media":     nil,
		"":          nil,
	} {
		got := picker.suggestions(typed)
		if !slices.Equal(got, want) {
			t.Errorf("suggestions(%q) = %q, want %q", typed, got, want)
		}
	}
}

func TestFolderPickerMatchesCapitalLettersAsTyped(t *testing.T) {
	folders := &systemtest.Folders{}
	folders.Add("/media", "Tv", "tv")
	picker := pickerFor(folders)
	if got := picker.suggestions("/media/T"); !slices.Equal(got, []string{"/media/Tv/"}) {
		t.Fatalf("suggestions(/media/T) = %q", got)
	}
	if got := picker.suggestions("/media/t"); !slices.Equal(got, []string{"/media/tv/"}) {
		t.Fatalf("suggestions(/media/t) = %q", got)
	}
}

func TestFolderPickerListsAFewNamesAndCountsTheRest(t *testing.T) {
	folders := &systemtest.Folders{}
	folders.Add("/media", "anime", "books", "comics", "docs", "films", "games", "music", "tv")
	picker := pickerFor(folders)

	got := picker.listing("/media/", 76, 2)
	if want := []string{"In /media/: anime  books  comics  docs  films  games  +2 more"}; !slices.Equal(got, want) {
		t.Fatalf("listing = %q, want %q", got, want)
	}
	if got := picker.listing("/media/m", 76, 2); !slices.Equal(got, []string{"In /media/: music"}) {
		t.Fatalf("a partial name should list what matches, got %q", got)
	}
	if got := picker.listing("/media/x", 76, 2); got != nil {
		t.Fatalf("no match should list nothing, got %q", got)
	}
	if got := picker.listing("/media/", 30, 2); len(got) > 2 {
		t.Fatalf("listing must fit its lines, got %q", got)
	}
}

func TestFolderPickerReadsADirectoryOncePerTypedPath(t *testing.T) {
	folders := &systemtest.Folders{}
	folders.Add("/media", "movies")
	picker := pickerFor(folders)
	for range 3 {
		picker.listing("/media/", 76, 2)
		picker.suggestions("/media/")
	}
	if calls := folders.Calls(); len(calls) != 1 {
		t.Fatalf("redraws should reuse the listing, calls %q", calls)
	}
}

func TestFolderPickerOffersTheCommonPrefixFirst(t *testing.T) {
	folders := &systemtest.Folders{}
	folders.Add("/media", "movies", "movies-4k", "music")
	got := pickerFor(folders).suggestions("/media/mo")
	want := []string{"/media/movies", "/media/movies/", "/media/movies-4k/"}
	if !slices.Equal(got, want) {
		t.Fatalf("suggestions = %q, want %q", got, want)
	}
}

func TestFolderPickerHidesDotFoldersUntilTheyAreTyped(t *testing.T) {
	folders := &systemtest.Folders{}
	folders.Add("/srv", ".cache", "media")
	picker := pickerFor(folders)
	if got := picker.suggestions("/srv/"); !slices.Equal(got, []string{"/srv/media/"}) {
		t.Fatalf("suggestions = %q", got)
	}
	if got := picker.suggestions("/srv/."); !slices.Equal(got, []string{"/srv/.cache/"}) {
		t.Fatalf("suggestions = %q", got)
	}
}

func TestFolderPickerExpandsTilde(t *testing.T) {
	folders := &systemtest.Folders{}
	folders.Add("/home/alice", "Videos", "Music")
	picker := pickerFor(folders)

	if got := picker.suggestions("~"); !slices.Equal(got, []string{"~/"}) {
		t.Fatalf("suggestions(~) = %q", got)
	}
	if got := picker.suggestions("~/V"); !slices.Equal(got, []string{"~/Videos/"}) {
		t.Fatalf("suggestions(~/V) = %q", got)
	}
	for typed, want := range map[string]string{"~": "/home/alice", "~/media": "/home/alice/media", "/srv/~": "/srv/~", "~bob": "~bob"} {
		if got := picker.expand(typed); got != want {
			t.Errorf("expand(%q) = %q, want %q", typed, got, want)
		}
	}
	if err := picker.validate("~/media"); err != nil {
		t.Fatalf("a folder under ~ should validate once expanded: %v", err)
	}
}

func TestFolderPickerStaysSilentWhenTheParentIsMissingOrUnreadable(t *testing.T) {
	folders := &systemtest.Folders{}
	folders.Add("/", "srv")
	folders.Deny("/srv")
	picker := pickerFor(folders)

	if got := picker.suggestions("/nowhere/x"); got != nil {
		t.Fatalf("a missing parent should list nothing, got %q", got)
	}
	if got := picker.suggestions("/srv/"); got != nil {
		t.Fatalf("an unreadable folder should list nothing, got %q", got)
	}
	if _, err := folders.List("/srv"); !errors.Is(err, fs.ErrPermission) {
		t.Fatalf("the fake should deny /srv, got %v", err)
	}
}

func TestWhereFoldersCompleteWithTabAndCycleWithArrows(t *testing.T) {
	m, backend := freshHost(t)
	backend.folders = &systemtest.Folders{}
	backend.folders.Add("/", "media", "mnt")
	backend.folders.Add("/media", "movies", "movies-4k", "music")
	m = drive(t, m, press("enter"))
	m = drive(t, m, press("down"))
	m = drive(t, m, press("down"))
	m = drive(t, m, press("x")) // Jellyfin
	m = drive(t, m, press("enter"))
	m = drive(t, m, press("enter")) // its server name
	for range 4 {
		m = drive(t, m, press("enter"))
	}
	m = drive(t, m, press("ctrl+u"))
	typed := func(text string) {
		for _, r := range text {
			m = drive(t, m, press(string(r)))
		}
	}

	typed("/med")
	m = drive(t, m, press("tab"))
	if got := m.onboarding.answers.media; got != "/media/" {
		t.Fatalf("tab should descend into the folder, media %q\n%s", got, screen(m))
	}
	typed("mo")
	m = drive(t, m, press("tab"))
	if got := m.onboarding.answers.media; got != "/media/movies" {
		t.Fatalf("tab should complete the common prefix, media %q\n%s", got, screen(m))
	}
	m = drive(t, m, press("ctrl+u"))
	typed("/media/")
	m = drive(t, m, press("down"))
	m = drive(t, m, press("down"))
	m = drive(t, m, press("tab"))
	if got := m.onboarding.answers.media; got != "/media/movies-4k/" {
		t.Fatalf("down should move to the next folder, media %q\n%s", got, screen(m))
	}
	m = drive(t, m, press("enter"))
	if got := m.onboarding.focusedKey(); got != whereDownloads {
		t.Fatalf("enter should accept the folder and move on, focused %q\n%s", got, screen(m))
	}
}

func TestWhereFolderTabMovesOnWhenThereIsNothingToComplete(t *testing.T) {
	m, backend := atWhereMedia(t)
	backend.folders.Add("/media", "tv")
	m = drive(t, m, press("ctrl+u"))
	for _, r := range "/media/T" {
		m = drive(t, m, press(string(r)))
	}
	m = drive(t, m, press("tab"))
	if got := m.onboarding.answers.media; got != "/media/T" {
		t.Fatalf("a different capital letter must not complete, media %q", got)
	}
	if got := m.onboarding.focusedKey(); got != whereDownloads {
		t.Fatalf("tab with nothing to complete should move on, focused %q\n%s", got, screen(m))
	}
}

func TestWhereFoldersListTheFoldersInsideTheTypedPath(t *testing.T) {
	for _, size := range []struct {
		suffix        string
		width, height int
	}{{"", 120, 30}, {"-narrow", 80, 24}} {
		m, backend := atWhereMediaSized(t, size.width, size.height)
		backend.folders.Add("/media", "anime", "books", "comics", "docs", "films", "games", "music", "tv")
		m = drive(t, m, press("ctrl+u"))
		for _, r := range "/media/" {
			m = drive(t, m, press(string(r)))
		}
		out := screen(m)
		if !strings.Contains(out, "In /media/: anime  books  comics  docs  films  games  +2 more") {
			t.Fatalf("the folders inside the path should be listed\n%s", out)
		}
		golden(t, "onboarding-where-folders"+size.suffix, trimLines(out))
	}
}

func atWhereMedia(t *testing.T) (Model, *fakeBackend) {
	t.Helper()
	return atWhereMediaSized(t, 120, 40)
}

func atWhereMediaSized(t *testing.T, width, height int) (Model, *fakeBackend) {
	t.Helper()
	m, backend := onboardingHost(t, width, height, readyChecks...)
	m = frames(t, m, introFrames)
	backend.folders = &systemtest.Folders{}
	backend.folders.Add("/", "media", "mnt")
	m = drive(t, m, press("enter"))
	m = drive(t, m, press("down"))
	m = drive(t, m, press("down"))
	m = drive(t, m, press("x")) // Jellyfin
	m = drive(t, m, press("enter"))
	m = drive(t, m, press("enter")) // its server name
	for range 4 {
		m = drive(t, m, press("enter"))
	}
	return m, backend
}
