package helpers

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"regexp"
	"strings"
	"sync"
)

// Session is a cookie jar on top of H.HTTP. It sends the cookies it has
// collected and stores every Set-Cookie it sees, including on redirects, so
// form logins and CSRF flows keep their state across requests.
type Session struct {
	h      *H
	mu     sync.Mutex
	jar    map[string]string
	origin *url.URL
}

// Session starts a fresh cookie jar for one login flow.
func (h *H) Session() *Session {
	return &Session{h: h, jar: map[string]string{}}
}

// HTTP sends req with the jar's cookies and stores the response's cookies.
// With NoRedirect it returns the first 3xx; otherwise it follows same-origin
// redirects itself so cookies set mid-chain are still captured.
func (s *Session) HTTP(ctx context.Context, req Request) (Response, error) {
	noRedirect := req.NoRedirect
	var via []*http.Request
	for hop := 0; ; hop++ {
		base := req.BaseURL
		if base == "" {
			base = s.h.BaseURL
		}
		current, err := http.NewRequestWithContext(ctx, orGet(req.Method), strings.TrimRight(base, "/")+req.Path, nil)
		if err != nil {
			return Response{}, errors.New("invalid session request URL")
		}
		s.mu.Lock()
		if s.origin == nil {
			origin := *current.URL
			s.origin = &origin
		}
		origin := *s.origin
		allowed := sameHTTPOrigin(&origin, current.URL)
		s.mu.Unlock()
		if !allowed {
			return Response{}, errors.New("session request is outside its original origin")
		}
		sent := req
		sent.NoRedirect = true
		sent.Header = s.withCookie(req.Header)
		for key, value := range req.Header {
			current.Header.Set(key, value)
		}
		resp, err := s.h.HTTP(ctx, sent)
		if err != nil {
			return resp, err
		}
		s.store(resp.Header)
		if noRedirect || !isRedirect(resp.Status) {
			return resp, nil
		}
		location := resp.Header.Get("Location")
		if location == "" {
			return resp, nil
		}
		target, err := current.URL.Parse(location)
		if err != nil {
			return resp, errors.New("invalid session redirect URL")
		}
		if !sameHTTPOrigin(&origin, target) {
			return resp, nil
		}
		if hop >= 9 {
			return resp, fmt.Errorf("too many redirects from %s", req.Path)
		}
		via = append(via, current)
		method := orGet(req.Method)
		keepBody := resp.Status == http.StatusTemporaryRedirect || resp.Status == http.StatusPermanentRedirect
		if !keepBody && method != http.MethodGet && method != http.MethodHead {
			method = http.MethodGet
		}
		next, err := http.NewRequestWithContext(ctx, method, target.String(), nil)
		if err != nil {
			return resp, errors.New("invalid session redirect request")
		}
		header := map[string]string{}
		for key, value := range req.Header {
			if keepBody || !strings.HasPrefix(http.CanonicalHeaderKey(key), "Content-") {
				header[key] = value
				next.Header.Set(key, value)
			}
		}
		client := s.h.Config.HTTP
		if client == nil {
			client = http.DefaultClient
		}
		if client.CheckRedirect != nil {
			if err := client.CheckRedirect(next, via); err != nil {
				if errors.Is(err, http.ErrUseLastResponse) {
					return resp, nil
				}
				return resp, err
			}
		}
		if !sameHTTPOrigin(&origin, next.URL) {
			return resp, nil
		}
		redirected := Request{Method: next.Method, BaseURL: next.URL.Scheme + "://" + next.URL.Host, Path: next.URL.RequestURI(),
			Header: header, User: req.User, Password: req.Password}
		if keepBody {
			redirected.JSON, redirected.Form, redirected.Body = req.JSON, req.Form, req.Body
		}
		req = redirected
	}
}

// Expect sends req through the session and fails unless the status is one of
// want (2xx if empty).
func (s *Session) Expect(ctx context.Context, req Request, want ...int) (Response, error) {
	resp, err := s.HTTP(ctx, req)
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

// Cookie returns the jar's value for name, or "" when none was set.
func (s *Session) Cookie(name string) string {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.jar[name]
}

// SetCookie seeds the jar, for a session kept from an earlier login.
func (s *Session) SetCookie(name, value string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.jar[name] = value
}

// FormToken GETs path and returns the value of the hidden input named
// fieldName, the CSRF token a form login submits.
func (s *Session) FormToken(ctx context.Context, path, fieldName string) (string, error) {
	resp, err := s.HTTP(ctx, Request{Path: path, Header: map[string]string{"Accept": "text/html"}})
	if err != nil {
		return "", err
	}
	if !resp.OK() {
		return "", fmt.Errorf("GET %s returned HTTP %d", path, resp.Status)
	}
	token, found := hiddenValue(resp.Body, fieldName)
	if !found || token == "" {
		return "", fmt.Errorf("no %q field on %s", fieldName, path)
	}
	return token, nil
}

func (s *Session) withCookie(header map[string]string) map[string]string {
	s.mu.Lock()
	defer s.mu.Unlock()
	if len(s.jar) == 0 {
		return header
	}
	merged := map[string]string{}
	for key, value := range header {
		merged[key] = value
	}
	cookies := make([]string, 0, len(s.jar))
	for name, value := range s.jar {
		cookies = append(cookies, name+"="+value)
	}
	if existing := merged["Cookie"]; existing != "" {
		cookies = append([]string{existing}, cookies...)
	}
	merged["Cookie"] = strings.Join(cookies, "; ")
	return merged
}

func (s *Session) store(header http.Header) {
	s.mu.Lock()
	defer s.mu.Unlock()
	for _, cookie := range (&http.Response{Header: header}).Cookies() {
		if cookie.MaxAge < 0 {
			delete(s.jar, cookie.Name)
			continue
		}
		s.jar[cookie.Name] = cookie.Value
	}
}

func isRedirect(status int) bool {
	return status == http.StatusMovedPermanently || status == http.StatusFound ||
		status == http.StatusSeeOther || status == http.StatusTemporaryRedirect ||
		status == http.StatusPermanentRedirect
}

var (
	inputTag  = regexp.MustCompile(`(?is)<input\b[^>]*>`)
	nameAttr  = regexp.MustCompile(`(?is)\bname\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))`)
	valueAttr = regexp.MustCompile(`(?is)\bvalue\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))`)
)

// hiddenValue finds the value of the named input among an HTML fragment.
func hiddenValue(body []byte, field string) (string, bool) {
	for _, tag := range inputTag.FindAll(body, -1) {
		if name, ok := attribute(nameAttr, string(tag)); !ok || name != field {
			continue
		}
		return attribute(valueAttr, string(tag))
	}
	return "", false
}

func attribute(re *regexp.Regexp, tag string) (string, bool) {
	match := re.FindStringSubmatch(tag)
	if match == nil {
		return "", false
	}
	for _, group := range match[1:] {
		if group != "" {
			return group, true
		}
	}
	return "", true
}
