package cloudflare_test

import (
	"bytes"
	"context"
	"errors"
	"io"
	"net/http"
	"slices"
	"strings"
	"testing"

	"github.com/ajnart/self-host/internal/cloudflare"
	"github.com/ajnart/self-host/internal/cloudflare/cloudflaretest"
)

const apiToken = "scoped-api-token-for-tests"

func newAccount(t *testing.T, opts cloudflaretest.Options) *cloudflaretest.Server {
	t.Helper()
	opts.Token, opts.Domain = apiToken, "example.com"
	if opts.Team == "" {
		opts.Team = "myteam"
	}
	return cloudflaretest.New(t, opts)
}

func spec(hosts ...string) cloudflare.Spec {
	s := cloudflare.Spec{
		Domain:     "example.com",
		TunnelName: "self-host",
		PolicyName: "self-host: allowed people",
		Comment:    "managed by self-host project=selfhost",
		Emails:     []string{"alice@example.org", "bob@example.org"},
	}
	for _, app := range hosts {
		s.Hosts = append(s.Hosts, cloudflare.Host{App: app, Name: app + ".example.com", Origin: "http://" + app + ":8080"})
	}
	return s
}

type world struct {
	server *cloudflaretest.Server
	client *cloudflare.Client
	// probes maps a name to what an outside visitor sees; the default is the login page.
	probes    map[string]cloudflare.Probe
	connector []string
}

func newWorld(t *testing.T, opts cloudflaretest.Options) *world {
	t.Helper()
	server := newAccount(t, opts)
	return &world{server: server, client: &cloudflare.Client{Base: server.Base(), Token: apiToken}, probes: map[string]cloudflare.Probe{}}
}

func (w *world) hooks() cloudflare.Hooks {
	return cloudflare.Hooks{
		StartConnector: func(_ context.Context, token string) error {
			w.connector = append(w.connector, token)
			w.server.Mark("LOCAL", "start the connector")
			return nil
		},
		Probe: func(_ context.Context, name string) (cloudflare.Probe, error) {
			w.server.Mark("PROBE", "GET https://"+name+"/")
			if p, ok := w.probes[name]; ok {
				return p, nil
			}
			return cloudflare.Probe{Status: http.StatusFound, Location: "https://myteam.cloudflareaccess.com/cdn-cgi/access/login/" + name}, nil
		},
	}
}

func indexOfCall(calls []string, prefix string) int {
	return slices.IndexFunc(calls, func(c string) bool { return strings.HasPrefix(c, prefix) })
}

