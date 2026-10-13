package helpers_test

import (
	"testing"

	"github.com/ajnart/self-host/internal/helpers"
)

func TestInternalURLIsTheComposeNetworkAddressNotTheHostPort(t *testing.T) {
	h := helpers.New(helpers.Config{App: "sonarr", Service: "sonarr", ContainerPort: 8989, Port: 18989, BaseURL: "http://127.0.0.1:18989"})

	if got := h.InternalURL(); got != "http://sonarr:8989" {
		t.Fatalf("InternalURL = %q, want http://sonarr:8989", got)
	}
}

func TestInternalURLIsEmptyWhenTheAppHasNoWebPort(t *testing.T) {
	h := helpers.New(helpers.Config{App: "borgmatic", Service: "borgmatic"})

	if got := h.InternalURL(); got != "" {
		t.Fatalf("InternalURL = %q, want empty", got)
	}
}

func TestInstalledAppInternalURLUsesItsServiceAndContainerPort(t *testing.T) {
	item := helpers.InstalledApp{ID: "gatus", URL: "http://host.example:8081", Service: "gatus", ContainerPort: 8080}

	if got := item.InternalURL(); got != "http://gatus:8080" {
		t.Fatalf("InternalURL = %q, want http://gatus:8080", got)
	}
}
