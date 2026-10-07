package tracearr_test

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/ajnart/self-host/internal/apps/tracearr"
)

func TestExistingOwnerFailureRetainsLoginStatusWithoutRetryOrPrivateBody(t *testing.T) {
	logins, creates := 0, 0
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/api/v1/setup/status":
			w.Write([]byte(`{"needsSetup":false,"hasPasswordAuth":true,"authMethods":{"local":true},"private":"synthetic-private"}`))
		case "/api/v1/auth/sign-in/username":
			logins++
			w.WriteHeader(429)
			w.Write([]byte(`{"error":"synthetic-private","token":"synthetic-token"}`))
		case "/api/v1/auth/sign-up/email":
			creates++
		case "/health":
			w.Write([]byte(`{"mode":"ready"}`))
		}
	}))
	defer srv.Close()
	h, recorded := newH(t, srv)
	err := (tracearr.App{}).Setup(context.Background(), h)
	if err == nil || !strings.Contains(err.Error(), "an administrator already exists") || !strings.Contains(err.Error(), "login_http=429 token_present=false me_http=0") || !strings.Contains(err.Error(), "local_login_enabled=true has_password_auth=true needs_setup=false") {
		t.Fatalf("missing original failure or bounded auth diagnostic: %v", err)
	}
	if logins != 1 || creates != 0 {
		t.Fatalf("login retries=%d owner writes=%d", logins, creates)
	}
	for _, step := range *recorded {
		if strings.Contains(step.Error+step.Hint, "synthetic-") || strings.Contains(step.Error+step.Hint, "adminpass") {
			t.Fatal("private response or credential leaked")
		}
	}
}

func TestFreshCheckFailureReportsIdentityMatchesWithoutLeakingIdentity(t *testing.T) {
	logins := 0
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/api/v1/setup/status":
			w.Write([]byte(`{"needsSetup":false,"hasPasswordAuth":true,"authMethods":{"local":true}}`))
		case "/api/v1/auth/sign-in/username":
			logins++
			w.Write([]byte(`{"token":"synthetic-private-token"}`))
		case "/api/v1/auth/me":
			if r.Header.Get("Authorization") != "Bearer synthetic-private-token" {
				t.Error("missing explicit session token")
			}
			w.Write([]byte(`{"username":"admin","email":"synthetic-private-email","role":"owner","userId":"synthetic-private-id"}`))
		}
	}))
	defer srv.Close()
	h, recorded := newH(t, srv)
	err := (tracearr.App{}).Check(context.Background(), h)
	if err == nil || !strings.Contains(err.Error(), "the Admin login cannot sign in") || !strings.Contains(err.Error(), "login_http=200 token_present=true me_http=200 username_match=true email_match=false owner_match=true owner_id_present=true") {
		t.Fatalf("missing identity diagnostics: %v", err)
	}
	if logins != 1 {
		t.Fatalf("repeated login %d times", logins)
	}
	for _, step := range *recorded {
		if strings.Contains(step.Error+step.Hint, "synthetic-private") {
			t.Fatal("private identity leaked")
		}
	}
}

func TestFreshClientRerunAndWrongPasswordPreserveOwner(t *testing.T) {
	fake := &fakeTracearr{needsSetup: true}
	srv := httptest.NewServer(fake.handler())
	defer srv.Close()
	h, _ := newH(t, srv)
	if err := (tracearr.App{}).Setup(context.Background(), h); err != nil {
		t.Fatal(err)
	}
	fresh, recorded := newH(t, srv)
	if err := (tracearr.App{}).Check(context.Background(), fresh); err != nil {
		t.Fatal(err)
	}
	if err := (tracearr.App{}).Setup(context.Background(), fresh); err != nil {
		t.Fatal(err)
	}
	for _, step := range *recorded {
		if step.ID == "auth-status" {
			t.Fatal("success emitted failure diagnostics")
		}
	}
	fresh.Secrets.Set("ADMIN_PASSWORD", "wrong-password")
	if err := (tracearr.App{}).Check(context.Background(), fresh); err == nil {
		t.Fatal("wrong password accepted")
	}
	if err := (tracearr.App{}).Setup(context.Background(), fresh); err == nil {
		t.Fatal("wrong password rerun accepted")
	}
	if fake.creates != 1 || fake.password != "adminpass" {
		t.Fatal("existing owner was replaced")
	}
}
