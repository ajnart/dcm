package system

import (
	"context"
	"errors"
	"testing"
	"time"
)

func TestTheResolverRemembersAnAnswerAndAFailureForHalfAMinute(t *testing.T) {
	now := time.Date(2026, 10, 10, 12, 0, 0, 0, time.UTC)
	asked := 0
	r := newResolver()
	r.now = func() time.Time { return now }
	r.lookup = func(_ context.Context, name string) ([]string, error) {
		asked++
		if name == "bad.example" {
			return nil, errors.New("no such host")
		}
		return []string{"192.168.1.20"}, nil
	}
	for _, name := range []string{"a.example", "a.example", "bad.example", "bad.example"} {
		r.LookupHost(context.Background(), name)
	}
	if asked != 2 {
		t.Fatalf("asked %d times, want once per name", asked)
	}

	now = now.Add(31 * time.Second)
	r.LookupHost(context.Background(), "a.example")
	if asked != 3 {
		t.Fatalf("asked %d times, want a fresh lookup after the answer expired", asked)
	}
}
