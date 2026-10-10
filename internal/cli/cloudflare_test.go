package cli_test

import (
	"encoding/json"
	"net/http"
	"net/url"
	"strings"
	"testing"

	"github.com/ajnart/self-host/internal/apps/cloudflaretunnel"
	"github.com/ajnart/self-host/internal/cloudflare/cloudflaretest"
	"github.com/ajnart/self-host/internal/systemtest"
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
