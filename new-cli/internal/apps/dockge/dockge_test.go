package dockge_test

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/ajnart/self-host/internal/apps/dockge"
	"github.com/ajnart/self-host/internal/events"
	"github.com/ajnart/self-host/internal/helpers"
	stepstatus "github.com/ajnart/self-host/internal/status"
)

type secrets map[string]string

func (s secrets) Get(key string) string       { return s[key] }
func (s secrets) Set(key, value string) error { s[key] = value; return nil }

func TestBrowserAdministratorRemainsManual(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(http.StatusOK) }))
	t.Cleanup(srv.Close)
	var records []helpers.StepResult
	h := helpers.New(helpers.Config{App: "dockge", BaseURL: srv.URL, URL: srv.URL, HTTP: srv.Client(), Log: events.Discard(), Secrets: secrets{"ADMIN_USER": "admin", "ADMIN_PASSWORD": "fixture-only-password"}, Record: func(r helpers.StepResult) { records = append(records, r) }})
	err := (dockge.App{}).Setup(context.Background(), h)
	if err == nil || !strings.Contains(err.Error(), "has no headless way") {
		t.Fatalf("Setup = %v, want explicit manual boundary", err)
	}
	if len(records) != 2 || records[0].ID != "ready" || records[0].Status != stepstatus.StepSkip || records[1].ID != "admin" || records[1].Status != stepstatus.StepManual || !strings.Contains(records[1].Hint, srv.URL) {
		t.Fatalf("readiness/manual records = %+v", records)
	}
	err = (dockge.App{}).Check(context.Background(), h)
	if err == nil || !strings.Contains(err.Error(), "has no headless way") {
		t.Fatalf("Check = %v, want explicit manual boundary", err)
	}
}
