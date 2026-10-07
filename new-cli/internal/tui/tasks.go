package tui

import (
	"context"
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

	mu     sync.Mutex
	state  taskState
	err    string
	events []events.Event
}

func (t *task) append(e events.Event) {
	t.mu.Lock()
	defer t.mu.Unlock()
	t.events = append(t.events, e)
}

type taskSnapshot struct {
	id     int
	title  string
	state  taskState
	err    string
	events []events.Event
}

func (t *task) snapshot() taskSnapshot {
	t.mu.Lock()
	defer t.mu.Unlock()
	return taskSnapshot{id: t.id, title: t.title, state: t.state, err: t.err, events: append([]events.Event(nil), t.events...)}
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
