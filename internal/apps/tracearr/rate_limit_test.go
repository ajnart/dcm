package tracearr_test

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/ajnart/self-host/internal/apps/tracearr"
)

func TestSetupHonorsPinnedRateLimitBeforeAuthenticatingOwner(t *testing.T) {
	fake := &fakeTracearr{password: "adminpass"}
	calls, waits := 0, 0
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/api/v1/auth/sign-in/username" {
			calls++
			if calls == 1 {
				w.Header().Set("X-Retry-After", "10")
				w.WriteHeader(429)
				return
			}
		}
		fake.handler().ServeHTTP(w, r)
	}))
	defer srv.Close()
	h, _ := newH(t, srv)
	h.Sleep = func(ctx context.Context, d time.Duration) error {
		waits++
		if d != 10*time.Second {
			t.Errorf("wait=%s", d)
		}
		return nil
	}
	if err := (tracearr.App{}).Setup(context.Background(), h); err != nil {
		t.Fatal(err)
	}
	if calls != 2 || waits != 1 || fake.creates != 0 {
		t.Fatalf("calls=%d waits=%d creates=%d", calls, waits, fake.creates)
	}
}

func TestRateLimitRefusalNeverBecomesExistingOwnerFailure(t *testing.T) {
	for _, header := range []string{"", "synthetic-private", "-1", "0", "31"} {
		t.Run(header, func(t *testing.T) {
			calls, creates := 0, 0
			srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				switch r.URL.Path {
				case "/api/v1/auth/sign-in/username":
					calls++
					w.Header().Set("X-Retry-After", header)
					w.WriteHeader(429)
				case "/api/v1/auth/sign-up/email":
					creates++
				case "/api/v1/setup/status":
					w.Write([]byte(`{"needsSetup":false,"authMethods":{"local":true}}`))
				case "/health":
					w.Write([]byte(`{"mode":"ready"}`))
				}
			}))
			defer srv.Close()
			h, _ := newH(t, srv)
			h.Sleep = func(context.Context, time.Duration) error { t.Error("invalid wait accepted"); return nil }
			err := (tracearr.App{}).Setup(context.Background(), h)
			if err == nil || !strings.Contains(err.Error(), "HTTP 429") || strings.Contains(err.Error(), "an administrator already exists") || strings.Contains(err.Error(), "synthetic-private") {
				t.Fatalf("misclassified rate limit: %v", err)
			}
			if calls != 1 || creates != 0 {
				t.Fatalf("calls=%d creates=%d", calls, creates)
			}
		})
	}
}

func TestRateLimitRetryExhaustionAndDenialStayFailures(t *testing.T) {
	for _, mode := range []string{"exhausted", "wrong-password", "interrupted"} {
		t.Run(mode, func(t *testing.T) {
			fake := &fakeTracearr{password: "existing-other-password"}
			calls, waits := 0, 0
			srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.URL.Path == "/api/v1/auth/sign-in/username" {
					calls++
					if mode != "wrong-password" || calls == 1 {
						w.Header().Set("Retry-After", "1")
						w.WriteHeader(429)
						return
					}
				}
				fake.handler().ServeHTTP(w, r)
			}))
			defer srv.Close()
			h, _ := newH(t, srv)
			h.Sleep = func(ctx context.Context, d time.Duration) error {
				waits++
				deadline, bounded := ctx.Deadline()
				if !bounded || time.Until(deadline) > 30*time.Second {
					t.Error("retry context is unbounded")
				}
				if mode == "interrupted" {
					return context.Canceled
				}
				return nil
			}
			err := (tracearr.App{}).Setup(context.Background(), h)
			if err == nil || fake.creates != 0 || fake.password != "existing-other-password" {
				t.Fatal("retry accepted or replaced existing owner")
			}
			switch mode {
			case "exhausted":
				if calls != 4 || waits != 3 || !strings.Contains(err.Error(), "HTTP 429") || strings.Contains(err.Error(), "an administrator already exists") {
					t.Fatalf("retry not bounded: calls=%d waits=%d error=%v", calls, waits, err)
				}
			case "wrong-password":
				if calls != 2 || waits != 1 || !strings.Contains(err.Error(), "an administrator already exists") {
					t.Fatalf("wrong-password denial lost: %v", err)
				}
			case "interrupted":
				if calls != 1 || waits != 1 || !strings.Contains(err.Error(), "HTTP 429") {
					t.Fatalf("cancelled retry continued: %v", err)
				}
			}
		})
	}
}
