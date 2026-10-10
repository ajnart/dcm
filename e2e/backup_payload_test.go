//go:build e2e

package e2e

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os/exec"
	"slices"
	"strings"
	"time"
)

// These statements contain only an owned benign fixture. Credentials expand
// inside the owned container; no password enters command arguments or output.
const postgresProbeShell = `exec psql --no-psqlrc --set ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "${POSTGRES_DB:-postgres}" --tuples-only --no-align`
const postgresSeedSQL = `CREATE TABLE public.selfhost_e2e_backup_probe (id integer PRIMARY KEY, payload text NOT NULL);
INSERT INTO public.selfhost_e2e_backup_probe VALUES (1, 'owned self-host PostgreSQL restore payload');`
const postgresReadSQL = `SELECT id::text || ':' || payload FROM public.selfhost_e2e_backup_probe ORDER BY id;`
const postgresExpected = "1:owned self-host PostgreSQL restore payload"

type backupPayload struct {
	apps         []string
	notification notificationPayload
	topic        string
	port         int
}

func payloadFailure(app, reason string) result {
	return result{code: 1, events: []event{{Event: "step.fail", App: app, Step: "backup-data", Error: reason}}}
}

func (r *runner) postgresPayload(sql string, discard bool) (string, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, "docker", r.dockerArgs("compose", "-p", r.name, "exec", "-T", "postgresql", "sh", "-c", postgresProbeShell)...)
	cmd.Dir, cmd.Env, cmd.Stdin = r.project, r.env, strings.NewReader(sql)
	var out bytes.Buffer
	cmd.Stdout = &out
	if discard {
		cmd.Stdout = io.Discard
	}
	cmd.Stderr = io.Discard
	if cmd.Run() != nil {
		return "", fmt.Errorf("owned PostgreSQL data probe failed")
	}
	return strings.TrimSpace(out.String()), nil
}

// Read only the public credential handoff command in memory. Never retain its
// private JSON, stderr, or secret-bearing headers in ordinary evidence.
func (r *runner) ntfyToken() string {
	res := r.runWithTimeout(30*time.Second, "credentials", "--json")
	var doc struct {
		Apps map[string]map[string]string `json:"apps"`
	}
	if res.code != 0 || json.Unmarshal([]byte(res.stdout), &doc) != nil {
		return ""
	}
	return doc.Apps["ntfy"]["NTFY_HOMARR_TOKEN"]
}

func (p *backupPayload) notificationRequest(r *runner, method string, body []byte) (int, []byte, error) {
	token := r.ntfyToken()
	if token == "" {
		return 0, nil, fmt.Errorf("owned ntfy token unavailable")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	client := &http.Client{Timeout: 30 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	endpoint := fmt.Sprintf("http://127.0.0.1:%d/%s", p.port, p.topic)
	if method == "GET" {
		endpoint += "/json?poll=1"
	}
	return hfRequest(ctx, client, method, endpoint, map[string]string{"Authorization": "Bearer " + token, "Content-Type": "text/plain", "Cache": "yes"}, body)
}

func (p *backupPayload) seed(r *runner) result {
	if slices.Contains(p.apps, "postgresql") {
		if _, err := r.postgresPayload(postgresSeedSQL, true); err != nil {
			return payloadFailure("postgresql", "owned PostgreSQL row could not be seeded")
		}
	}
	if slices.Contains(p.apps, "ntfy") {
		message := "Owned self-host isolated restore notification " + randomHex(16)
		status, body, err := p.notificationRequest(r, "POST", []byte(message))
		if err != nil || status != 200 || json.Unmarshal(body, &p.notification) != nil || p.notification.ID == "" || p.notification.Message != message || p.notification.Event != "message" {
			return payloadFailure("ntfy", "owned ntfy notification could not be seeded")
		}
	}
	return p.check(r)
}

func (p *backupPayload) check(r *runner) result {
	if slices.Contains(p.apps, "postgresql") {
		value, err := r.postgresPayload(postgresReadSQL, false)
		if err != nil || value != postgresExpected {
			return payloadFailure("postgresql", "owned PostgreSQL row did not match the exact backup payload")
		}
	}
	if slices.Contains(p.apps, "ntfy") {
		status, body, err := p.notificationRequest(r, "GET", nil)
		if err != nil || status != 200 || !exactRestoredNotification(body, p.notification.ID, p.notification.Message) {
			return payloadFailure("ntfy", "owned ntfy message ID and body did not match the exact backup payload")
		}
	}
	return result{}
}

func (r *runner) prepareBackupPayload(spec targetSpec, ports map[string]int) *backupPayload {
	p := &backupPayload{port: ports["ntfy"], topic: "selfhost-e2e-restore-" + randomHex(16)}
	for _, app := range spec.Apps {
		if app == "postgresql" || app == "ntfy" {
			p.apps = append(p.apps, app)
		}
	}
	if len(p.apps) == 0 {
		return nil
	}
	r.evidence.Probe = "App Setup/Check and filesystem backup sentinel; exact application data across isolated restore for " + strings.Join(p.apps, ", ") + " only; other Apps have no workload or database-content assertion"
	var stages []stageEvidence
	for _, stage := range r.evidence.Stages {
		stages = append(stages, stage)
		name := ""
		if stage.Name == "update" {
			name = "payload-seed"
		}
		if stage.Name == "restored-check" {
			name = "payload-restored"
		}
		if name != "" {
			apps := map[string]string{}
			for _, app := range p.apps {
				apps[app] = "not-run"
			}
			stages = append(stages, stageEvidence{Name: name, Outcome: "not-run", Apps: apps})
		}
	}
	r.evidence.Stages = stages
	return p
}