func TestNothingBecomesReachableBeforeTheTunnelThePolicyTheAccessAppsAndTheIngressExist(t *testing.T) {
	w := newWorld(t, cloudflaretest.Options{})

	if _, err := cloudflare.Publish(t.Context(), w.client, spec("paperless-ngx", "jellyfin"), w.hooks()); err != nil {
		t.Fatal(err)
	}

	calls := w.server.Calls()
	want := []string{
		"GET /zones?name=example.com&status=active",
		"GET /accounts/acct-1/access/organizations",
		"GET /accounts/acct-1/access/identity_providers",
		"POST /accounts/acct-1/access/identity_providers",
		"GET /accounts/acct-1/cfd_tunnel?is_deleted=false&name=self-host",
		"POST /accounts/acct-1/cfd_tunnel",
		"GET /accounts/acct-1/cfd_tunnel/tunnel-1/token",
		"GET /accounts/acct-1/access/policies",
		"POST /accounts/acct-1/access/policies",
		"GET /accounts/acct-1/access/apps?domain=paperless-ngx.example.com&exact=true",
		"POST /accounts/acct-1/access/apps",
		"GET /accounts/acct-1/access/apps?domain=jellyfin.example.com&exact=true",
		"POST /accounts/acct-1/access/apps",
		"GET /accounts/acct-1/cfd_tunnel/tunnel-1/configurations",
		"PUT /accounts/acct-1/cfd_tunnel/tunnel-1/configurations",
		"LOCAL start the connector",
		"GET /zones/zone-1/dns_records?name=paperless-ngx.example.com",
		"GET /zones/zone-1/dns_records?name=jellyfin.example.com",
		"POST /zones/zone-1/dns_records",
		"POST /zones/zone-1/dns_records",
		"PROBE GET https://paperless-ngx.example.com/",
		"PROBE GET https://jellyfin.example.com/",
	}
	if !slices.Equal(calls, want) {
		t.Fatalf("ordered call log differs:\n%s", strings.Join(calls, "\n"))
	}
	t.Log("ordered call log for two Apps:\n" + strings.Join(calls, "\n"))
	zone := indexOfCall(calls, "GET /zones?")
	org := indexOfCall(calls, "GET /accounts/acct-1/access/organizations")
	idp := indexOfCall(calls, "POST /accounts/acct-1/access/identity_providers")
	tunnel := indexOfCall(calls, "POST /accounts/acct-1/cfd_tunnel")
	token := indexOfCall(calls, "GET /accounts/acct-1/cfd_tunnel/tunnel-")
	policy := indexOfCall(calls, "POST /accounts/acct-1/access/policies")
	app := indexOfCall(calls, "POST /accounts/acct-1/access/apps")
	ingress := indexOfCall(calls, "PUT /accounts/acct-1/cfd_tunnel/tunnel-")
	connector := indexOfCall(calls, "LOCAL start the connector")
	dns := indexOfCall(calls, "POST /zones/zone-1/dns_records")
	probe := indexOfCall(calls, "PROBE ")
	order := []int{zone, org, idp, tunnel, token, policy, app, ingress, connector, dns, probe}
	for i, at := range order {
		if at < 0 {
			t.Fatalf("step %d never happened\n%s", i, strings.Join(calls, "\n"))
		}
		if i > 0 && at <= order[i-1] {
			t.Errorf("step %d came before step %d\n%s", i, i-1, strings.Join(calls, "\n"))
		}
	}
	for _, write := range w.server.Writes() {
		if strings.Contains(write, "dns_records") && !strings.HasPrefix(write, "POST") {
			t.Errorf("unexpected DNS write %s", write)
		}
	}
	for i := len(calls) - 1; i >= 0; i-- {
		if strings.HasPrefix(calls[i], "POST /accounts/acct-1/access/apps") {
			if i > ingress {
				t.Errorf("an Access app was created after the ingress\n%s", strings.Join(calls, "\n"))
			}
			break
		}
	}
}

func TestTheRunTokenReachesTheConnectorAndTheAPITokenReachesNothingElse(t *testing.T) {
	w := newWorld(t, cloudflaretest.Options{})

	res, err := cloudflare.Publish(t.Context(), w.client, spec("jellyfin"), w.hooks())
	if err != nil {
		t.Fatal(err)
	}

	if !slices.Equal(w.connector, []string{cloudflaretest.TunnelToken}) {
		t.Errorf("connector started with %q, want the tunnel's run token", w.connector)
	}
	if got := strings.Join(w.server.Calls(), "\n"); strings.Contains(got, apiToken) || strings.Contains(got, cloudflaretest.TunnelToken) {
		t.Errorf("a token leaked into the call log\n%s", got)
	}
	if res.Team != "myteam" || !slices.Equal(res.Verified, []string{"jellyfin.example.com"}) {
		t.Errorf("result %+v", res)
	}
}

func TestEveryNameIsProtectedByALoginRuleThatTheConnectorAlsoEnforces(t *testing.T) {
	w := newWorld(t, cloudflaretest.Options{})

	if _, err := cloudflare.Publish(t.Context(), w.client, spec("jellyfin"), w.hooks()); err != nil {
		t.Fatal(err)
	}

	rules := w.server.Ingress()
	if len(rules) != 2 {
		t.Fatalf("ingress %v", rules)
	}
	rule := rules[0]
	access := rule["originRequest"].(map[string]any)["access"].(map[string]any)
	if rule["hostname"] != "jellyfin.example.com" || rule["service"] != "http://jellyfin:8080" ||
		access["required"] != true || access["teamName"] != "myteam" || access["audTag"].([]any)[0] != "aud-app-1" {
		t.Errorf("rule %v", rule)
	}
	if rules[1]["service"] != "http_status:404" || rules[1]["hostname"] != nil {
		t.Errorf("the catch-all must come last: %v", rules[1])
	}
	for _, r := range w.server.Requests() {
		if r.Method == "POST" && strings.HasSuffix(r.Path, "/access/apps") {
			idps, _ := r.Body["allowed_idps"].([]any)
			if len(idps) != 1 || !strings.HasPrefix(idps[0].(string), "idp-") {
				t.Errorf("only the one-time PIN login may be offered: %v", r.Body)
			}
		}
	}
}

