package app

import (
	"context"

	"github.com/ajnart/self-host/internal/helpers"
)

type LinkCheck func(ctx context.Context, from, to *helpers.H) (bool, error)

type LinkStep struct {
	Message string
	Check   LinkCheck
	Do      func(ctx context.Context, from, to *helpers.H) error
	Hint    func(from, to *helpers.H) string
}

func Absent(linked LinkCheck) LinkCheck {
	return func(ctx context.Context, from, to *helpers.H) (bool, error) {
		found, err := linked(ctx, from, to)
		return !found, err
	}
}

func NewLink(id, target, title string, apply LinkStep, remove *LinkStep) Link {
	link := Link{
		ID:     id,
		Target: target,
		Title:  title,
		Apply: func(ctx context.Context, from, to *helpers.H) error {
			return apply.run(ctx, id, from, to)
		},
	}
	if remove != nil {
		link.Remove = func(ctx context.Context, from, to *helpers.H) error {
			return remove.run(ctx, "un"+id, from, to)
		}
	}
	return link
}

func (s LinkStep) run(ctx context.Context, id string, from, to *helpers.H) error {
	spec := helpers.StepSpec{Credential: "admin"}
	if s.Check != nil {
		spec.Check = func(ctx context.Context) (bool, error) { return s.Check(ctx, from, to) }
	}
	if s.Do != nil {
		spec.Do = func(ctx context.Context) error { return s.Do(ctx, from, to) }
	}
	if s.Hint != nil {
		spec.Hint = s.Hint(from, to)
	}
	return from.Step(ctx, id, s.Message, spec)
}

// Owned is what a Link adds to its consumer. Find returns the IDs of the
// items in the consumer that point at the target, never ones the person
// added for another host; Delete removes one of them.
type Owned struct {
	Find   func(ctx context.Context, from, to *helpers.H) ([]string, error)
	Delete func(ctx context.Context, from, to *helpers.H, id string) error
}

func (o Owned) linked(ctx context.Context, from, to *helpers.H) (bool, error) {
	ids, err := o.Find(ctx, from, to)
	return len(ids) > 0, err
}

func (o Owned) deleteAll(ctx context.Context, from, to *helpers.H) error {
	ids, err := o.Find(ctx, from, to)
	if err != nil {
		return err
	}
	for _, id := range ids {
		if err := o.Delete(ctx, from, to, id); err != nil {
			return err
		}
	}
	return nil
}

// NewOwnedLink is a Link that adds one item to its consumer and, on Remove,
// deletes every item Owned finds. apply needs its Message, Do and Hint (its
// Check defaults to "Owned finds an item"); remove needs only its Message and
// Hint.
func NewOwnedLink(id, target, title string, o Owned, apply, remove LinkStep) Link {
	if apply.Check == nil {
		apply.Check = o.linked
	}
	remove.Check, remove.Do = Absent(o.linked), o.deleteAll
	return NewLink(id, target, title, apply, &remove)
}

// OrderByLinks returns apps with every App after the Apps its Links target,
// keeping the given order otherwise, so a consumer's Setup finds its targets
// ready instead of waiting for them. A Link cycle runs in some order; the
// targets-ready retry after each Setup covers the Link left waiting.
func OrderByLinks(apps []App) []App {
	byID := make(map[string]App, len(apps))
	for _, a := range apps {
		byID[a.Info().ID] = a
	}
	ordered := make([]App, 0, len(apps))
	state := map[string]int{}
	var visit func(App)
	visit = func(a App) {
		id := a.Info().ID
		if state[id] != 0 {
			return
		}
		state[id] = 1
		for _, l := range a.Links() {
			if target, found := byID[l.Target]; found && state[l.Target] == 0 {
				visit(target)
			}
		}
		state[id] = 2
		ordered = append(ordered, a)
	}
	for _, a := range apps {
		visit(a)
	}
	return ordered
}
