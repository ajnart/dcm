package app_test

import (
	"context"
	"errors"
	"reflect"
	"testing"

	"github.com/ajnart/self-host/internal/app"
	"github.com/ajnart/self-host/internal/events"
	"github.com/ajnart/self-host/internal/helpers"
)

type secrets map[string]string

func (s secrets) Get(key string) string       { return s[key] }
func (s secrets) Set(key, value string) error { s[key] = value; return nil }

type observed struct {
	results []helpers.StepResult
	events  []events.Event
}

func newPair(t *testing.T) (*helpers.H, *helpers.H, *observed) {
	t.Helper()
	o := &observed{}
	log := events.New(events.SinkFunc(func(e events.Event) { o.events = append(o.events, e) }))
	build := func(name, url string) *helpers.H {
		return helpers.New(helpers.Config{
			App: name, Service: name, URL: url, Log: log,
			Secrets: secrets{"ADMIN_USER": "admin", "ADMIN_PASSWORD": "pw"},
			Record:  func(r helpers.StepResult) { o.results = append(o.results, r) },
		})
	}
	return build("sonarr", "http://sonarr.test"), build("qbittorrent", "http://qb.test"), o
}

func TestLinkApplyRunsOneAdminStepUnderItsID(t *testing.T) {
	from, to, o := newPair(t)
	var calls []string
	linked := false
	link := app.NewLink("link-qbittorrent", "qbittorrent", "download client: qBittorrent", app.LinkStep{
		Message: "use qBittorrent as the download client",
		Check: func(context.Context, *helpers.H, *helpers.H) (bool, error) {
			calls = append(calls, "check")
			return linked, nil
		},
		Do: func(_ context.Context, _, _ *helpers.H) error {
			calls = append(calls, "do")
			linked = true
			return nil
		},
		Hint: func(from, to *helpers.H) string { return "open " + from.URL + " then " + to.URL },
	}, nil)

	if link.ID != "link-qbittorrent" || link.Target != "qbittorrent" || link.Title != "download client: qBittorrent" {
		t.Fatalf("identity not carried: %+v", link)
	}
	if link.Remove != nil {
		t.Fatal("a Link declared without a removal step must have no Remove")
	}
	if err := link.Apply(context.Background(), from, to); err != nil {
		t.Fatal(err)
	}
	if want := []string{"check", "do", "check"}; !reflect.DeepEqual(calls, want) {
		t.Errorf("calls = %v, want %v", calls, want)
	}
	want := []helpers.StepResult{{ID: "link-qbittorrent", Status: "ok", Msg: "use qBittorrent as the download client"}}
	if !reflect.DeepEqual(o.results, want) {
		t.Errorf("results = %+v, want %+v", o.results, want)
	}
}

func TestLinkApplySkipsWhenAlreadyLinked(t *testing.T) {
	from, to, o := newPair(t)
	link := app.NewLink("link-x", "x", "t", app.LinkStep{
		Message: "m",
		Check:   func(context.Context, *helpers.H, *helpers.H) (bool, error) { return true, nil },
		Do:      func(context.Context, *helpers.H, *helpers.H) error { t.Fatal("Do must not run"); return nil },
	}, nil)
	if err := link.Apply(context.Background(), from, to); err != nil {
		t.Fatal(err)
	}
	if len(o.results) != 1 || o.results[0].Status != "skip" || o.results[0].ID != "link-x" {
		t.Errorf("results = %+v, want one skip", o.results)
	}
}

func TestLinkApplyFailureCarriesHintAndAdminCredential(t *testing.T) {
	from, to, o := newPair(t)
	link := app.NewLink("link-x", "x", "t", app.LinkStep{
		Message: "m",
		Check:   func(context.Context, *helpers.H, *helpers.H) (bool, error) { return false, nil },
		Do:      func(context.Context, *helpers.H, *helpers.H) error { return errors.New("boom") },
		Hint:    func(from, to *helpers.H) string { return "open " + from.URL + " and " + to.URL },
	}, nil)
	err := link.Apply(context.Background(), from, to)
	if !errors.Is(err, helpers.ErrStepFailed) {
		t.Fatalf("err = %v, want ErrStepFailed", err)
	}
	last := o.events[len(o.events)-1]
	if last.Event != events.StepFail || last.App != "sonarr" || last.Step != "link-x" ||
		last.Credential != "admin" || last.Hint != "open http://sonarr.test and http://qb.test" {
		t.Errorf("failure event = %+v", last)
	}
	if o.results[0].Hint != last.Hint {
		t.Errorf("recorded hint %q differs from event hint %q", o.results[0].Hint, last.Hint)
	}
}

func TestLinkRemoveIsASeparateUnPrefixedStep(t *testing.T) {
	from, to, o := newPair(t)
	present := true
	link := app.NewLink("link-qbittorrent", "qbittorrent", "t",
		app.LinkStep{
			Message: "add",
			Check:   func(context.Context, *helpers.H, *helpers.H) (bool, error) { return present, nil },
		},
		&app.LinkStep{
			Message: "remove the qBittorrent download client",
			Check:   func(context.Context, *helpers.H, *helpers.H) (bool, error) { return !present, nil },
			Do: func(context.Context, *helpers.H, *helpers.H) error {
				present = false
				return nil
			},
			Hint: func(from, _ *helpers.H) string { return "delete it in " + from.URL },
		})
	if link.Remove == nil {
		t.Fatal("Remove missing")
	}
	if err := link.Remove(context.Background(), from, to); err != nil {
		t.Fatal(err)
	}
	want := []helpers.StepResult{{ID: "unlink-qbittorrent", Status: "ok", Msg: "remove the qBittorrent download client"}}
	if !reflect.DeepEqual(o.results, want) {
		t.Errorf("results = %+v, want %+v", o.results, want)
	}
	if present {
		t.Error("Do did not run")
	}
}

func TestAbsentInvertsACheckAndKeepsItsError(t *testing.T) {
	boom := errors.New("boom")
	check := func(found bool, err error) app.LinkCheck {
		return func(context.Context, *helpers.H, *helpers.H) (bool, error) { return found, err }
	}
	if got, err := app.Absent(check(true, nil))(context.Background(), nil, nil); got || err != nil {
		t.Errorf("present item: got %v, %v", got, err)
	}
	if got, err := app.Absent(check(false, nil))(context.Background(), nil, nil); !got || err != nil {
		t.Errorf("missing item: got %v, %v", got, err)
	}
	if _, err := app.Absent(check(false, boom))(context.Background(), nil, nil); !errors.Is(err, boom) {
		t.Errorf("err = %v, want boom", err)
	}
}
