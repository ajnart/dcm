package service

import (
	"context"
	"errors"
	"os"
	"strings"
	"testing"

	"github.com/ajnart/self-host/internal/app"
	"github.com/ajnart/self-host/internal/helpers"
)

func TestCLATEasyNamesPreflightExplainsTheLimitationWithoutWrites(t *testing.T) {
	h := newHarness(t, &testApp{id: "one", done: map[string]bool{}})
	err := h.svc.Install(context.Background(), InstallOptions{Targets: []string{"one"}, EasyNames: true, Settings: map[string]string{"LAN_IP": "192.0.0.2"}})
	var blocked *NamesBlocked
	if !errors.As(err, &blocked) || blocked.Problem != "network" {
		t.Fatalf("must keep authoritative network refusal: %v", err)
	}
	for _, want := range []string{"IPv4 service-continuity", "CLAT", "IPv6", "private home-network IPv4", "Change the LAN address", "not verified"} {
		if !strings.Contains(err.Error(), want) {
			t.Fatalf("missing %q in full error: %v", want, err)
		}
	}
	if strings.Contains(err.Error(), "keep working") {
		t.Fatal("unsupported address must not promise reachability")
	}
	if _, err := os.Stat(h.root()); !os.IsNotExist(err) {
		t.Fatalf("failed preflight created a Project: %v", err)
	}
	if len(h.composeCalls()) != 0 {
		t.Fatal("failed preflight ran Compose")
	}
}

type preflightDiagnosticApp struct{ testApp }

func (a *preflightDiagnosticApp) Inputs() []app.Input {
	return []app.Input{{Key: "auth_key", Private: true}}
}

func (a *preflightDiagnosticApp) Preflight(context.Context, *helpers.H) error {
	return errors.New("Safe provider error\nadmin synthetic-admin-sentinel\nkey synthetic-key-sentinel\nrecover privately")
}

func TestPreProjectInstallErrorMasksPendingSecretsAndKeepsSafeMultiline(t *testing.T) {
	h := newHarness(t, &preflightDiagnosticApp{testApp{id: "one"}})
	err := h.svc.Install(context.Background(), InstallOptions{Targets: []string{"one"}, AdminPassword: "synthetic-admin-sentinel", PrivateInputs: map[string]map[string]string{"one": {"auth_key": "synthetic-key-sentinel"}}})
	if err == nil || err.Error() != "Safe provider error\nadmin [redacted]\nkey [redacted]\nrecover privately" {
		t.Fatalf("pre-Project diagnostics must preserve safe text, mask all pending secrets: %v", err)
	}
	if _, err := os.Stat(h.root()); !os.IsNotExist(err) {
		t.Fatalf("preflight failure created Project: %v", err)
	}
}

func TestEasyNamesBackendUsesEditedPrivateIPv4AndStillRequiresActiveNetwork(t *testing.T) {
	for _, active := range []bool{false, true} {
		h := newHarness(t, &testApp{id: "one", done: map[string]bool{}})
		h.deps.LANIP = func() (string, error) { return "192.0.0.2", nil }
		h.deps.HomeNetwork = func(lan string) bool { return active && lan == "192.168.50.21" }
		err := h.svc.Install(context.Background(), InstallOptions{Targets: []string{"one"}, EasyNames: true, Settings: map[string]string{"LAN_IP": "192.168.50.21"}})
		if active {
			if err != nil {
				t.Fatalf("edited private address must not use stale detected default: %v", err)
			}
			continue
		}
		var blocked *NamesBlocked
		if !errors.As(err, &blocked) || blocked.Problem != "network" || strings.Contains(err.Error(), "keep working") {
			t.Fatalf("inactive private address must still refuse without reachability promise: %v", err)
		}
		if _, err := os.Stat(h.root()); !os.IsNotExist(err) {
			t.Fatalf("inactive network preflight wrote a Project: %v", err)
		}
	}
}

func TestEasyNamesBackendStillRejectsIPv6AndOtherNonPrivateIPv4(t *testing.T) {
	for _, lan := range []string{"192.0.0.7", "192.0.0.8", "198.51.100.20", "2001:db8::1", "fd00::1", "not-an-address"} {
		h := newHarness(t, &testApp{id: "one", done: map[string]bool{}})
		err := h.svc.Install(context.Background(), InstallOptions{Targets: []string{"one"}, EasyNames: true, Settings: map[string]string{"LAN_IP": lan}})
		var blocked *NamesBlocked
		if !errors.As(err, &blocked) || blocked.Problem != "network" || !strings.Contains(err.Error(), "not verified") {
			t.Fatalf("%s must not loosen eligibility or promise reachability: %v", lan, err)
		}
		if _, err := os.Stat(h.root()); !os.IsNotExist(err) {
			t.Fatalf("unsupported address wrote a Project: %v", err)
		}
	}
}
