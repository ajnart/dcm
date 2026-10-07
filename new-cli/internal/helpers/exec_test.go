package helpers_test

import (
	"context"
	"errors"
	"strings"
	"testing"

	"github.com/ajnart/self-host/internal/system"
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

func TestExecSecretErrorCarriesCommandOutput(t *testing.T) {
	exec := &fakeExec{
		result: system.Result{Stderr: []byte("PHP Fatal error: Cannot open input file"), ExitCode: 1},
		err:    errors.New("docker compose exec: exit 1"),
	}
	h := newH(t, nil, exec, nil)

	_, err := h.ExecSecret(context.Background(), map[string]string{"SELFHOST_PW": "top-secret"}, "php cli/do-install.php")
	if err == nil {
		t.Fatal("ExecSecret should return the command's error")
	}
	if !strings.Contains(err.Error(), "PHP Fatal error: Cannot open input file") {
		t.Fatalf("error %q should carry the command's stderr", err)
	}
	if strings.Contains(err.Error(), "top-secret") {
		t.Fatal("error leaked a secret")
	}
}

func TestExecSecretErrorFallsBackToStdout(t *testing.T) {
	exec := &fakeExec{
		result: system.Result{Stdout: []byte("FreshRSS install refused"), ExitCode: 1},
		err:    errors.New("docker compose exec: exit 1"),
	}
	h := newH(t, nil, exec, nil)

	_, err := h.ExecSecret(context.Background(), nil, "php cli/do-install.php")
	if err == nil {
		t.Fatal("ExecSecret should return the command's error")
	}
	if !strings.Contains(err.Error(), "FreshRSS install refused") {
		t.Fatalf("error %q should fall back to the command's stdout", err)
	}
}

func TestExecSecretErrorRedactsSecretsInOutput(t *testing.T) {
	exec := &fakeExec{
		result: system.Result{Stderr: []byte("login failed for password top-secret"), ExitCode: 1},
		err:    errors.New("docker compose exec: exit 1"),
	}
	h := newH(t, nil, exec, nil)

	_, err := h.ExecSecret(context.Background(), map[string]string{"SELFHOST_PW": "top-secret"}, "login")
	if err == nil {
		t.Fatal("ExecSecret should return the command's error")
	}
	if strings.Contains(err.Error(), "top-secret") {
		t.Fatalf("error %q leaked a secret the command printed", err)
	}
	if !strings.Contains(err.Error(), "login failed for password") {
		t.Fatalf("error %q should keep the rest of the output", err)
	}
}
