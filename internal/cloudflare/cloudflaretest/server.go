// Package cloudflaretest is a stateful stand-in for the parts of the Cloudflare
// API that self-host uses, served over httptest. It records every call in
// order so tests can assert what was done and when.
package cloudflaretest

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"sync"
	"testing"
)

// Options sets up the account the fake serves.
type Options struct {
	// Token is the only bearer token the fake accepts.
	Token string
	// Domain is the zone that is active on the account.
	Domain  string
	Domains []string
	// Team is the Zero Trust team name; empty means onboarding was not done.
	Team string
	// OTP starts the account with a one-time-PIN identity provider.
	OTP bool
	// Records are DNS records that exist before self-host runs.
	Records    []Record
	FailMethod string
	FailPath   string
}

// Record is one DNS record.
type Record struct {
	ID, Type, Name, Content, Comment string
	Proxied                          bool
}

// Request is one recorded call.
type Request struct {
	Method string
	Path   string
	Query  url.Values
	Body   map[string]any
}

// Line is the request as the call log shows it.
func (r Request) Line() string {
	line := r.Method + " " + r.Path
	if len(r.Query) > 0 {
		line += "?" + r.Query.Encode()
	}
	return line
}

type tunnel struct {
	ID, Name string
	Config   map[string]any
}

type policy struct {
	ID      string
	Name    string
	Include []any
}

type accessApp struct {
	ID, Name, Domain, AUD string
	Policies              []any
	AllowedIDPs           []any
}

// Server is the fake.
type Server struct {
	*httptest.Server
	opts Options

	mu       sync.Mutex
	next     map[string]int
	requests []Request
	idps     []map[string]any
	tunnels  []*tunnel
	policies []*policy
	apps     []*accessApp
	records  []Record
}

// New starts a fake account and stops it when the test ends.
func New(t testing.TB, opts Options) *Server {
	t.Helper()
	s := &Server{opts: opts}
	if opts.OTP {
		s.idps = append(s.idps, map[string]any{"id": "idp-otp", "name": "One-time PIN login", "type": "onetimepin"})
	}
	s.records = append(s.records, opts.Records...)
	s.Server = httptest.NewServer(http.HandlerFunc(s.serve))
	t.Cleanup(s.Server.Close)
	return s
}

// Base is the API base URL to give the client.
func (s *Server) Base() string { return s.Server.URL + "/client/v4" }

// Requests returns every call so far, in order.
func (s *Server) Requests() []Request {
	s.mu.Lock()
	defer s.mu.Unlock()
	return append([]Request(nil), s.requests...)
}

// Calls returns every call so far as "METHOD /path?query" lines.
func (s *Server) Calls() []string {
	var lines []string
	for _, r := range s.Requests() {
		lines = append(lines, r.Line())
	}
	return lines
}

// Writes returns the calls that change something, in order.
func (s *Server) Writes() []string {
	var lines []string
	for _, r := range s.Requests() {
		if r.Method != http.MethodGet && r.Method != "LOCAL" && r.Method != "PROBE" {
			lines = append(lines, r.Line())
		}
	}
	return lines
}

// Mark records something that happened beside the API (the connector started,
// a name was probed), so the call log shows it in order. Kind is LOCAL or PROBE.
func (s *Server) Mark(kind, what string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.requests = append(s.requests, Request{Method: kind, Path: what})
}

// Reset forgets the recorded calls but keeps the account's state.
func (s *Server) Reset() {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.requests = nil
}

func (s *Server) AddZone(domain string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.opts.Domains = append(s.opts.Domains, domain)
}

func (s *Server) SetFailure(method, path string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.opts.FailMethod, s.opts.FailPath = method, path
}

// Records returns the DNS records now.
func (s *Server) Records() []Record {
	s.mu.Lock()
	defer s.mu.Unlock()
	return append([]Record(nil), s.records...)
}

// Count is how many of each thing exist now.
func (s *Server) Count() (tunnels, policies, apps, idps, records int) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return len(s.tunnels), len(s.policies), len(s.apps), len(s.idps), len(s.records)
}

