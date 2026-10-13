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