func TestRunningAgainCreatesNothingTwice(t *testing.T) {
	w := newWorld(t, cloudflaretest.Options{})
	if _, err := cloudflare.Publish(t.Context(), w.client, spec("paperless-ngx", "jellyfin"), w.hooks()); err != nil {
		t.Fatal(err)
	}
	w.server.Reset()

	if _, err := cloudflare.Publish(t.Context(), w.client, spec("paperless-ngx", "jellyfin"), w.hooks()); err != nil {
		t.Fatal(err)
	}

	if writes := w.server.Writes(); len(writes) != 0 {
		t.Errorf("a second run changed %q", writes)
	}
	tunnels, policies, apps, idps, records := w.server.Count()
	if tunnels != 1 || policies != 1 || apps != 2 || idps != 1 || records != 2 {
		t.Errorf("counts tunnels=%d policies=%d apps=%d idps=%d records=%d", tunnels, policies, apps, idps, records)
	}
}

func TestFailedConnectorRollsBackInReverseWithoutDeletingPIN(t *testing.T) {
	w := newWorld(t, cloudflaretest.Options{})
	hooks := w.hooks()
	hooks.StartConnector = func(context.Context, string) error { return errors.New("connector failed") }
	hooks.StopConnector = func(context.Context) error { w.server.Mark("LOCAL", "stop the connector"); return nil }
	_, err := cloudflare.Publish(t.Context(), w.client, spec("paperless-ngx", "jellyfin"), hooks)
	if err == nil {
		t.Fatal("failure lost")
	}
	tunnels, policies, apps, idps, records := w.server.Count()
	if tunnels != 0 || policies != 0 || apps != 0 || idps != 1 || records != 0 {
		t.Fatalf("counts %d %d %d %d %d", tunnels, policies, apps, idps, records)
	}
	writes := w.server.Writes()
	appDelete := indexOfCall(writes, "DELETE /accounts/acct-1/access/apps/")
	policyDelete := indexOfCall(writes, "DELETE /accounts/acct-1/access/policies/")
	tunnelDelete := slices.Index(writes, "DELETE /accounts/acct-1/cfd_tunnel/tunnel-1")
	if appDelete < 0 || policyDelete < appDelete || tunnelDelete < policyDelete {
		t.Fatalf("rollback %v", writes)
	}
}

func TestAnExistingOneTimePINLoginIsReused(t *testing.T) {
	w := newWorld(t, cloudflaretest.Options{OTP: true})

	if _, err := cloudflare.Publish(t.Context(), w.client, spec("jellyfin"), w.hooks()); err != nil {
		t.Fatal(err)
	}

	if indexOfCall(w.server.Calls(), "POST /accounts/acct-1/access/identity_providers") >= 0 {
		t.Errorf("created a second one-time PIN login\n%s", strings.Join(w.server.Calls(), "\n"))
	}
}

func TestChangingTheAllowedEmailsUpdatesThePolicyInPlace(t *testing.T) {
	w := newWorld(t, cloudflaretest.Options{})
	if _, err := cloudflare.Publish(t.Context(), w.client, spec("jellyfin"), w.hooks()); err != nil {
		t.Fatal(err)
	}
	w.server.Reset()
	changed := spec("jellyfin")
	changed.Emails = []string{"carol@example.org"}

	if _, err := cloudflare.Publish(t.Context(), w.client, changed, w.hooks()); err != nil {
		t.Fatal(err)
	}

	if writes := w.server.Writes(); len(writes) != 1 || writes[0] != "PUT /accounts/acct-1/access/policies/policy-1" {
		t.Errorf("writes %q, want one policy update", writes)
	}
}

func TestRerunRemovesAnEveryoneRuleAddedToTheOwnedPolicy(t *testing.T) {
	w := newWorld(t, cloudflaretest.Options{})
	if _, err := cloudflare.Publish(t.Context(), w.client, spec("jellyfin"), w.hooks()); err != nil {
		t.Fatal(err)
	}
	req, _ := http.NewRequest("PUT", w.server.Base()+"/accounts/acct-1/access/policies/policy-1", bytes.NewBufferString(`{"include":[{"email":{"email":"alice@example.org"}},{"email":{"email":"bob@example.org"}},{"everyone":{}}]}`))
	req.Header.Set("Authorization", "Bearer "+apiToken)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	io.Copy(io.Discard, resp.Body)
	resp.Body.Close()
	w.server.Reset()
	if _, err := cloudflare.Publish(t.Context(), w.client, spec("jellyfin"), w.hooks()); err != nil {
		t.Fatal(err)
	}
	if !slices.Contains(w.server.Writes(), "PUT /accounts/acct-1/access/policies/policy-1") {
		t.Fatalf("unsafe policy reused: %v", w.server.Calls())
	}
}