// Ingress returns the rules of the first tunnel.
func (s *Server) Ingress() []map[string]any {
	s.mu.Lock()
	defer s.mu.Unlock()
	if len(s.tunnels) == 0 {
		return nil
	}
	return ingressOf(s.tunnels[0].Config)
}

// TunnelToken is the run token the fake hands out.
const TunnelToken = "run-token-for-tests"

// AddForeignRule puts a rule made by another tool into the tunnel's ingress.
func (s *Server) AddForeignRule(host string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	t := s.tunnels[0]
	rules := ingressOf(t.Config)
	var out []map[string]any
	for _, r := range rules {
		if _, named := r["hostname"]; named {
			out = append(out, r)
		}
	}
	out = append(out, map[string]any{"hostname": host, "service": "http://other:80"}, map[string]any{"service": "http_status:404"})
	t.Config["ingress"] = out
}

func ingressOf(config map[string]any) []map[string]any {
	var out []map[string]any
	switch rules := config["ingress"].(type) {
	case []map[string]any:
		return rules
	case []any:
		for _, r := range rules {
			if m, ok := r.(map[string]any); ok {
				out = append(out, m)
			}
		}
	}
	return out
}

func (s *Server) id(prefix string) string {
	if s.next == nil {
		s.next = map[string]int{}
	}
	s.next[prefix]++
	return fmt.Sprintf("%s-%d", prefix, s.next[prefix])
}

const (
	accountID = "acct-1"
	zoneID    = "zone-1"
)

func reply(w http.ResponseWriter, status int, result any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(map[string]any{"success": status < 300, "errors": []any{}, "messages": []any{}, "result": result})
}

func fail(w http.ResponseWriter, status int, code int, message string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(map[string]any{"success": false, "errors": []any{map[string]any{"code": code, "message": message}}, "result": nil})
}

func (s *Server) serve(w http.ResponseWriter, r *http.Request) {
	s.mu.Lock()
	defer s.mu.Unlock()
	req := Request{Method: r.Method, Path: strings.TrimPrefix(r.URL.Path, "/client/v4"), Query: r.URL.Query()}
	if data, _ := io.ReadAll(r.Body); len(data) > 0 {
		json.Unmarshal(data, &req.Body)
	}
	s.requests = append(s.requests, req)
	if req.Method == s.opts.FailMethod && req.Path == s.opts.FailPath {
		fail(w, http.StatusServiceUnavailable, 1000, "temporary failure")
		return
	}
	if r.Header.Get("Authorization") != "Bearer "+s.opts.Token {
		fail(w, http.StatusForbidden, 10000, "Authentication error")
		return
	}
	parts := strings.Split(strings.Trim(req.Path, "/"), "/")
	switch {
	case len(parts) == 1 && parts[0] == "zones" && r.Method == http.MethodGet:
		s.zones(w, req)
	case len(parts) >= 3 && parts[0] == "zones" && parts[2] == "dns_records":
		s.dns(w, req, parts)
	case len(parts) >= 3 && parts[0] == "accounts":
		s.account(w, req, parts[2:])
	default:
		fail(w, http.StatusNotFound, 7003, "No route for "+req.Path)
	}
}

func (s *Server) zones(w http.ResponseWriter, req Request) {
	domain := req.Query.Get("name")
	zone := zoneID
	for i, candidate := range s.opts.Domains {
		if domain == candidate {
			zone = fmt.Sprintf("zone-%d", i+2)
		}
	}
	if domain != s.opts.Domain && zone == zoneID || req.Query.Get("status") != "active" {
		reply(w, http.StatusOK, []any{})
		return
	}
	reply(w, http.StatusOK, []any{map[string]any{"id": zone, "name": domain, "status": "active", "account": map[string]any{"id": accountID}}})
}

