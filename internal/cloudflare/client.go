// Package cloudflare publishes Apps at the person's own web address through a
// Cloudflare Tunnel with a login page (Cloudflare Access) in front. It owns
// every call to the Cloudflare API; nothing else in the binary talks to it.
package cloudflare

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
)

// DefaultBase is the Cloudflare API.
const DefaultBase = "https://api.cloudflare.com/client/v4"

// Client calls the Cloudflare API with one scoped API token. The token lives
// only in this value: it is never stored, logged or put in an error.
type Client struct {
	Base      string
	Token     string
	HTTP      *http.Client
	Ownership *Ownership
	Remember  func(context.Context, Ownership) error
}

type Ownership struct {
	ProjectID string            `json:"project_id"`
	AccountID string            `json:"account_id"`
	ZoneID    string            `json:"zone_id"`
	TunnelID  string            `json:"tunnel_id"`
	PolicyID  string            `json:"policy_id"`
	Apps      map[string]string `json:"apps"`
	DNS       map[string]string `json:"dns"`
}

func (c *Client) remember(ctx context.Context) error {
	if c.Remember != nil {
		return c.Remember(context.WithoutCancel(ctx), *c.Ownership)
	}
	return nil
}

func (c *Client) constrain(ctx context.Context, account, zone string) error {
	o := c.Ownership
	if o == nil || o.ProjectID == "" {
		return fmt.Errorf("Cloudflare resource ownership is unproven; legacy resources must be reviewed and removed manually")
	}
	if o.AccountID != "" && o.AccountID != account || o.ZoneID != "" && o.ZoneID != zone {
		return fmt.Errorf("Cloudflare ownership belongs to a different account or zone")
	}
	if (o.TunnelID != "" || o.PolicyID != "" || len(o.Apps) > 0 || len(o.DNS) > 0) && (o.AccountID == "" || o.ZoneID == "") {
		return fmt.Errorf("Cloudflare ownership receipt is missing account or zone constraints; retain it for manual review")
	}
	o.AccountID, o.ZoneID = account, zone
	if o.Apps == nil {
		o.Apps = map[string]string{}
	}
	if o.DNS == nil {
		o.DNS = map[string]string{}
	}
	return c.remember(ctx)
}

// Error is a refusal from the Cloudflare API.
type Error struct {
	Status   int
	Method   string
	Path     string
	Messages []string
}

func (e *Error) Error() string {
	text := strings.Join(e.Messages, "; ")
	if text == "" {
		text = http.StatusText(e.Status)
	}
	return fmt.Sprintf("Cloudflare answered %d to %s %s: %s", e.Status, e.Method, e.Path, text)
}

// Denied reports that Cloudflare refused the token itself.
func (e *Error) Denied() bool {
	return e.Status == http.StatusUnauthorized || e.Status == http.StatusForbidden
}

type envelope struct {
	Success bool `json:"success"`
	Errors  []struct {
		Code    int    `json:"code"`
		Message string `json:"message"`
	} `json:"errors"`
	Result     json.RawMessage `json:"result"`
	ResultInfo struct {
		TotalPages int `json:"total_pages"`
	} `json:"result_info"`
}

func (c *Client) base() string {
	if c.Base != "" {
		return strings.TrimRight(c.Base, "/")
	}
	return DefaultBase
}

func (c *Client) send(ctx context.Context, method, path string, query url.Values, body any) (envelope, error) {
	var env envelope
	var reader io.Reader
	if body != nil {
		data, err := json.Marshal(body)
		if err != nil {
			return env, err
		}
		reader = bytes.NewReader(data)
	}
	target := c.base() + path
	if len(query) > 0 {
		target += "?" + query.Encode()
	}
	req, err := http.NewRequestWithContext(ctx, method, target, reader)
	if err != nil {
		return env, err
	}
	req.Header.Set("Authorization", "Bearer "+c.Token)
	req.Header.Set("Accept", "application/json")
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	client := c.HTTP
	if client == nil {
		client = http.DefaultClient
	}
	resp, err := client.Do(req)
	if err != nil {
		return env, fmt.Errorf("cannot reach Cloudflare: %s", redactURLError(err, c.Token))
	}
	defer resp.Body.Close()
	data, err := io.ReadAll(io.LimitReader(resp.Body, 8<<20))
	if err != nil {
		return env, fmt.Errorf("cannot read Cloudflare's answer: %w", err)
	}
	decodeErr := json.Unmarshal(data, &env)
	if resp.StatusCode >= 300 || decodeErr == nil && !env.Success {
		apiErr := &Error{Status: resp.StatusCode, Method: method, Path: path}
		for _, e := range env.Errors {
			apiErr.Messages = append(apiErr.Messages, e.Message)
		}
		return env, apiErr
	}
	if decodeErr != nil {
		return env, fmt.Errorf("Cloudflare answered with something that is not JSON (%s %s)", method, path)
	}
	return env, nil
}

func redactURLError(err error, token string) string {
	text := err.Error()
	if token != "" {
		text = strings.ReplaceAll(text, token, "[redacted]")
	}
	return text
}

func (c *Client) do(ctx context.Context, method, path string, query url.Values, body, out any) error {
	env, err := c.send(ctx, method, path, query, body)
	if err != nil {
		return err
	}
	if out == nil || len(env.Result) == 0 || string(env.Result) == "null" {
		return nil
	}
	if err := json.Unmarshal(env.Result, out); err != nil {
		return fmt.Errorf("cannot read Cloudflare's answer to %s %s: %w", method, path, err)
	}
	return nil
}

// list reads every page of a list endpoint.
func (c *Client) list(ctx context.Context, path string, query url.Values, out any) error {
	var all []json.RawMessage
	for page := 1; ; page++ {
		q := url.Values{}
		for k, v := range query {
			q[k] = v
		}
		if page > 1 {
			q.Set("page", strconv.Itoa(page))
		}
		env, err := c.send(ctx, http.MethodGet, path, q, nil)
		if err != nil {
			return err
		}
		var items []json.RawMessage
		if len(env.Result) > 0 && string(env.Result) != "null" {
			if err := json.Unmarshal(env.Result, &items); err != nil {
				return fmt.Errorf("cannot read Cloudflare's answer to GET %s: %w", path, err)
			}
		}
		all = append(all, items...)
		if page >= env.ResultInfo.TotalPages || page >= 50 {
			break
		}
	}
	data, err := json.Marshal(all)
	if err != nil {
		return err
	}
	return json.Unmarshal(data, out)
}
