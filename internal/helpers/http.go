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

// WaitHTTP polls path until it answers below 500 or timeout passes.
func (h *H) WaitHTTP(ctx context.Context, path string, timeout time.Duration) error {
	return h.Step(ctx, "wait", "wait for the web server", StepSpec{
		Do: func(ctx context.Context) error {
			return h.Poll(ctx, timeout, func(ctx context.Context) (bool, error) {
				resp, err := h.HTTP(ctx, Request{Path: path})
				if err != nil {
					return false, err
				}
				if resp.Status >= 500 {
					return false, fmt.Errorf("HTTP %d", resp.Status)
				}
				return true, nil
			})
		},
		Hint: "Check the App's logs (self-host logs " + h.App + ") for startup errors.",
	})
}

// Poll calls fn until it reports done, ctx ends or timeout passes.
func (h *H) Poll(ctx context.Context, timeout time.Duration, fn func(context.Context) (bool, error)) error {
	deadline := time.Now().Add(timeout)
	var last error
	for {
		done, err := fn(ctx)
		if done {
			return nil
		}
		last = err
		if time.Now().After(deadline) {
			if last == nil {
				return fmt.Errorf("timed out after %s", timeout)
			}
			return fmt.Errorf("timed out after %s: %w", timeout, last)
		}
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(h.PollInterval):
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
