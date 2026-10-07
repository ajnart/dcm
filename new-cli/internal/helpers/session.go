package helpers

import (
	"context"
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
	h   *H
	mu  sync.Mutex
	jar map[string]string
}

// Session starts a fresh cookie jar for one login flow.
func (h *H) Session() *Session {
	return &Session{h: h, jar: map[string]string{}}
}

// HTTP sends req with the jar's cookies and stores the response's cookies.
// With NoRedirect it returns the first 3xx; otherwise it follows relative and
// absolute redirects itself so cookies set mid-chain are still captured.
func (s *Session) HTTP(ctx context.Context, req Request) (Response, error) {
	noRedirect := req.NoRedirect
	for hop := 0; ; hop++ {
		req.NoRedirect = true
		req.Header = s.withCookie(req.Header)
		resp, err := s.h.HTTP(ctx, req)
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
		if hop >= 10 {
			return resp, fmt.Errorf("too many redirects from %s", req.Path)
		}
		req = redirectRequest(req, location)
	}
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

// redirectRequest turns a redirect Location into the next GET. Credentials are
// dropped: a login redirect lands after authentication, not on another one.
func redirectRequest(from Request, location string) Request {
	next := Request{Method: http.MethodGet, Header: map[string]string{"Accept": "text/html"}}
	if target, err := url.Parse(location); err == nil && target.IsAbs() {
		next.BaseURL = target.Scheme + "://" + target.Host
		next.Path = target.RequestURI()
		return next
	}
	next.BaseURL = from.BaseURL
	next.Path = location
	return next
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
