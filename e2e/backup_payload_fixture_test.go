package e2e

import "testing"

func TestExactRestoredNotification(t *testing.T) {
	for _, tc := range []struct {
		name, stream string
		want         bool
	}{
		{"exact among others", `{"event":"message","id":"other","message":"payload"}
{"event":"message","id":"owned","message":"payload"}`, true},
		{"wrong ID", `{"event":"message","id":"other","message":"payload"}`, false},
		{"wrong body", `{"event":"message","id":"owned","message":"different"}`, false},
		{"wrong event", `{"event":"open","id":"owned","message":"payload"}`, false},
		{"corrupt tail", `{"event":"message","id":"owned","message":"payload"}broken`, false},
		{"empty", "", false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			if got := exactRestoredNotification([]byte(tc.stream), "owned", "payload"); got != tc.want {
				t.Fatalf("exact payload match = %v, want %v", got, tc.want)
			}
		})
	}
}
