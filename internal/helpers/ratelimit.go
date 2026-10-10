package helpers

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"strconv"
	"time"
)

// RateLimit is one App's login throttle: the response headers that carry the
// server's wait in seconds, the wait to use when none is present, and how long
// the whole loop may sleep.
type RateLimit struct {
	// Headers are the retry-delay headers, tried in order.
	Headers []string
	// Default is the wait when no header holds a positive number of seconds.
	// Zero means a valid header is required.
	Default time.Duration
	// Bound is the most the loop may sleep in total.
	Bound time.Duration
	// Retries caps how many 429 answers are retried. Zero leaves only Bound.
	Retries int
	// Hint is appended to the final error to name recovery.
	Hint string
}

// RetryAfter drives an App's rate-limited login: it calls fn until it answers
// something other than HTTP 429 or the wait exceeds Bound. fn owns the request
// so each App keeps its own login path. The final error names the App, the next
// wait it refused and the total already waited.
func (h *H) RetryAfter(ctx context.Context, rl RateLimit, fn func(context.Context) (Response, error)) (Response, error) {
	var waited time.Duration
	for retries := 0; ; {
		resp, err := fn(ctx)
		if err != nil {
			return resp, err
		}
		if resp.Status != http.StatusTooManyRequests {
			return resp, nil
		}
		wait, ok := rl.wait(resp.Header)
		if !ok || (rl.Retries > 0 && retries >= rl.Retries) || waited+wait > rl.Bound {
			return resp, h.rateLimited(rl, wait, waited)
		}
		if err := h.Sleep(ctx, wait); err != nil {
			return resp, fmt.Errorf("%s login remained rate-limited (HTTP 429) after waiting %s: %w", h.App, waited, err)
		}
		waited += wait
		retries++
	}
}

func (rl RateLimit) wait(header http.Header) (time.Duration, bool) {
	for _, name := range rl.Headers {
		value := header.Get(name)
		if value == "" {
			continue
		}
		seconds, err := strconv.Atoi(value)
		if err != nil || seconds <= 0 {
			break
		}
		return time.Duration(seconds) * time.Second, true
	}
	return rl.Default, rl.Default > 0
}

func (h *H) rateLimited(rl RateLimit, wait, waited time.Duration) error {
	msg := fmt.Sprintf("%s login remained rate-limited (HTTP 429); gave up after waiting %s", h.App, waited)
	// Without a usable retry header there is no next wait to name.
	if wait > 0 {
		msg += fmt.Sprintf(" and refusing the next wait of %s", wait)
	}
	if rl.Hint != "" {
		msg += "; " + rl.Hint
	}
	return errors.New(msg)
}
