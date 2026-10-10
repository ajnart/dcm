package service

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"github.com/ajnart/self-host/internal/telemetry"
)

// FeedbackText is a Feedback ready to show: every known secret is masked.
type FeedbackText = telemetry.Feedback

// PrepareFeedback masks the message and, when appID is set, the summary of
// that App's Debug report, with the redaction the event sinks use. It refuses
// a message over the size cap, so what is shown is what would be sent.
func (s *Service) PrepareFeedback(ctx context.Context, message, appID string) (FeedbackText, error) {
	if err := s.loadSecrets(ctx); err != nil {
		return FeedbackText{}, err
	}
	f := FeedbackText{Message: s.Log.Redact(strings.TrimSpace(message))}
	if f.Message == "" {
		return FeedbackText{}, errors.New("the message is empty")
	}
	if len(f.Message) > telemetry.MaxFeedbackBytes {
		return FeedbackText{}, telemetry.ErrFeedbackTooLarge
	}
	if appID != "" {
		report, err := s.Debug(ctx, appID)
		if err != nil {
			return FeedbackText{}, err
		}
		f.App, f.Summary = report.ID, s.Log.Redact(feedbackSummary(report))
	}
	return f, nil
}

// loadSecrets teaches the Logger every secret of the Project. Without a
// Project there are none to know.
func (s *Service) loadSecrets(ctx context.Context) error {
	if _, err := s.open(ctx); err != nil && !errors.Is(err, ErrNoProject) {
		return err
	}
	return nil
}

// feedbackSummary is the Status and the failed steps of a Debug report, with
// their hints; never its logs.
func feedbackSummary(r DebugReport) string {
	var b strings.Builder
	state := r.State
	if r.Health != "" {
		state += " (" + r.Health + ")"
	}
	fmt.Fprintf(&b, "State: %s\nSetup: %s", state, r.Setup)
	for _, step := range r.FailedSteps {
		fmt.Fprintf(&b, "\nFailed step: %s (%s)", step.ID, step.Status)
		if step.Hint != "" {
			fmt.Fprintf(&b, ": %s", step.Hint)
		}
	}
	return b.String()
}

// SendFeedback sends f through Telemetry and reports whether it was sent.
func (s *Service) SendFeedback(f FeedbackText) bool {
	return s.Telemetry().SendFeedback(f)
}
