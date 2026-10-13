package service

import (
	"context"
	"syscall"
	"testing"

	"github.com/ajnart/self-host/internal/host"
)

func TestEasyNamesUsesEveryHostBindOutcome(t *testing.T) {
	const busyMessage = "Port 80 is already in use or cannot be checked by binding, so nothing was changed. The addresses with numbers keep working."

	tests := []struct {
		name       string
		bindErrors map[string]error
		portFree   bool
		available  bool
		problem    string
		message    string
	}{
		{
			name: "permission denied on loopback only is available",
			bindErrors: map[string]error{
				"tcp4 127.0.0.1:80": syscall.EACCES,
			},
			portFree:  true,
			available: true,
		},
		{
			name: "permission denied on every address is available",
			bindErrors: map[string]error{
				"tcp4 0.0.0.0:80":   syscall.EACCES,
				"tcp4 127.0.0.1:80": syscall.EACCES,
				"tcp6 [::]:80":      syscall.EACCES,
			},
			portFree:  true,
			available: true,
		},
		{
			name: "IPv6 unsupported is available",
			bindErrors: map[string]error{
				"tcp6 [::]:80": syscall.EAFNOSUPPORT,
			},
			portFree:  true,
			available: true,
		},
		{
			name: "IPv4 listener is busy",
			bindErrors: map[string]error{
				"tcp4 0.0.0.0:80": syscall.EADDRINUSE,
			},
			problem: problemPortHeld,
			message: busyMessage,
		},
		{
			name: "IPv6 listener is busy",
			bindErrors: map[string]error{
				"tcp6 [::]:80": syscall.EADDRINUSE,
			},
			problem: problemPortHeld,
			message: busyMessage,
		},
		{
			name:      "every address is free",
			portFree:  true,
			available: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			h := newHarness(t)
			h.deps.BindTCP = func(network, address string) error {
				return tt.bindErrors[network+" "+address]
			}

			portFree := host.PortAvailable(host.ProbePort(h.deps, 80))
			check := h.svc.CheckEasyNames(context.Background())

			if portFree != tt.portFree {
				t.Fatalf("port free = %v, want %v", portFree, tt.portFree)
			}
			if check.Available != tt.available || check.Problem != tt.problem || check.Message != tt.message {
				t.Fatalf("check = %+v, want available=%v problem=%q message=%q", check, tt.available, tt.problem, tt.message)
			}
		})
	}
}
