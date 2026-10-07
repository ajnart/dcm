package minio_test

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/ajnart/self-host/internal/apps/minio"
	"github.com/ajnart/self-host/internal/events"
	"github.com/ajnart/self-host/internal/helpers"
	"github.com/ajnart/self-host/internal/systemtest"
)

type fakeSecrets map[string]string

func (s fakeSecrets) Get(key string) string       { return s[key] }
func (s fakeSecrets) Set(key, value string) error { s[key] = value; return nil }

const adminPass = "correct-horse-battery-staple"

func signedHandler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /", func(w http.ResponseWriter, r *http.Request) {
		if !strings.HasPrefix(r.Header.Get("Authorization"), "AWS4-HMAC-SHA256 Credential=admin/") {
			w.WriteHeader(http.StatusForbidden)
			fmt.Fprint(w, `<?xml version="1.0"?><Error><Code>AccessDenied</Code></Error>`)
			return
		}
		w.WriteHeader(http.StatusOK)
		fmt.Fprint(w, `<?xml version="1.0"?><ListAllMyBucketsResult><Owner><ID>admin</ID></Owner><Buckets></Buckets></ListAllMyBucketsResult>`)
	})
	return mux
}

func newH(t *testing.T, srv *httptest.Server, records *[]helpers.StepResult) *helpers.H {
	t.Helper()
	deps := systemtest.NewDeps(t)
	return helpers.New(helpers.Config{
		App: "minio", Service: "minio", BaseURL: srv.URL, URL: srv.URL, HTTP: srv.Client(),
		Inputs:  map[string]string{"MINIO_LICENSE_FILE": "/licenses/aistor.license"},
		Secrets: fakeSecrets{"ADMIN_USER": "admin", "ADMIN_PASSWORD": adminPass},
		Log:     events.Discard(), Now: deps.Now, Sleep: deps.Sleep,
		Record: func(r helpers.StepResult) { *records = append(*records, r) },
	})
}

func TestSetupThenCheckThenRerunSkips(t *testing.T) {
	srv := httptest.NewServer(signedHandler())
	t.Cleanup(srv.Close)
	var records []helpers.StepResult
	h := newH(t, srv, &records)
	ctx := context.Background()

	if err := (minio.App{}).Setup(ctx, h); err != nil {
		t.Fatalf("Setup: %v", err)
	}
	if err := (minio.App{}).Check(ctx, h); err != nil {
		t.Fatalf("Check: %v", err)
	}
	records = nil
	if err := (minio.App{}).Setup(ctx, h); err != nil {
		t.Fatalf("rerun Setup: %v", err)
	}
	for _, r := range records {
		if r.ID == "root-s3-auth" && r.Status != "skip" {
			t.Errorf("rerun step %s = %s, want skip", r.ID, r.Status)
		}
	}
}

func TestRejectedRootLoginFailsWithARecreateHint(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusForbidden)
		fmt.Fprint(w, `<Error><Code>AccessDenied</Code></Error>`)
	}))
	t.Cleanup(srv.Close)
	var records []helpers.StepResult
	h := newH(t, srv, &records)

	if err := (minio.App{}).Setup(context.Background(), h); err == nil {
		t.Fatal("Setup should fail when the S3 API rejects the root login")
	}
	var hint string
	for _, r := range records {
		if r.Status == "fail" {
			hint = r.Hint
		}
	}
	if !strings.Contains(hint, "self-host start minio") {
		t.Errorf("hint should say to recreate the container, got %q", hint)
	}
	if err := (minio.App{}).Check(context.Background(), h); err == nil {
		t.Fatal("Check should fail when the S3 API rejects the root login")
	}
}
