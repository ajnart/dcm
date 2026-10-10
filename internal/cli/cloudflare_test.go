package cli_test

import (
	"encoding/json"
	"net/http"
	"net/url"
	"strings"
	"testing"

	"github.com/ajnart/self-host/internal/apps/cloudflaretunnel"
	"github.com/ajnart/self-host/internal/cloudflare/cloudflaretest"
	"github.com/ajnart/self-host/internal/events"
	"github.com/ajnart/self-host/internal/systemtest"
	"github.com/ajnart/self-host/internal/tui"
)

func TestCloudflarePlanJSONNamesChoicesRisksAndExactScopes(t *testing.T) {
	deps := systemtest.NewDeps(t)
	cat := testCatalog(&echoApp{id: "one", done: map[string]bool{}})
	if code, out := runWith(t, deps, cat, "install", "one", "--yes", "--json"); code != 0 {
		t.Fatal(out)
	}
	code, out := runWith(t, deps, cat, "cloudflare", "plan", "--domain", "example.com", "--email", "alice@example.org", "--app", "one", "--json")
	var plan struct {
		Publish     []struct{ Address string }
		Risk        string
		TokenScopes []string `json:"token_scopes"`
	}
	if code != 0 || json.Unmarshal([]byte(out), &plan) != nil || len(plan.Publish) != 1 || plan.Publish[0].Address != "https://one.example.com" || !strings.Contains(plan.Risk, "Anyone in the world") || len(plan.TokenScopes) != 5 {
		t.Fatalf("code %d out %s", code, out)
	}
	code, out = runWith(t, deps, cat, "cloudflare", "publish", "--domain", "example.com", "--email", "alice@example.org", "--app", "one", "--json")
	if code == 0 || !strings.Contains(out, "separate explicit yes") {
		t.Fatalf("unapproved publication %d %s", code, out)
	}
}

type publicationTransport struct{ server *cloudflaretest.Server }

func (tr publicationTransport) RoundTrip(req *http.Request) (*http.Response, error) {
	if req.URL.Hostname() == "api.cloudflare.com" {
		copy := req.Clone(req.Context())
		target, _ := url.Parse(tr.server.URL)
		copy.URL.Scheme, copy.URL.Host = target.Scheme, target.Host
		return http.DefaultTransport.RoundTrip(copy)
	}
	return &http.Response{StatusCode: 302, Header: http.Header{"Location": {"https://myteam.cloudflareaccess.com/login"}}, Body: http.NoBody, Request: req}, nil
}

func TestCloudflarePrivateStdinPublicationJSONAndFreshTokenRemoval(t *testing.T) {
	deps := systemtest.NewDeps(t)
	cat := testCatalog(&echoApp{id: "one", done: map[string]bool{}}, cloudflaretunnel.App{})
	if code, out := runWith(t, deps, cat, "install", "one", "--yes", "--json"); code != 0 {
		t.Fatal(out)
	}
	server := cloudflaretest.New(t, cloudflaretest.Options{Token: "private-cli-token", Domain: "example.com", Team: "myteam"})
	deps.HTTP = &http.Client{Transport: publicationTransport{server}}
	deps.In = strings.NewReader("private-cli-token\n")
	code, out := runWith(t, deps, cat, "cloudflare", "publish", "--domain", "example.com", "--email", "alice@example.org", "--app", "one", "--set-file", "cloudflare.api_token=-", "--accept-public", "--json")
	if code != 0 || strings.Contains(out, "private-cli-token") || strings.Contains(out, cloudflaretest.TunnelToken) || !strings.Contains(out, "https://one.example.com asks for a login") {
		t.Fatalf("publication %d %s", code, out)
	}
	code, out = runWith(t, deps, cat, "status", "--json")
	server.Reset()
	if removed, text := runWith(t, deps, cat, "remove", "cloudflare-tunnel", "--yes", "--json"); removed == 0 || !strings.Contains(text, "cloudflare remove") {
		t.Fatalf("ordinary CLI remove orphaned routes: %d %s", removed, text)
	}
	if len(server.Calls()) != 0 {
		t.Fatal("ordinary removal contacted API")
	}
	if err := (tui.ServiceBackend{Deps: deps, Apps: cat}).Run(t.Context(), tui.Request{Action: tui.ActionRemove, IDs: []string{"cloudflare-tunnel"}}, events.Discard()); err == nil || !strings.Contains(err.Error(), "cloudflare remove") {
		t.Fatalf("Dashboard removal abandoned routes: %v", err)
	}
	var status struct {
		Access []string
		Apps   []struct {
			ID        string
			Addresses []string
		}
	}
	if code != 0 || json.Unmarshal([]byte(out), &status) != nil {
		t.Fatal(out)
	}
	for _, a := range status.Apps {
		if a.ID == "one" && (len(a.Addresses) != 2 || a.Addresses[0] != "https://one.example.com" || a.Addresses[1] != "http://192.168.1.20:9000") {
			t.Fatal(out)
		}
	}
	code, out = runWith(t, deps, cat, "cloudflare", "remove", "--yes", "--json")
	if code == 0 || !strings.Contains(out, "privately") {
		t.Fatalf("fresh token not requested %d %s", code, out)
	}
	deps.In = strings.NewReader("private-cli-token")
	code, out = runWith(t, deps, cat, "cloudflare", "remove", "--set-file", "cloudflare.api_token=-", "--yes", "--json")
	if code != 0 {
		t.Fatal(out)
	}
	tunnels, policies, apps, idps, records := server.Count()
	if tunnels != 0 || policies != 0 || apps != 0 || idps != 1 || records != 0 {
		t.Fatalf("remaining %d %d %d %d %d", tunnels, policies, apps, idps, records)
	}
}

func TestCloudflarePlainPlanShowsDroppedAddressesBeforeApproval(t *testing.T) {
	deps := systemtest.NewDeps(t)
	cat := testCatalog(&echoApp{id: "one", done: map[string]bool{}}, &echoApp{id: "two", done: map[string]bool{}}, cloudflaretunnel.App{})
	if code, out := runWith(t, deps, cat, "install", "one", "two", "--yes", "--json"); code != 0 {
		t.Fatal(out)
	}
	server := cloudflaretest.New(t, cloudflaretest.Options{Token: "private-cli-token", Domain: "example.com", Team: "myteam"})
	deps.HTTP = &http.Client{Transport: publicationTransport{server}}
	deps.In = strings.NewReader("private-cli-token")
	if code, out := runWith(t, deps, cat, "cloudflare", "publish", "--domain", "example.com", "--email", "alice@example.org", "--app", "one,two", "--set-file", "cloudflare.api_token=-", "--accept-public", "--json"); code != 0 {
		t.Fatal(out)
	}
	server.Reset()
	code, out := runWith(t, deps, cat, "cloudflare", "plan", "--domain", "example.com", "--email", "alice@example.org", "--app", "one")
	if code != 0 || !strings.Contains(out, "Remove https://two.example.com") || !strings.Contains(out, "Current https://one.example.com") {
		t.Fatalf("replacement hidden: %d %s", code, out)
	}
	if len(server.Calls()) != 0 {
		t.Fatal("preview mutated remote state")
	}
}
