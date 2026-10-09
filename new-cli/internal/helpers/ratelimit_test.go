package helpers_test

import (
	"context"
	"errors"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/ajnart/self-host/internal/helpers"
)

func TestRetryAfterRetriesOneThrottledLogin(t *testing.T) {
	h := newH(t, nil, nil, nil)
	calls, waits := 0, 0
	h.Sleep = func(ctx context.Context, d time.Duration) error {
		waits++
		if d != time.Second {
			t.Errorf("wait = %s, want 1s", d)
		}
		return ctx.Err()
	}
	resp, err := h.RetryAfter(context.Background(), helpers.RateLimit{
		Headers: []string{"Retry-After"}, Default: time.Second, Bound: time.Minute,
	}, func(context.Context) (helpers.Response, error) {
		calls++
		if calls == 1 {
			return helpers.Response{Status: http.StatusTooManyRequests, Header: http.Header{"Retry-After": []string{"1"}}}, nil
		}
		return helpers.Response{Status: http.StatusOK}, nil
	})
	if err != nil || resp.Status != http.StatusOK || calls != 2 || waits != 1 {
		t.Fatalf("calls=%d waits=%d status=%d err=%v", calls, waits, resp.Status, err)
	}
}

func TestRetryAfterParsesSecondsAndFallsBackToDefault(t *testing.T) {
	for _, tc := range []struct {
		name   string
		header string
		want   time.Duration
	}{
		{"seconds", "7", 7 * time.Second},
		{"missing falls back to default", "", 3 * time.Second},
	} {
		t.Run(tc.name, func(t *testing.T) {
			h := newH(t, nil, nil, nil)
			var wait time.Duration
			h.Sleep = func(_ context.Context, d time.Duration) error { wait = d; return nil }
			calls := 0
			_, err := h.RetryAfter(context.Background(), helpers.RateLimit{
				Headers: []string{"Retry-After"}, Default: 3 * time.Second, Bound: time.Minute,
			}, func(context.Context) (helpers.Response, error) {
				calls++
				if calls == 1 {
					header := http.Header{}
					if tc.header != "" {
						header.Set("Retry-After", tc.header)
					}
					return helpers.Response{Status: http.StatusTooManyRequests, Header: header}, nil
				}
				return helpers.Response{Status: http.StatusOK}, nil
			})
			if err != nil || wait != tc.want {
				t.Fatalf("wait = %s, want %s, err = %v", wait, tc.want, err)
			}
		})
	}
}

func TestRetryAfterBoundNamesAppAndWait(t *testing.T) {
	h := newH(t, nil, nil, nil)
	_, err := h.RetryAfter(context.Background(), helpers.RateLimit{
		Headers: []string{"Retry-After"}, Default: time.Second, Bound: 2 * time.Second,
	}, func(context.Context) (helpers.Response, error) {
		return helpers.Response{Status: http.StatusTooManyRequests, Header: http.Header{"Retry-After": []string{"1"}}}, nil
	})
	if err == nil || !strings.Contains(err.Error(), "demo") || !strings.Contains(err.Error(), "2s") {
		t.Fatalf("bound error = %v", err)
	}
}

func TestRetryAfterPropagatesCancellation(t *testing.T) {
	h := newH(t, nil, nil, nil)
	ctx, cancel := context.WithCancel(context.Background())
	h.Sleep = func(context.Context, time.Duration) error {
		cancel()
		return context.Canceled
	}
	_, err := h.RetryAfter(ctx, helpers.RateLimit{
		Headers: []string{"Retry-After"}, Default: time.Second, Bound: time.Minute,
	}, func(context.Context) (helpers.Response, error) {
		return helpers.Response{Status: http.StatusTooManyRequests, Header: http.Header{"Retry-After": []string{"1"}}}, nil
	})
	if !errors.Is(err, context.Canceled) {
		t.Fatalf("err = %v, want context.Canceled", err)
	}
}