func (s *Server) account(w http.ResponseWriter, req Request, rest []string) {
	switch {
	case rest[0] == "access" && len(rest) == 2 && rest[1] == "organizations":
		if s.opts.Team == "" {
			fail(w, http.StatusNotFound, 12006, "access.api.error.not_enabled")
			return
		}
		reply(w, http.StatusOK, map[string]any{"name": s.opts.Team, "auth_domain": s.opts.Team + ".cloudflareaccess.com"})
	case rest[0] == "access" && rest[1] == "identity_providers":
		s.identityProviders(w, req)
	case rest[0] == "access" && rest[1] == "policies":
		s.policiesAPI(w, req, rest[2:])
	case rest[0] == "access" && rest[1] == "apps":
		s.appsAPI(w, req, rest[2:])
	case rest[0] == "cfd_tunnel":
		s.tunnelsAPI(w, req, rest[1:])
	default:
		fail(w, http.StatusNotFound, 7003, "No route for "+req.Path)
	}
}

func (s *Server) identityProviders(w http.ResponseWriter, req Request) {
	switch req.Method {
	case http.MethodGet:
		reply(w, http.StatusOK, append([]map[string]any{}, s.idps...))
	case http.MethodPost:
		idp := map[string]any{"id": s.id("idp"), "name": req.Body["name"], "type": req.Body["type"]}
		s.idps = append(s.idps, idp)
		reply(w, http.StatusOK, idp)
	}
}

func (s *Server) tunnelsAPI(w http.ResponseWriter, req Request, rest []string) {
	if len(rest) == 0 {
		switch req.Method {
		case http.MethodGet:
			var out []any
			for _, t := range s.tunnels {
				if t.Name == req.Query.Get("name") {
					out = append(out, map[string]any{"id": t.ID, "name": t.Name})
				}
			}
			if out == nil {
				out = []any{}
			}
			reply(w, http.StatusOK, out)
		case http.MethodPost:
			t := &tunnel{ID: s.id("tunnel"), Name: fmt.Sprint(req.Body["name"]), Config: map[string]any{"ingress": []map[string]any{{"service": "http_status:404"}}}}
			s.tunnels = append(s.tunnels, t)
			reply(w, http.StatusOK, map[string]any{"id": t.ID, "name": t.Name})
		}
		return
	}
	var t *tunnel
	for _, candidate := range s.tunnels {
		if candidate.ID == rest[0] {
			t = candidate
		}
	}
	if t == nil {
		fail(w, http.StatusNotFound, 1003, "tunnel not found")
		return
	}
	switch {
	case len(rest) == 1 && req.Method == http.MethodDelete:
		for i, candidate := range s.tunnels {
			if candidate == t {
				s.tunnels = append(s.tunnels[:i], s.tunnels[i+1:]...)
				break
			}
		}
		reply(w, http.StatusOK, map[string]any{"id": t.ID})
	case len(rest) == 2 && rest[1] == "token":
		reply(w, http.StatusOK, TunnelToken)
	case len(rest) == 2 && rest[1] == "connections" && req.Method == http.MethodDelete:
		reply(w, http.StatusOK, nil)
	case len(rest) == 2 && rest[1] == "configurations" && req.Method == http.MethodGet:
		reply(w, http.StatusOK, map[string]any{"tunnel_id": t.ID, "config": t.Config})
	case len(rest) == 2 && rest[1] == "configurations" && req.Method == http.MethodPut:
		config, _ := req.Body["config"].(map[string]any)
		t.Config = config
		reply(w, http.StatusOK, map[string]any{"tunnel_id": t.ID, "config": t.Config})
	default:
		fail(w, http.StatusNotFound, 7003, "No route for "+req.Path)
	}
}

