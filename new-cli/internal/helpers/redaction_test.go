package helpers_test

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"testing"

	"github.com/ajnart/self-host/internal/helpers"
)

func TestStepRedactsRecordsAndReturnedFailure(t *testing.T) {
	for _, outcome := range []string{"ok", "skip", "fail"} {
		t.Run(outcome, func(t *testing.T) {
			var records []helpers.StepResult
			h := newH(t, nil, nil, &records)
			h.Log.Secret("synthetic-password")
			cause := errors.New("refused synthetic-password")
			spec := helpers.StepSpec{Hint: "retry synthetic-password"}
			switch outcome {
			case "skip":
				spec.Check = func(context.Context) (bool, error) { return true, nil }
			case "fail":
				spec.Do = func(context.Context) error { return cause }
			}
			err := h.Step(context.Background(), "login", "login synthetic-password", spec)
			if len(records) != 1 || strings.Contains(fmt.Sprint(records), "synthetic-password") {
				t.Fatalf("credential reached recorder: %+v", records)
			}
			if outcome == "fail" {
				if err == nil || strings.Contains(err.Error(), "synthetic-password") || !errors.Is(err, cause) || !errors.Is(err, helpers.ErrStepFailed) {
					t.Fatalf("failure not redacted or cause lost: %v", err)
				}
			}
		})
	}
}
