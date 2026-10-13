package tui

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"

	"charm.land/bubbles/v2/key"
	"charm.land/huh/v2"

	"github.com/ajnart/self-host/internal/system"
)

// maxFolderSuggestions caps what one keystroke suggests, so a huge folder stays quick.
const maxFolderSuggestions = 50

// maxFolderListed is how many names the listing shows before it counts the rest.
const maxFolderListed = 6

// folderKeysHint is the one line every folder field explains its keys with.
const folderKeysHint = "Type or paste a path. Tab completes existing folders; ↑ ↓ choose."

// folderPicker turns a path input into a folder picker: as the person types,
// the input suggests the folders inside the typed path and the screen can
// list them. Any path field can adopt it with input. It remembers the last
// listing, so a redraw does not read the disk again.
type folderPicker struct {
	home string
	list func(dir string) ([]string, error)

	mu     sync.Mutex
	typed  string
	names  []string
	listed bool
}

func newFolderPicker(b Backend) *folderPicker {
	return &folderPicker{home: b.UserHome(), list: b.ListFolders}
}

// folderKeyMap makes Tab complete the suggestion and leaves Enter to accept
// the folder.
func folderKeyMap() *huh.KeyMap {
	keys := huh.NewDefaultKeyMap()
	keys.Input.AcceptSuggestion = key.NewBinding(key.WithKeys("tab"), key.WithHelp("tab", "complete"))
	keys.Input.Next = key.NewBinding(key.WithKeys("enter"), key.WithHelp("enter", "next"))
	return keys
}

// lockedString is a value the suggestions can read while a key press writes it.
type lockedString struct {
	mu    sync.Mutex
	value *string
}

func (l *lockedString) Get() string {
	l.mu.Lock()
	defer l.mu.Unlock()
	return *l.value
}

func (l *lockedString) Set(s string) {
	l.mu.Lock()
	defer l.mu.Unlock()
	*l.value = s
}

// input is a text input over value that suggests folders and accepts only
// folders that exist or sit inside one that does.
func (p *folderPicker) input(value *string) *huh.Input {
	locked := &lockedString{value: value}
	return huh.NewInput().Accessor(locked).Validate(p.validate).
		SuggestionsFunc(func() []string { return p.suggestions(locked.Get()) }, value)
}

func (p *folderPicker) expand(path string) string {
	if p.home == "" {
		return path
	}
	return system.ExpandHome(path, p.home)
}

func (p *folderPicker) validate(path string) error {
	return validFolder(p.expand(path))
}

// split cuts typed at its last slash into the folder to list and what is
// already typed of a name in it.
func split(typed string) (dir, partial string, ok bool) {
	cut := strings.LastIndex(typed, "/")
	if cut < 0 {
		return "", "", false
	}
	return typed[:cut+1], typed[cut+1:], true
}

// matches are the names of the folders that typed continues into, in order.
// Names match as typed, capital letters included, so accepting one never
// yields a path that is not there. Dot folders appear once a dot is typed.
// A missing or unreadable folder lists nothing.
func (p *folderPicker) matches(typed string) []string {
	p.mu.Lock()
	defer p.mu.Unlock()
	if p.listed && p.typed == typed {
		return p.names
	}
	p.typed, p.listed, p.names = typed, true, nil
	dir, partial, ok := split(typed)
	if !ok {
		return nil
	}
	names, err := p.list(filepath.Clean(p.expand(dir)))
	if err != nil {
		return nil
	}
	for _, name := range names {
		if strings.HasPrefix(name, ".") && !strings.HasPrefix(partial, ".") {
			continue
		}
		if strings.HasPrefix(name, partial) {
			p.names = append(p.names, name)
		}
	}
	return p.names
}

// suggestions are the folders that complete typed, each as typed would read
// with the folder's name filled in and a trailing slash, so the next
// keystroke lists what is inside. With several matches, the first suggestion
// is their common prefix.
func (p *folderPicker) suggestions(typed string) []string {
	if typed == "~" && p.home != "" {
		return []string{"~/"}
	}
	dir, partial, ok := split(typed)
	if !ok {
		return nil
	}
	matches := p.matches(typed)
	matches = matches[:min(len(matches), maxFolderSuggestions)]
	var out []string
	if common := commonPrefix(matches); len(matches) > 1 && len(common) > len(partial) {
		out = append(out, dir+common)
	}
	for _, name := range matches {
		out = append(out, dir+name+"/")
	}
	return out
}

// listing is the line that shows the folders inside typed's path, as many
// names as fit in lines lines of width columns, then how many more there are.
// It is empty when there is nothing to list.
func (p *folderPicker) listing(typed string, width, lines int) []string {
	dir, _, ok := split(typed)
	names := p.matches(typed)
	if !ok || len(names) == 0 {
		return nil
	}
	head := "In " + dir + ": "
	for shown := min(len(names), maxFolderListed); shown >= 0; shown-- {
		text := head + strings.Join(names[:shown], "  ")
		if more := len(names) - shown; more > 0 {
			text += fmt.Sprintf("  +%d more", more)
		}
		if shown == 0 {
			text = head + fmt.Sprintf("%d folders", len(names))
		}
		wrapped := strings.Split(wrap(text, width), "\n")
		if len(wrapped) <= lines {
			for i, line := range wrapped {
				wrapped[i] = strings.TrimRight(line, " ")
			}
			return wrapped
		}
	}
	return nil
}

func commonPrefix(names []string) string {
	if len(names) == 0 {
		return ""
	}
	common := names[0]
	for _, name := range names[1:] {
		for !strings.HasPrefix(name, common) {
			common = common[:len(common)-1]
		}
	}
	return common
}

func validFolder(path string) error {
	if !filepath.IsAbs(path) {
		return errors.New("use an absolute path, e.g. /srv/media")
	}
	parent := path
	for {
		if info, err := os.Stat(parent); err == nil {
			if !info.IsDir() {
				return errors.New(parent + " is a file, not a folder")
			}
			return nil
		}
		next := filepath.Dir(parent)
		if next == parent {
			return errors.New("no existing parent folder")
		}
		parent = next
	}
}
