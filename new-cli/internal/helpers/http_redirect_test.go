package helpers_test

import (
	"context"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"sync/atomic"
	"testing"

	"github.com/ajnart/self-host/internal/helpers"
)

func TestHTTPRedirectDoesNotSendCredentialsToAnotherOrigin(t *testing.T) {
	for _, tc := range []struct {
		name    string
		status  int
		request helpers.Request
	}{
		{"json-307", http.StatusTemporaryRedirect, helpers.Request{Method: "POST", JSON: map[string]string{"password": "synthetic-password"}}},
		{"form-308", http.StatusPermanentRedirect, helpers.Request{Method: "POST", Form: url.Values{"password": {"synthetic-password"}}}},
		{"authorization-302", http.StatusFound, helpers.Request{Header: map[string]string{"Authorization": "Bearer synthetic-token"}}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			var received atomic.Bool
			var leaked atomic.Bool
			destination := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				received.Store(true)
				body, _ := io.ReadAll(r.Body)
				leaked.Store(len(body) > 0 || r.Header.Get("Authorization") != "")
			}))
			defer destination.Close()
			source := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				http.Redirect(w, r, destination.URL+"/receive", tc.status)
			}))
			defer source.Close()
			h := &helpers.H{Config: helpers.Config{BaseURL: source.URL, HTTP: source.Client()}}
			response, err := h.HTTP(context.Background(), tc.request)
			if err != nil || response.Status != tc.status || received.Load() {
				t.Fatalf("cross-origin redirect followed: status=%d, error=%v, receiver-called=%v, credentials-received=%v", response.Status, err, received.Load(), leaked.Load())
			}
		})
	}
}

func TestHTTPRedirectPreservesSameOriginAndClientPolicy(t *testing.T) {
	var received atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/receive" {
			received.Add(1)
			body, _ := io.ReadAll(r.Body)
			if string(body) != "password=synthetic-password" || r.Header.Get("Authorization") != "Bearer synthetic-token" {
				t.Error("same-origin redirect lost request credentials")
			}
			w.WriteHeader(http.StatusNoContent)
			return
		}
		http.Redirect(w, r, "/receive", http.StatusTemporaryRedirect)
	}))
	defer server.Close()
	client := server.Client()
	h := &helpers.H{Config: helpers.Config{BaseURL: server.URL, HTTP: client}}
	request := helpers.Request{Method: "POST", Form: url.Values{"password": {"synthetic-password"}}, Header: map[string]string{"Authorization": "Bearer synthetic-token"}}
	response, err := h.HTTP(context.Background(), request)
	if err != nil || response.Status != http.StatusNoContent || received.Load() != 1 {
		t.Fatalf("same-origin redirect failed: status=%d error=%v", response.Status, err)
	}
	request.NoRedirect = true
	response, err = h.HTTP(context.Background(), request)
	if err != nil || response.Status != http.StatusTemporaryRedirect || received.Load() != 1 {
		t.Fatal("NoRedirect was not honored")
	}
	request.NoRedirect = false
	policyError := errors.New("synthetic redirect policy refusal")
	client.CheckRedirect = func(*http.Request, []*http.Request) error { return policyError }
	_, err = h.HTTP(context.Background(), request)
	if !errors.Is(err, policyError) || received.Load() != 1 {
		t.Fatal("existing client redirect policy was not honored")
	}
}

func TestHTTPRedirectStopsAfterTenRequests(t *testing.T) {
	var received atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		received.Add(1)
		http.Redirect(w, r, "/again", http.StatusFound)
	}))
	defer server.Close()
	client := server.Client()
	client.CheckRedirect = func(*http.Request, []*http.Request) error { return nil }
	h := &helpers.H{Config: helpers.Config{BaseURL: server.URL, HTTP: client}}
	_, err := h.HTTP(context.Background(), helpers.Request{})
	if err == nil || received.Load() != 10 {
		t.Fatalf("redirect bound missing: requests=%d error=%v", received.Load(), err)
	}
}
