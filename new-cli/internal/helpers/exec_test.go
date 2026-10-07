package helpers_test

import (
	"context"
	"strings"
	"testing"
)

func TestExecSecretKeepsSecretsOutOfArgv(t *testing.T) {
	exec := &fakeExec{}
	h := newH(t, nil, exec, nil)

	script := `php artisan create --password="$SELFHOST_PW"`
	_, err := h.ExecSecret(context.Background(), map[string]string{"SELFHOST_PW": "top-secret"}, script)
	if err != nil {
		t.Fatalf("ExecSecret: %v", err)
	}
	if len(exec.calls) != 1 {
		t.Fatalf("calls = %d, want 1", len(exec.calls))
	}
	call := exec.calls[0]
	if len(call.command) != 3 || call.command[0] != "sh" || call.command[1] != "-c" || call.command[2] != script {
		t.Fatalf("command = %v, want sh -c <script>", call.command)
	}
	if call.env["SELFHOST_PW"] != "top-secret" {
		t.Fatalf("env = %v, want the secret passed through", call.env)
	}
	if strings.Contains(strings.Join(call.command, " "), "top-secret") {
		t.Fatal("secret leaked into argv")
	}
	if call.service != "demo" {
		t.Errorf("service = %q, want the App's main service", call.service)
	}
}
