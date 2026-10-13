package helpers_test

import (
	"context"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"

	"github.com/ajnart/self-host/internal/helpers"
)

func TestSessionDoesNotSendCookiesOutsideItsOrigin(t *testing.T) {
	for _, kind := range []string{"different-port", "protocol-relative", "downgrade", "explicit-base-override"} {
		t.Run(kind, func(t *testing.T) {
			var received, leaked atomic.Bool
			destination := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				received.Store(true)
				leaked.Store(strings.Contains(r.Header.Get("Cookie"), "synthetic-session-secret"))
			}))
			defer destination.Close()
			location := destination.URL + "/receive"
			if kind == "protocol-relative" {
				location = strings.TrimPrefix(location, "http:")
			}
			handler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.URL.Path == "/set" {
					http.SetCookie(w, &http.Cookie{Name: "sid", Value: "synthetic-session-secret"})
					return
				}
				http.Redirect(w, r, location, http.StatusFound)
			})
			var source *httptest.Server
			if kind == "downgrade" {
				source = httptest.NewTLSServer(handler)
			} else {
				source = httptest.NewServer(handler)
			}
			defer source.Close()
			h := &helpers.H{Config: helpers.Config{BaseURL: source.URL, HTTP: source.Client()}}
			session := h.Session()
			if _, err := session.HTTP(context.Background(), helpers.Request{Path: "/set"}); err != nil {
				t.Fatal("could not establish synthetic session")
			}
			request := helpers.Request{Path: "/redirect"}
			if kind == "explicit-base-override" {
				request.BaseURL = destination.URL
				request.Path = "/receive"
			}
			response, err := session.HTTP(context.Background(), request)
			if received.Load() || leaked.Load() {
				t.Fatalf("session origin boundary crossed: receiver-called=%v cookie-received=%v", received.Load(), leaked.Load())
			}
			if kind == "explicit-base-override" {
				if err == nil {
					t.Fatal("explicit cross-origin override was not rejected")
				}
			} else if err != nil || response.Status != http.StatusFound {
				t.Fatalf("cross-origin redirect did not return original response: status=%d error=%v", response.Status, err)
			}
		})
	}
}

func TestSessionResolvesRelativeRedirectAndHonorsClientPolicy(t *testing.T) {
	var received atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/account/home" {
			received.Add(1)
			if r.Header.Get("Cookie") != "sid=synthetic-cookie" {
				t.Error("same-origin login cookie missing")
			}
			return
		}
		http.SetCookie(w, &http.Cookie{Name: "sid", Value: "synthetic-cookie"})
		http.Redirect(w, r, "home", http.StatusFound)
	}))
	defer server.Close()
	client := server.Client()
	h := &helpers.H{Config: helpers.Config{BaseURL: server.URL, HTTP: client}}
	session := h.Session()
	response, err := session.HTTP(context.Background(), helpers.Request{Path: "/account/login"})
	if err != nil || response.Status != http.StatusOK || received.Load() != 1 {
		t.Fatal("path-relative login redirect was not resolved correctly")
	}
	policyError := errors.New("synthetic client policy refusal")
	client.CheckRedirect = func(*http.Request, []*http.Request) error { return policyError }
	_, err = session.HTTP(context.Background(), helpers.Request{Path: "/account/login"})
	if !errors.Is(err, policyError) || received.Load() != 1 {
		t.Fatal("session bypassed existing client policy")
	}
	client.CheckRedirect = func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }
	response, err = session.HTTP(context.Background(), helpers.Request{Path: "/account/login"})
	if err != nil || response.Status != http.StatusFound || received.Load() != 1 {
		t.Fatal("session did not preserve client no-follow response")
	}
}

func TestSessionRedirectLoopIsBounded(t *testing.T) {
	var received atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		received.Add(1)
		http.Redirect(w, r, "/again", http.StatusFound)
	}))
	defer server.Close()
	h := &helpers.H{Config: helpers.Config{BaseURL: server.URL, HTTP: server.Client()}}
	_, err := h.Session().HTTP(context.Background(), helpers.Request{})
	if err == nil || received.Load() != 10 {
		t.Fatalf("session redirect limit missing: requests=%d error=%v", received.Load(), err)
	}
}

func TestSessionRedirectKeepsMethodBodyAndHeadersOnTemporaryRedirect(t *testing.T) {
	var got struct {
		method, body, referer, user string
	}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/old" {
			http.Redirect(w, r, "/new", http.StatusTemporaryRedirect)
			return
		}
		data, _ := io.ReadAll(r.Body)
		got.method, got.body, got.referer = r.Method, string(data), r.Header.Get("Referer")
		got.user, _, _ = r.BasicAuth()
	}))
	defer server.Close()
	h := &helpers.H{Config: helpers.Config{BaseURL: server.URL, HTTP: server.Client()}}
	_, err := h.Session().HTTP(context.Background(), helpers.Request{
		Method: http.MethodPost, Path: "/old", JSON: map[string]string{"a": "b"},
		Header: map[string]string{"Referer": "synthetic-referer"}, User: "synthetic-user", Password: "synthetic-password",
	})
	if err != nil || got.method != http.MethodPost || got.body != `{"a":"b"}` || got.referer != "synthetic-referer" || got.user != "synthetic-user" {
		t.Fatalf("307 did not replay the request: %+v error=%v", got, err)
	}
}

func TestSessionRedirectSeeOtherBecomesGetAndKeepsHeaders(t *testing.T) {
	var got struct{ method, body, referer string }
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/old" {
			http.Redirect(w, r, "/new", http.StatusSeeOther)
			return
		}
		data, _ := io.ReadAll(r.Body)
		got.method, got.body, got.referer = r.Method, string(data), r.Header.Get("Referer")
	}))
	defer server.Close()
	h := &helpers.H{Config: helpers.Config{BaseURL: server.URL, HTTP: server.Client()}}
	_, err := h.Session().HTTP(context.Background(), helpers.Request{
		Method: http.MethodPost, Path: "/old", Form: map[string][]string{"a": {"b"}},
		Header: map[string]string{"Referer": "synthetic-referer"},
	})
	if err != nil || got.method != http.MethodGet || got.body != "" || got.referer != "synthetic-referer" {
		t.Fatalf("303 did not become a plain GET: %+v error=%v", got, err)
	}
}