func TestRulesAnotherToolAddedToTheTunnelSurviveTheIngressUpdate(t *testing.T) {
	w := newWorld(t, cloudflaretest.Options{})
	if _, err := cloudflare.Publish(t.Context(), w.client, spec("jellyfin"), w.hooks()); err != nil {
		t.Fatal(err)
	}
	w.server.AddForeignRule("other.example.com")

	if _, err := cloudflare.Publish(t.Context(), w.client, spec("jellyfin", "paperless-ngx"), w.hooks()); err != nil {
		t.Fatal(err)
	}

	var hosts []string
	rules := w.server.Ingress()
	for _, r := range rules {
		if host, ok := r["hostname"].(string); ok {
			hosts = append(hosts, host)
		}
	}
	if want := []string{"other.example.com", "jellyfin.example.com", "paperless-ngx.example.com"}; !slices.Equal(hosts, want) || rules[len(rules)-1]["service"] != "http_status:404" {
		t.Errorf("hosts %q, want %q, then the catch-all", hosts, want)
	}
}

func TestAnAddressThatDoesNotAskForALoginIsTakenOffTheInternetAtOnce(t *testing.T) {
	w := newWorld(t, cloudflaretest.Options{})
	w.probes["jellyfin.example.com"] = cloudflare.Probe{Status: http.StatusOK}

	res, err := cloudflare.Publish(t.Context(), w.client, spec("jellyfin", "paperless-ngx"), w.hooks())

	if err != nil {
		t.Fatal(err)
	}
	if !slices.Equal(res.Verified, []string{"paperless-ngx.example.com"}) || len(res.Failed) != 1 || res.Failed[0].Name != "jellyfin.example.com" {
		t.Errorf("result %+v", res)
	}
	for _, r := range w.server.Records() {
		if r.Name == "jellyfin.example.com" {
			t.Errorf("the DNS record of the unprotected name is still there")
		}
	}
	if !strings.Contains(res.Failed[0].Reason, "login page") {
		t.Errorf("reason %q should say the login page did not show", res.Failed[0].Reason)
	}
}

func TestOnlyAnHTTPS302ToTheExpectedTeamIsAcceptance(t *testing.T) {
	for _, probe := range []cloudflare.Probe{
		{Status: 301, Location: "https://myteam.cloudflareaccess.com/login"},
		{Status: 302, Location: "http://myteam.cloudflareaccess.com/login"},
		{Status: 302, Location: "https://another.cloudflareaccess.com/login"},
		{Status: 302, Location: "https://myteam.cloudflareaccess.com.attacker.example/login"},
	} {
		t.Run(probe.Location+string(rune(probe.Status)), func(t *testing.T) {
			w := newWorld(t, cloudflaretest.Options{})
			w.probes["jellyfin.example.com"] = probe
			res, err := cloudflare.Publish(t.Context(), w.client, spec("jellyfin"), w.hooks())
			if err != nil || len(res.Verified) != 0 || len(w.server.Records()) != 0 {
				t.Fatalf("result %+v err %v records %v", res, err, w.server.Records())
			}
		})
	}
}

func TestAForeignDNSRecordIsRefusedAndTheNewResourcesRolledBack(t *testing.T) {
	w := newWorld(t, cloudflaretest.Options{Records: []cloudflaretest.Record{
		{ID: "dns-x", Type: "A", Name: "jellyfin.example.com", Content: "203.0.113.9"},
	}})

	_, err := cloudflare.Publish(t.Context(), w.client, spec("jellyfin"), w.hooks())

	if err == nil || !strings.Contains(err.Error(), "jellyfin.example.com") || !strings.Contains(err.Error(), "already") {
		t.Fatalf("error %v", err)
	}
	for _, write := range w.server.Writes() {
		if strings.Contains(write, "dns_records") {
			t.Fatalf("foreign DNS touched: %s", write)
		}
	}
	tunnels, policies, apps, _, records := w.server.Count()
	if tunnels != 0 || policies != 0 || apps != 0 || records != 1 {
		t.Fatal("rollback lost foreign record or left owned resources")
	}
}

