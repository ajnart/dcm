//go:build e2e

package e2e

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net/http"
	"slices"
	"time"
)

func (r *runner) prepareHAProxyProbe() bool {
	if !slices.Contains(r.spec.Apps, "haproxy") {
		return false
	}
	var stages []stageEvidence
	for _, stage := range r.evidence.Stages {
		stages = append(stages, stage)
		name := ""
		if stage.Name == "setup-check" {
			name = "backend-routing"
		}
		if stage.Name == "restored-check" {
			name = "restored-backend-routing"
		}
		if name != "" {
			stages = append(stages, stageEvidence{Name: name, Outcome: "not-run", Apps: map[string]string{"haproxy": "not-run", "ntfy": "not-run"}})
		}
	}
	r.evidence.Stages = stages
	r.evidence.Probe += "; real HAProxy-to-owned-ntfy routing and protected statistics before backup and after isolated restore"
	return true
}

func (r *runner) haproxyProbe(ports map[string]int) result {
	fail := func(reason string) result {
		return result{code: 1, events: []event{{Event: "step.fail", App: "haproxy", Step: "backend-routing", Error: reason}}}
	}
	// Consume only the public owned credential handoff in memory, never evidence.
	res := r.runWithTimeout(30*time.Second, "credentials", "--json")
	var doc struct {
		Admin struct{ Username, Password string } `json:"admin"`
		Apps  map[string]map[string]string        `json:"apps"`
	}
	if res.code != 0 || json.Unmarshal([]byte(res.stdout), &doc) != nil || doc.Admin.Username == "" || doc.Admin.Password == "" || doc.Apps["ntfy"]["NTFY_HOMARR_TOKEN"] == "" {
		return fail("owned HAProxy and ntfy credentials unavailable")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 45*time.Second)
	defer cancel()
	client := &http.Client{Timeout: 15 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	proxy := fmt.Sprintf("http://127.0.0.1:%d", ports["haproxy"])
	status, _, err := hfRequest(ctx, client, "GET", proxy+"/_stats", nil, nil)
	if err != nil || status != 401 && status != 403 {
		return fail("HAProxy statistics did not deny anonymous access")
	}
	basic := base64.StdEncoding.EncodeToString([]byte(doc.Admin.Username + ":" + doc.Admin.Password))
	status, _, err = hfRequest(ctx, client, "GET", proxy+"/_stats", map[string]string{"Authorization": "Basic " + basic}, nil)
	if err != nil || status != 200 {
		return fail("HAProxy statistics did not accept the owned administrator")
	}
	topic := "selfhost-e2e-proxy-" + randomHex(16)
	message := "Owned HAProxy backend routing payload " + randomHex(16)
	headers := map[string]string{"Authorization": "Bearer " + doc.Apps["ntfy"]["NTFY_HOMARR_TOKEN"], "Content-Type": "text/plain", "Cache": "yes"}
	status, body, err := hfRequest(ctx, client, "POST", proxy+"/"+topic, headers, []byte(message))
	var published notificationPayload
	if err != nil || status != 200 || json.Unmarshal(body, &published) != nil || published.ID == "" || published.Event != "message" || published.Message != message {
		return fail("HAProxy did not route the exact owned notification to ntfy")
	}
	backend := fmt.Sprintf("http://127.0.0.1:%d/%s/json?poll=1", ports["ntfy"], topic)
	status, body, err = hfRequest(ctx, client, "GET", backend, headers, nil)
	if err != nil || status != 200 || !exactRestoredNotification(body, published.ID, message) {
		return fail("owned ntfy backend did not contain the exact proxied notification")
	}
	return result{}
}
