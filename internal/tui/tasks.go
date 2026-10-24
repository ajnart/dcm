package tui

import (
	"context"
	"strings"
	"sync"
	"time"

	"github.com/ajnart/self-host/internal/events"
)

type taskState int

const (
	taskRunning taskState = iota
	taskOK
	taskFailed
	taskCancelled
)

type task struct {
	id      int
	title   string
	started time.Time
	cancel  context.CancelFunc
	ctx     context.Context

	mu        sync.Mutex
	state     taskState
	err       string
	events    []events.Event
	persisted bool
	exited    bool
}

func (t *task) append(e events.Event) {
	t.mu.Lock()
	defer t.mu.Unlock()
	t.events = append(t.events, e)
}

type taskSnapshot struct {
	id        int
	title     string
	state     taskState
	err       string
	events    []events.Event
	persisted bool
}

func (t *task) snapshot() taskSnapshot {
	t.mu.Lock()
	defer t.mu.Unlock()
	return taskSnapshot{id: t.id, title: t.title, state: t.state, err: t.err, events: append([]events.Event(nil), t.events...), persisted: t.persisted}
}

// taskManager is shared by every copy of the Model.
type taskManager struct {
	mu     sync.Mutex
	nextID int
	lastID int
	tasks  []*task
}

func (m *taskManager) start(title string) *task {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.nextID++
	ctx, cancel := context.WithCancel(context.Background())
	t := &task{id: m.nextID, title: title, started: time.Now(), ctx: ctx, cancel: cancel}
	m.tasks = append(m.tasks, t)
	m.lastID = t.id
	return t
}

func (m *taskManager) finish(id int, err error) {
	t := m.get(id)
	if t == nil {
		return
	}
	t.mu.Lock()
	defer t.mu.Unlock()
	switch {
	case t.ctx.Err() != nil:
		t.state = taskCancelled
	case err != nil:
		t.state, t.err = taskFailed, err.Error()
	default:
		t.state = taskOK
	}
}

func (m *taskManager) get(id int) *task {
	m.mu.Lock()
	defer m.mu.Unlock()
	for _, t := range m.tasks {
		if t.id == id {
			return t
		}
	}
	return nil
}

// latest is the most recently started task, the one the footer follows.
func (m *taskManager) latest() *task {
	m.mu.Lock()
	id := m.lastID
	m.mu.Unlock()
	return m.get(id)
}

func (m *taskManager) snapshots() []taskSnapshot {
	m.mu.Lock()
	tasks := append([]*task(nil), m.tasks...)
	m.mu.Unlock()
	out := make([]taskSnapshot, len(tasks))
	for i, t := range tasks {
		out[i] = t.snapshot()
	}
	return out
}

// terminalIDs captures tasks whose mutations finished before a status read.
func (m *taskManager) terminalIDs() []int {
	var ids []int
	for _, task := range m.snapshots() {
		if task.state != taskRunning {
			ids = append(ids, task.id)
		}
	}
	return ids
}

// acknowledge keeps footer history but lets refreshed status own these steps.
func (m *taskManager) acknowledge(ids []int) {
	for _, id := range ids {
		if task := m.get(id); task != nil {
			task.mu.Lock()
			task.persisted = true
			task.mu.Unlock()
		}
	}
}

func (m *taskManager) running() int {
	n := 0
	for _, s := range m.snapshots() {
		if s.state == taskRunning {
			n++
		}
	}
	return n
}

func (m *taskManager) cancelAll() {
	m.mu.Lock()
	defer m.mu.Unlock()
	for _, t := range m.tasks {
		t.cancel()
	}
}

// quitGrace is how long quitting waits for cancelled Actions to exit.
const quitGrace = 10 * time.Second

func (m *taskManager) markExited(id int) {
	if t := m.get(id); t != nil {
		t.mu.Lock()
		t.exited = true
		t.mu.Unlock()
	}
}

func (m *taskManager) active() int {
	m.mu.Lock()
	tasks := append([]*task(nil), m.tasks...)
	m.mu.Unlock()
	n := 0
	for _, t := range tasks {
		t.mu.Lock()
		if !t.exited {
			n++
		}
		t.mu.Unlock()
	}
	return n
}

// waitExited blocks until every Action has returned, or the timeout passes.
func (m *taskManager) waitExited(timeout time.Duration) {
	deadline := time.Now().Add(timeout)
	for m.active() > 0 && time.Now().Before(deadline) {
		time.Sleep(25 * time.Millisecond)
	}
}

func (m *taskManager) runningTitle() string {
	for _, s := range m.snapshots() {
		if s.state == taskRunning {
			return s.title
		}
	}
	return "The Action"
}

// interruptedLine is the line printed on exit after running Actions were
// cancelled, or empty when none were.
func (m *taskManager) interruptedLine() string {
	for _, s := range m.snapshots() {
		if s.state != taskRunning {
			continue
		}
		if strings.HasPrefix(s.title, "install") {
			return "Install interrupted; run self-host to resume."
		}
		return "Interrupted: " + s.title + ". Run self-host to check the Project."
	}
	return ""
}
