package events_test

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"strings"
	"testing"

	"github.com/ajnart/self-host/internal/events"
)

func TestRegisteredSecretsRedactDiagnostics(t *testing.T) {
	var out bytes.Buffer
	log := events.New(events.JSON(&out))
	log.Secret("key", "key-extension", "pw")
	text := "login key-extension refused pw"
	log.Emit(events.Event{Event: events.StepFail, Msg: text, Error: text, Hint: text})
	for _, diagnostic := range []string{log.Redact(text), out.String()} {
		if strings.Contains(diagnostic, "key") || strings.Contains(diagnostic, "extension") || strings.Contains(diagnostic, "pw") {
			t.Fatalf("registered credential leaked: %q", diagnostic)
		}
		if !strings.Contains(diagnostic, "login") || !strings.Contains(diagnostic, "refused") {
			t.Fatalf("useful diagnostic lost: %q", diagnostic)
		}
	}
}

func TestRedactedErrorPreservesCancellation(t *testing.T) {
	log := events.Discard()
	log.Secret("synthetic-password")
	err := log.RedactError(fmt.Errorf("synthetic-password: %w", context.Canceled))
	if strings.Contains(err.Error(), "synthetic-password") || !errors.Is(err, context.Canceled) {
		t.Fatalf("cancellation diagnostic not safe or identity lost: %v", err)
	}
	if log.RedactError(nil) != nil || log.RedactError(context.Canceled) != context.Canceled {
		t.Fatal("non-secret errors should keep their identity")
	}
}
