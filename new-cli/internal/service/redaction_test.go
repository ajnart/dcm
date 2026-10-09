package service

import (
	"errors"
	"fmt"
	"strings"
	"testing"

	"github.com/ajnart/self-host/internal/events"
	"github.com/ajnart/self-host/internal/helpers"
	"github.com/ajnart/self-host/internal/project"
	stepstatus "github.com/ajnart/self-host/internal/status"
)

func TestRecorderRedactsStageAndCheckDiagnostics(t *testing.T) {
	log := events.Discard()
	log.Secret("synthetic-password")
	ss := &session{s: &Service{Log: log}, state: &project.State{Apps: map[string]*project.AppState{"one": {}}}}
	for _, id := range []string{"start", "check"} {
		ss.recorder("one")(helpers.StepResult{ID: id, Status: stepstatus.StepFail, Msg: "failed synthetic-password", Error: "refused synthetic-password", Hint: "retry synthetic-password"})
	}
	if strings.Contains(fmt.Sprint(ss.state.Apps["one"].Steps), "synthetic-password") {
		t.Fatalf("recorder retained credential: %+v", ss.state.Apps["one"].Steps)
	}
}

func TestFinishRedactsReturnedDiagnostic(t *testing.T) {
	log := events.Discard()
	log.Secret("synthetic-password")
	cause := errors.New("operation refused synthetic-password")
	err := (&Service{Log: log}).finish(cause)
	if strings.Contains(err.Error(), "synthetic-password") || !errors.Is(err, cause) {
		t.Fatalf("finish leaked credential or lost cause: %v", err)
	}
}
