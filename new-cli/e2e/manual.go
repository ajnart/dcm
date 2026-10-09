package e2e

import "github.com/ajnart/self-host/internal/events"

func allManual(res result) bool {
	found := false
	for _, e := range res.events {
		if e.Event == events.StepFail {
			return false
		}
		if e.Event == events.StepManual {
			found = true
		}
	}
	return found
}
