package homarr

import (
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/ajnart/self-host/internal/events"
	"github.com/ajnart/self-host/internal/helpers"
)

func TestGluetunPrivacyHoldPrecedesHomarrRequests(t *testing.T) {
	requests := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		requests++
		w.WriteHeader(http.StatusInternalServerError)
	}))
	defer server.Close()
	from := helpers.New(helpers.Config{App: "homarr", BaseURL: server.URL, HTTP: server.Client(), Log: events.Discard()})
	to := helpers.New(helpers.Config{App: "gluetun", BaseURL: server.URL, HTTP: server.Client(), Log: events.Discard(),
		Secrets: statsSecrets{"GLUETUN_CONTROL_API_KEY": "fixture-key"},
	})
	descriptor := gluetunTarget()
	if linked, err := descriptor.linked(t.Context(), from, to); linked || !errors.Is(err, helpers.ErrManual) {
		t.Fatalf("Check must remain Manual: linked=%v err=%v", linked, err)
	}
	if err := descriptor.add(t.Context(), from, to); !errors.Is(err, helpers.ErrManual) {
		t.Fatalf("apply must remain Manual: %v", err)
	}
	if err := descriptor.verifyData(t.Context(), from, to, "gluetun-owned"); !errors.Is(err, helpers.ErrManual) {
		t.Fatalf("standalone verification must retain privacy hold: %v", err)
	}
	if requests != 0 {
		t.Fatalf("privacy hold made %d requests, want none", requests)
	}
}
