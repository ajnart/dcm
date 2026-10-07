package helpers_test

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/ajnart/self-host/internal/helpers"
)

func TestSessionStoresAndResendsCookies(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.URL.Path == "/set":
			http.SetCookie(w, &http.Cookie{Name: "sid", Value: "abc"})
		case r.URL.Path == "/check":
			if c, err := r.Cookie("sid"); err != nil || c.Value != "abc" {
				w.WriteHeader(http.StatusUnauthorized)
				return
			}
			w.WriteHeader(http.StatusOK)
		}
	}))
	defer srv.Close()
	h := newH(t, srv, nil, nil)

	session := h.Session()
	if _, err := session.HTTP(context.Background(), helpers.Request{Path: "/set"}); err != nil {
		t.Fatalf("set: %v", err)
	}
	resp, err := session.HTTP(context.Background(), helpers.Request{Path: "/check"})
	if err != nil {
		t.Fatalf("check: %v", err)
	}
	if resp.Status != http.StatusOK {
		t.Fatalf("cookie was not resent: HTTP %d", resp.Status)
	}
}

func TestSessionStoresCookiesFromRedirects(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/login" {
			http.SetCookie(w, &http.Cookie{Name: "sid", Value: "abc"})
			http.Redirect(w, r, "/home", http.StatusFound)
			return
		}
		if c, err := r.Cookie("sid"); err != nil || c.Value != "abc" {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		w.WriteHeader(http.StatusOK)
	}))
	defer srv.Close()
	h := newH(t, srv, nil, nil)

	session := h.Session()
	resp, err := session.HTTP(context.Background(), helpers.Request{Path: "/login"})
	if err != nil {
		t.Fatalf("login: %v", err)
	}
	if resp.Status != http.StatusOK {
		t.Fatalf("redirect chain status = %d, want 200", resp.Status)
	}
}

func TestSessionNoRedirectReturnsTheRedirectAndKeepsCookies(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/login" {
			http.SetCookie(w, &http.Cookie{Name: "sid", Value: "abc"})
			http.Redirect(w, r, "/home", http.StatusFound)
			return
		}
		if c, err := r.Cookie("sid"); err != nil || c.Value != "abc" {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		w.WriteHeader(http.StatusOK)
	}))
	defer srv.Close()
	h := newH(t, srv, nil, nil)

	session := h.Session()
	resp, err := session.HTTP(context.Background(), helpers.Request{Path: "/login", NoRedirect: true})
	if err != nil {
		t.Fatalf("login: %v", err)
	}
	if resp.Status != http.StatusFound {
		t.Fatalf("status = %d, want the 302 itself", resp.Status)
	}
	next, err := session.HTTP(context.Background(), helpers.Request{Path: "/home"})
	if err != nil {
		t.Fatalf("home: %v", err)
	}
	if next.Status != http.StatusOK {
		t.Fatalf("cookie from the redirect was not stored: HTTP %d", next.Status)
	}
}

func TestFormTokenFindsHiddenInput(t *testing.T) {
	body := `<form method="post">
		<input type="hidden" value="tok-one" name="_token">
		<input name="other" value="x">
	</form>`
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		fmt.Fprint(w, body)
	}))
	defer srv.Close()
	h := newH(t, srv, nil, nil)

	token, err := h.Session().FormToken(context.Background(), "/login", "_token")
	if err != nil {
		t.Fatalf("FormToken: %v", err)
	}
	if token != "tok-one" {
		t.Errorf("token = %q, want tok-one", token)
	}
}

func TestFormTokenSingleQuotedNameFirst(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		fmt.Fprint(w, `<input name='_token' value='tok-two'>`)
	}))
	defer srv.Close()
	h := newH(t, srv, nil, nil)

	token, err := h.Session().FormToken(context.Background(), "/login", "_token")
	if err != nil {
		t.Fatalf("FormToken: %v", err)
	}
	if token != "tok-two" {
		t.Errorf("token = %q, want tok-two", token)
	}
}

func TestFormTokenMissingIsAnError(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		fmt.Fprint(w, `<p>no form here</p>`)
	}))
	defer srv.Close()
	h := newH(t, srv, nil, nil)

	_, err := h.Session().FormToken(context.Background(), "/login", "_token")
	if err == nil || !strings.Contains(err.Error(), "_token") {
		t.Fatalf("FormToken error = %v, want it to name the missing field", err)
	}
}
