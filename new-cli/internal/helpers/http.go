package helpers

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"
)

type Request struct {
	Method string
	Path   string
	// JSON is marshalled as the body; Form is sent url-encoded; Body is sent raw.
	JSON   any
	Form   url.Values
	Body   []byte
	Header map[string]string
	// User and Password set HTTP basic auth.
	User     string
	Password string
	// BaseURL overrides the App's loopback URL (used by Links).
	BaseURL string
	// NoRedirect returns 3xx responses instead of following them.
	NoRedirect bool
}

type Response struct {
	Status int
	Header http.Header
	Body   []byte
}

func (r Response) Decode(v any) error {
	if err := json.Unmarshal(r.Body, v); err != nil {
		return fmt.Errorf("decode response (HTTP %d): %w", r.Status, err)
	}
	return nil
}

// OK reports a 2xx status.
func (r Response) OK() bool { return r.Status >= 200 && r.Status < 300 }

// HTTP sends a request to the App. Transport errors are returned; HTTP
// error statuses are not, so callers can branch on Status.
func (h *H) HTTP(ctx context.Context, req Request) (Response, error) {
	base := req.BaseURL
	if base == "" {
		base = h.BaseURL
	}
	var body io.Reader
	contentType := ""
	switch {
	case req.JSON != nil:
		data, err := json.Marshal(req.JSON)
		if err != nil {
			return Response{}, err
		}
		body, contentType = bytes.NewReader(data), "application/json"
	case req.Form != nil:
		body, contentType = strings.NewReader(req.Form.Encode()), "application/x-www-form-urlencoded"
	case req.Body != nil:
		body = bytes.NewReader(req.Body)
	}
	method := req.Method
	if method == "" {
		method = http.MethodGet
	}
	httpReq, err := http.NewRequestWithContext(ctx, method, strings.TrimRight(base, "/")+req.Path, body)
	if err != nil {
		return Response{}, err
	}
	if contentType != "" {
		httpReq.Header.Set("Content-Type", contentType)
	}
	httpReq.Header.Set("Accept", "application/json")
	for key, value := range req.Header {
		httpReq.Header.Set(key, value)
	}
	if req.User != "" || req.Password != "" {
		httpReq.SetBasicAuth(req.User, req.Password)
	}
	client := h.Config.HTTP
	if client == nil {
		client = http.DefaultClient
	}
	if req.NoRedirect {
		c := *client
		c.CheckRedirect = func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }
		client = &c
	}
	resp, err := client.Do(httpReq)
	if err != nil {
		return Response{}, err
	}
	defer resp.Body.Close()
	data, err := io.ReadAll(io.LimitReader(resp.Body, 16<<20))
	if err != nil {
		return Response{}, err
	}
	return Response{Status: resp.StatusCode, Header: resp.Header, Body: data}, nil
}

// Expect sends req and fails unless the status is one of want (2xx if empty).
func (h *H) Expect(ctx context.Context, req Request, want ...int) (Response, error) {
	resp, err := h.HTTP(ctx, req)
	if err != nil {
		return resp, err
	}
	if len(want) == 0 && resp.OK() {
		return resp, nil
	}
	for _, status := range want {
		if resp.Status == status {
			return resp, nil
		}
	}
	return resp, fmt.Errorf("%s %s returned HTTP %d: %s", orGet(req.Method), req.Path, resp.Status, snippet(resp.Body))
}

func orGet(method string) string {
	if method == "" {
		return http.MethodGet
	}
	return method
}

func snippet(body []byte) string {
	s := strings.TrimSpace(string(body))
	if len(s) > 200 {
		s = s[:200] + "…"
	}
	return s
}

// readyConfig holds what a readiness probe accepts and how long it polls.
type readyConfig struct {
	want       []int
	contains   string
	noRedirect bool
	timeout    time.Duration
}

// ReadyOption changes one aspect of a Ready probe.
type ReadyOption func(*readyConfig)

// WantStatus accepts exactly these HTTP statuses instead of the default
// "anything below 500".
func WantStatus(codes ...int) ReadyOption {
	return func(c *readyConfig) { c.want = codes }
}

// Contains accepts a response only when its body contains s.
func Contains(s string) ReadyOption {
	return func(c *readyConfig) { c.contains = s }
}

// NoRedirect treats a 3xx as the answer instead of following it.
func NoRedirect() ReadyOption {
	return func(c *readyConfig) { c.noRedirect = true }
}

// Timeout bounds how long Ready polls; the default is three minutes.
func Timeout(d time.Duration) ReadyOption {
	return func(c *readyConfig) { c.timeout = d }
}

// Ready is the one readiness step every App needs: Check is a single probe,
// Do polls until it passes or the timeout ends. A rerun whose App already
// answers skips instead of polling again.
func (h *H) Ready(ctx context.Context, path string, opts ...ReadyOption) error {
	cfg := readyConfig{timeout: 3 * time.Minute}
	for _, opt := range opts {
		opt(&cfg)
	}
	attempt := func(ctx context.Context) (bool, error) {
		resp, err := h.HTTP(ctx, Request{Path: path, NoRedirect: cfg.noRedirect})
		if err != nil {
			return false, err
		}
		if !cfg.wanted(resp.Status) {
			return false, fmt.Errorf("HTTP %d", resp.Status)
		}
		if cfg.contains != "" && !strings.Contains(string(resp.Body), cfg.contains) {
			return false, fmt.Errorf("the response did not contain %q", cfg.contains)
		}
		return true, nil
	}
	return h.Step(ctx, "ready", "wait for "+h.App+" to answer on "+path, StepSpec{
		Check: func(ctx context.Context) (bool, error) { return attempt(ctx) },
		Do: func(ctx context.Context) error {
			return h.Poll(ctx, cfg.timeout, attempt)
		},
		Hint: h.App + " did not answer on " + path + "; read its logs with: self-host logs " + h.App,
	})
}

func (c readyConfig) wanted(status int) bool {
	if len(c.want) == 0 {
		return status < 500
	}
	for _, want := range c.want {
		if status == want {
			return true
		}
	}
	return false
}

// WaitHTTP is deprecated in favour of Ready, which reports skip on a rerun.
// It stays only while the last caller, owned by a separate change, migrates.
func (h *H) WaitHTTP(ctx context.Context, path string, timeout time.Duration) error {
	return h.Ready(ctx, path, Timeout(timeout))
}

// Poll calls fn until it reports done, ctx ends or timeout passes.
func (h *H) Poll(ctx context.Context, timeout time.Duration, fn func(context.Context) (bool, error)) error {
	deadline := h.Now().Add(timeout)
	var last error
	for {
		done, err := fn(ctx)
		if done {
			return nil
		}
		last = err
		if h.Now().After(deadline) {
			if last == nil {
				return fmt.Errorf("timed out after %s", timeout)
			}
			return fmt.Errorf("timed out after %s: %w", timeout, last)
		}
		if err := h.Sleep(ctx, h.PollInterval); err != nil {
			return err
		}
	}
}

// Cookie returns the value of a cookie the response set.
func (r Response) Cookie(name string) string {
	for _, c := range (&http.Response{Header: r.Header}).Cookies() {
		if c.Name == name {
			return c.Value
		}
	}
	return ""
}