func (s *Server) policiesAPI(w http.ResponseWriter, req Request, rest []string) {
	if len(rest) == 0 {
		switch req.Method {
		case http.MethodGet:
			out := []any{}
			for _, p := range s.policies {
				out = append(out, map[string]any{"id": p.ID, "name": p.Name, "decision": "allow", "include": p.Include})
			}
			reply(w, http.StatusOK, out)
		case http.MethodPost:
			p := &policy{ID: s.id("policy"), Name: fmt.Sprint(req.Body["name"]), Include: asList(req.Body["include"])}
			s.policies = append(s.policies, p)
			reply(w, http.StatusOK, map[string]any{"id": p.ID, "name": p.Name})
		}
		return
	}
	for i, p := range s.policies {
		if p.ID != rest[0] {
			continue
		}
		switch req.Method {
		case http.MethodPut:
			p.Include = asList(req.Body["include"])
			reply(w, http.StatusOK, map[string]any{"id": p.ID, "name": p.Name})
		case http.MethodDelete:
			for _, a := range s.apps {
				for _, ref := range a.Policies {
					if ref == p.ID {
						fail(w, http.StatusConflict, 12130, "policy is in use")
						return
					}
				}
			}
			s.policies = append(s.policies[:i], s.policies[i+1:]...)
			reply(w, http.StatusOK, map[string]any{"id": p.ID})
		}
		return
	}
	fail(w, http.StatusNotFound, 12130, "policy not found")
}

func asList(v any) []any {
	list, _ := v.([]any)
	return list
}

func (s *Server) appsAPI(w http.ResponseWriter, req Request, rest []string) {
	view := func(a *accessApp) map[string]any {
		return map[string]any{"id": a.ID, "name": a.Name, "domain": a.Domain, "aud": a.AUD, "type": "self_hosted",
			"policies": a.Policies, "allowed_idps": a.AllowedIDPs}
	}
	if len(rest) == 0 {
		switch req.Method {
		case http.MethodGet:
			out := []any{}
			for _, a := range s.apps {
				if domain := req.Query.Get("domain"); domain == "" || a.Domain == domain {
					out = append(out, view(a))
				}
			}
			reply(w, http.StatusOK, out)
		case http.MethodPost:
			id := s.id("app")
			a := &accessApp{ID: id, AUD: "aud-" + id, Name: fmt.Sprint(req.Body["name"]), Domain: fmt.Sprint(req.Body["domain"]),
				Policies: asList(req.Body["policies"]), AllowedIDPs: asList(req.Body["allowed_idps"])}
			s.apps = append(s.apps, a)
			reply(w, http.StatusOK, view(a))
		}
		return
	}
	for i, a := range s.apps {
		if a.ID != rest[0] {
			continue
		}
		switch req.Method {
		case http.MethodPut:
			a.Policies, a.AllowedIDPs = asList(req.Body["policies"]), asList(req.Body["allowed_idps"])
			reply(w, http.StatusOK, view(a))
		case http.MethodDelete:
			s.apps = append(s.apps[:i], s.apps[i+1:]...)
			reply(w, http.StatusOK, map[string]any{"id": a.ID})
		}
		return
	}
	fail(w, http.StatusNotFound, 12130, "app not found")
}

func (s *Server) dns(w http.ResponseWriter, req Request, parts []string) {
	view := func(r Record) map[string]any {
		return map[string]any{"id": r.ID, "type": r.Type, "name": r.Name, "content": r.Content, "comment": r.Comment, "proxied": r.Proxied}
	}
	if len(parts) == 3 {
		switch req.Method {
		case http.MethodGet:
			out := []any{}
			for _, r := range s.records {
				if r.Name == req.Query.Get("name") {
					out = append(out, view(r))
				}
			}
			reply(w, http.StatusOK, out)
		case http.MethodPost:
			r := Record{ID: s.id("dns"), Type: fmt.Sprint(req.Body["type"]), Name: fmt.Sprint(req.Body["name"]), Content: fmt.Sprint(req.Body["content"]),
				Comment: fmt.Sprint(req.Body["comment"]), Proxied: req.Body["proxied"] == true}
			s.records = append(s.records, r)
			reply(w, http.StatusOK, view(r))
		}
		return
	}
	for i, r := range s.records {
		if r.ID != parts[3] {
			continue
		}
		switch req.Method {
		case http.MethodPatch:
			if content, ok := req.Body["content"].(string); ok {
				s.records[i].Content = content
			}
			reply(w, http.StatusOK, view(s.records[i]))
		case http.MethodDelete:
			s.records = append(s.records[:i], s.records[i+1:]...)
			reply(w, http.StatusOK, map[string]any{"id": r.ID})
		}
		return
	}
	fail(w, http.StatusNotFound, 81044, "record not found")
}