func TestAnAccessAppOwnedByAnotherToolIsNeverOverwritten(t *testing.T) {
	w := newWorld(t, cloudflaretest.Options{})
	req, _ := http.NewRequest("POST", w.server.Base()+"/accounts/acct-1/access/apps", bytes.NewBufferString(`{"name":"someone else's login","domain":"jellyfin.example.com","policies":["foreign-policy"],"allowed_idps":["foreign-idp"]}`))
	req.Header.Set("Authorization", "Bearer "+apiToken)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	io.Copy(io.Discard, resp.Body)
	resp.Body.Close()
	w.server.Reset()
	_, err = cloudflare.Publish(t.Context(), w.client, spec("jellyfin"), w.hooks())
	if err == nil || !strings.Contains(err.Error(), "another") {
		t.Fatalf("foreign Access app accepted: %v", err)
	}
	for _, call := range w.server.Writes() {
		if strings.Contains(call, "/access/apps/app-1") || strings.Contains(call, "dns_records") {
			t.Fatalf("foreign app touched or published: %s", call)
		}
	}
}

func TestADomainThatIsNotActiveOnCloudflareStopsEverythingWithPlainWords(t *testing.T) {
	w := newWorld(t, cloudflaretest.Options{})
	other := spec("jellyfin")
	other.Domain = "home.example.com"

	_, err := cloudflare.Publish(t.Context(), w.client, other, w.hooks())

	if err == nil || !strings.Contains(err.Error(), "home.example.com") || !strings.Contains(err.Error(), "main domain") {
		t.Fatalf("error %v", err)
	}
	if len(w.server.Writes()) != 0 {
		t.Errorf("wrote before the domain was known to be active")
	}
}

func TestMissingZeroTrustOnboardingStopsBeforeAnythingIsCreatedAndSaysWhatToDo(t *testing.T) {
	server := cloudflaretest.New(t, cloudflaretest.Options{Token: apiToken, Domain: "example.com"})
	client := &cloudflare.Client{Base: server.Base(), Token: apiToken}

	_, err := cloudflare.Publish(t.Context(), client, spec("jellyfin"), cloudflare.Hooks{})

	var onboarding *cloudflare.NotOnboardedError
	if !errors.As(err, &onboarding) || !strings.Contains(err.Error(), "Zero Trust") {
		t.Fatalf("error %v", err)
	}
	if len(server.Writes()) != 0 {
		t.Errorf("wrote %q", server.Writes())
	}
}

func TestATokenCloudflareRefusesNamesTheMissingPermissionsAndNeverShowsItself(t *testing.T) {
	server := newAccount(t, cloudflaretest.Options{})
	client := &cloudflare.Client{Base: server.Base(), Token: "some-other-token-value"}

	_, err := cloudflare.Publish(t.Context(), client, spec("jellyfin"), cloudflare.Hooks{})

	if err == nil || !strings.Contains(err.Error(), "Tunnel") || strings.Contains(err.Error(), "some-other-token-value") {
		t.Fatalf("error %v", err)
	}
}

func TestPublishingFewerAppsTakesTheOthersOffTheInternet(t *testing.T) {
	w := newWorld(t, cloudflaretest.Options{})
	if _, err := cloudflare.Publish(t.Context(), w.client, spec("jellyfin", "paperless-ngx"), w.hooks()); err != nil {
		t.Fatal(err)
	}
	fewer := spec("jellyfin")
	fewer.Dropped = []string{"paperless-ngx.example.com"}

	if _, err := cloudflare.Publish(t.Context(), w.client, fewer, w.hooks()); err != nil {
		t.Fatal(err)
	}

	_, _, apps, _, records := w.server.Count()
	if apps != 1 || records != 1 || len(w.server.Ingress()) != 2 {
		t.Errorf("apps=%d records=%d ingress=%v", apps, records, w.server.Ingress())
	}
}

