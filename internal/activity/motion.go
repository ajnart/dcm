package activity

// FPS is the animation rate: frames advance about every 83 ms.
const FPS = 12

// Motion is the renderer's animation input: the current frame and, by row
// key, the frame at which that row last changed state. A row missing from
// Changed has been still for long, so nothing plays for it.
type Motion struct {
	Frame   int
	Changed map[string]int
}

// since is the number of frames since the row changed.
func (m Motion) since(key string) int {
	at, ok := m.Changed[key]
	if !ok {
		return 1 << 20
	}
	return m.Frame - at
}

// Tracker is the bookkeeping between snapshots and frames, shared by the TUI
// and the terminal sink: it remembers the frame at which each row of the
// Action last changed state, so the model and the renderer stay free of
// clocks. Rows already present at the first observation count as settled.
type Tracker struct {
	states  map[string]State
	changed map[string]int
}

// Observe records the rows of s whose state differs from the last
// observation as changed at frame.
func (t *Tracker) Observe(s Snapshot, frame int) {
	first := t.states == nil
	if first {
		t.states, t.changed = map[string]State{}, map[string]int{}
	}
	for key, state := range rowStates(s.Action) {
		if old, seen := t.states[key]; seen && old == state {
			continue
		}
		t.states[key] = state
		if first {
			delete(t.changed, key)
		} else {
			t.changed[key] = frame
		}
	}
}

// Motion is the renderer input at frame.
func (t *Tracker) Motion(frame int) Motion {
	return Motion{Frame: frame, Changed: t.changed}
}

func rowStates(a Action) map[string]State {
	out := map[string]State{}
	if a.Empty() {
		return out
	}
	out[ActionKey] = NotRun
	switch {
	case a.Running:
		out[ActionKey] = Running
	case a.Finished:
		out[ActionKey] = Done
	}
	for _, app := range a.Apps {
		out[app.Key] = app.State
		for _, step := range app.Steps {
			out[step.Key] = step.State
		}
	}
	for _, link := range a.Links {
		out[link.Key] = link.State
	}
	return out
}