func TestRemovingRunsInReverseAndNeverDeletesTheLoginOrTheOrganization(t *testing.T) {
	w := newWorld(t, cloudflaretest.Options{})
	if _, err := cloudflare.Publish(t.Context(), w.client, spec("paperless-ngx", "jellyfin"), w.hooks()); err != nil {
		t.Fatal(err)
	}
	w.server.Reset()

	err := cloudflare.Remove(t.Context(), w.client, cloudflare.RemoveSpec{
		Domain: "example.com", TunnelName: "self-host", PolicyName: "self-host: allowed people",
		Comment: "managed by self-host project=selfhost",
		Names:   []string{"paperless-ngx.example.com", "jellyfin.example.com"},
	}, cloudflare.RemoveHooks{StopConnector: func(context.Context) error {
		w.server.Mark("LOCAL", "stop the connector")
		return nil
	}})

	if err != nil {
		t.Fatal(err)
	}
	writes := w.server.Calls()
	order := []int{
		indexOfCall(writes, "DELETE /zones/zone-1/dns_records/"),
		indexOfCall(writes, "PUT /accounts/acct-1/cfd_tunnel/tunnel-"),
		indexOfCall(writes, "DELETE /accounts/acct-1/access/apps/"),
		indexOfCall(writes, "DELETE /accounts/acct-1/access/policies/"),
		indexOfCall(writes, "LOCAL stop the connector"),
		indexOfCall(writes, "DELETE /accounts/acct-1/cfd_tunnel/tunnel-1/connections"),
		slices.Index(writes, "DELETE /accounts/acct-1/cfd_tunnel/tunnel-1"),
	}
	for i, at := range order {
		if at < 0 || i > 0 && at <= order[i-1] {
			t.Fatalf("removal order wrong at step %d\n%s", i, strings.Join(writes, "\n"))
		}
	}
	tunnels, policies, apps, idps, records := w.server.Count()
	if tunnels != 0 || policies != 0 || apps != 0 || records != 0 || idps != 1 {
		t.Errorf("tunnels=%d policies=%d apps=%d idps=%d records=%d", tunnels, policies, apps, idps, records)
	}
	for _, c := range writes {
		if strings.Contains(c, "identity_providers") && strings.HasPrefix(c, "DELETE") || strings.Contains(c, "organizations") && !strings.HasPrefix(c, "GET") {
			t.Errorf("removal touched the login method or the organization: %s", c)
		}
	}
}

func TestRemovingKeepsDNSRecordsSelfHostDidNotCreate(t *testing.T) {
	w := newWorld(t, cloudflaretest.Options{Records: []cloudflaretest.Record{
		{ID: "dns-x", Type: "CNAME", Name: "jellyfin.example.com", Content: "elsewhere.example.net"},
	}})

	err := cloudflare.Remove(t.Context(), w.client, cloudflare.RemoveSpec{
		Domain: "example.com", TunnelName: "self-host", PolicyName: "self-host: allowed people",
		Comment: "managed by self-host project=selfhost", Names: []string{"jellyfin.example.com"},
	}, cloudflare.RemoveHooks{})

	if err != nil {
		t.Fatal(err)
	}
	if len(w.server.Records()) != 1 {
		t.Errorf("deleted a record that was not ours")
	}
}

func TestRemovalNeverDeletesATunnelStillServingForeignRoutes(t *testing.T) {
	w := newWorld(t, cloudflaretest.Options{})
	if _, err := cloudflare.Publish(t.Context(), w.client, spec("jellyfin"), w.hooks()); err != nil {
		t.Fatal(err)
	}
	w.server.AddForeignRule("other.example.com")
	stopped := false
	err := cloudflare.Remove(t.Context(), w.client, cloudflare.RemoveSpec{Domain: "example.com", TunnelName: "self-host", PolicyName: "self-host: allowed people", Comment: "managed by self-host project=selfhost", Names: []string{"jellyfin.example.com"}}, cloudflare.RemoveHooks{StopConnector: func(context.Context) error { stopped = true; return nil }})
	if err == nil || !strings.Contains(err.Error(), "other routes") || stopped {
		t.Fatalf("foreign route interrupted: stopped=%v err=%v", stopped, err)
	}
	tunnels, policies, apps, _, records := w.server.Count()
	if tunnels != 1 || policies != 0 || apps != 0 || records != 0 || len(w.server.Ingress()) != 2 {
		t.Fatal("owned routes not removed or foreign route lost")
	}
}

func TestRemovingTwiceIsHarmless(t *testing.T) {
	w := newWorld(t, cloudflaretest.Options{})
	remove := func() error {
		return cloudflare.Remove(t.Context(), w.client, cloudflare.RemoveSpec{
			Domain: "example.com", TunnelName: "self-host", PolicyName: "self-host: allowed people",
			Comment: "managed by self-host project=selfhost", Names: []string{"jellyfin.example.com"},
		}, cloudflare.RemoveHooks{})
	}

	if err := remove(); err != nil {
		t.Fatalf("on an empty account: %v", err)
	}
	if writes := w.server.Writes(); len(writes) != 0 {
		t.Errorf("wrote %q on an empty account", writes)
	}
}
