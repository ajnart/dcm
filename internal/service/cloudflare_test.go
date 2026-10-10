package service

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/url"
	"slices"
	"strings"
	"testing"

	"github.com/ajnart/self-host/internal/app"
	"github.com/ajnart/self-host/internal/apps/cloudflaretunnel"
	"github.com/ajnart/self-host/internal/cloudflare/cloudflaretest"
	"github.com/ajnart/self-host/internal/system"
	"github.com/ajnart/self-host/internal/systemtest"
)

type publicationApp struct {
	testApp
	category string
	noWeb    bool
}

func (a *publicationApp) Info() app.Info {
	info := a.testApp.Info()
	info.Category, info.NoWebUI = a.category, a.noWeb
	return info
}

type cloudflareTransport struct {
	server *cloudflaretest.Server
	status int
}

func (tr cloudflareTransport) RoundTrip(req *http.Request) (*http.Response, error) {
	if req.URL.Hostname() == "api.cloudflare.com" {
		copy := req.Clone(req.Context())
		target, _ := url.Parse(tr.server.URL)
		copy.URL.Scheme, copy.URL.Host = target.Scheme, target.Host
		return http.DefaultTransport.RoundTrip(copy)
	}
	tr.server.Mark("PROBE", "GET "+req.URL.String())
	return &http.Response{StatusCode: tr.status, Header: http.Header{"Location": {"https://myteam.cloudflareaccess.com/login"}}, Body: http.NoBody, Request: req}, nil
}

func publicationHarness(t *testing.T) (*harness, *cloudflaretest.Server, CloudflareOptions) {
	t.Helper()
	h := newHarness(t,
		&publicationApp{testApp: testApp{id: "paperless-ngx", done: map[string]bool{}}, category: "Documents"},
		&publicationApp{testApp: testApp{id: "jellyfin", done: map[string]bool{}}, category: "Media"},
		&publicationApp{testApp: testApp{id: "qbittorrent", done: map[string]bool{}}, category: "Downloads"},
		&publicationApp{testApp: testApp{id: "postgresql", done: map[string]bool{}}, category: "Databases", noWeb: true},
		cloudflaretunnel.App{})
	if err := h.install("paperless-ngx", "jellyfin", "qbittorrent", "postgresql"); err != nil {
		t.Fatal(err)
	}
	server := cloudflaretest.New(t, cloudflaretest.Options{Token: "private-api-fixture", Domain: "example.com", Team: "myteam"})
	h.deps.HTTP = &http.Client{Transport: cloudflareTransport{server: server, status: 302}}
	return h, server, CloudflareOptions{Domain: "example.com", Emails: []string{"alice@example.org"}, Apps: []string{"paperless-ngx", "jellyfin"}, APIToken: "private-api-fixture", AcceptPublic: true}
}

func TestCloudflareNeedsSeparatePublicationYes(t *testing.T) {
	h, server, opts := publicationHarness(t)
	opts.AcceptPublic = false
	_, err := h.svc.CloudflarePublish(t.Context(), opts)
	if !errors.Is(err, ErrPublicNotAccepted) || len(server.Calls()) != 0 {
		t.Fatalf("err=%v calls=%v", err, server.Calls())
	}
}

func TestCloudflareRefusesPrivateCategoriesAndNoWebAppsAndWarnsForMedia(t *testing.T) {
	h, _, opts := publicationHarness(t)
	opts.Apps = []string{"jellyfin", "qbittorrent", "postgresql"}
	plan, err := h.svc.CloudflarePlan(t.Context(), opts)
	if err != nil {
		t.Fatal(err)
	}
	if len(plan.Publish) != 1 || len(plan.Refused) != 2 || !strings.Contains(plan.Publish[0].Warning, "Tailscale") || !strings.Contains(plan.Publish[0].Warning, "phone and TV") {
		t.Fatalf("plan %+v", plan)
	}
	opts.Allow = []string{"qbittorrent", "postgresql"}
	plan, err = h.svc.CloudflarePlan(t.Context(), opts)
	if err != nil || len(plan.Publish) != 2 || len(plan.Refused) != 1 {
		t.Fatalf("plan %+v err %v", plan, err)
	}
}

func TestCloudflarePublishesHTTPSKeepsLANAndStoresOnlyRunToken(t *testing.T) {
	h, _, opts := publicationHarness(t)
	res, err := h.svc.CloudflarePublish(t.Context(), opts)
	if err != nil || len(res.Published) != 2 {
		t.Fatalf("result %+v err %v", res, err)
	}
	status, err := h.svc.Status(t.Context())
	if err != nil {
		t.Fatal(err)
	}
	if !slices.Contains(status.Access, "cloudflare") {
		t.Fatalf("access %v", status.Access)
	}
	as := appStatus(t, h, "paperless-ngx")
	if !slices.Equal(as.Addresses, []string{"https://paperless-ngx.example.com", "http://192.168.1.20:9000"}) || as.URL != "https://paperless-ngx.example.com" {
		t.Fatalf("addresses %v url %s", as.Addresses, as.URL)
	}
	p, _ := h.svc.Project()
	secrets, err := p.LoadSecrets()
	if err != nil || secrets["CLOUDFLARE_TUNNEL_TOKEN"] != cloudflaretest.TunnelToken {
		t.Fatal("run token not stored", err)
	}
	for _, value := range secrets {
		if value == opts.APIToken {
			t.Fatal("API token stored")
		}
	}
	state, _ := p.LoadState()
	data, _ := json.Marshal(state)
	log, _ := json.Marshal(h.rec.events)
	if strings.Contains(string(data)+string(log)+strings.Join(h.runner.Calls(), " "), opts.APIToken) || strings.Contains(string(data)+string(log), cloudflaretest.TunnelToken) {
		t.Fatal("secret leaked")
	}
	opts.APIToken = ""
	if err := h.svc.CloudflareRemove(context.Background(), opts); err == nil || !strings.Contains(err.Error(), "privately") {
		t.Fatalf("removal did not request new token: %v", err)
	}
}

func TestCloudflareServiceStartsTheConnectorOnlyAfterIngressAndBeforeDNS(t *testing.T) {
	h, server, opts := publicationHarness(t)
	h.runner.OnFunc("docker compose --project-directory", func(cmd system.Cmd) system.Result {
		if strings.Contains(systemtest.Line(cmd), "up -d --remove-orphans cloudflare-tunnel") {
			server.Mark("LOCAL", "start the connector")
		}
		return system.Result{}
	})
	if _, err := h.svc.CloudflarePublish(t.Context(), opts); err != nil {
		t.Fatal(err)
	}
	calls := server.Calls()
	start := slices.Index(calls, "LOCAL start the connector")
	ingress := slices.Index(calls, "PUT /accounts/acct-1/cfd_tunnel/tunnel-1/configurations")
	dns := slices.Index(calls, "POST /zones/zone-1/dns_records")
	if ingress < 0 || start <= ingress || dns <= start {
		t.Fatalf("unsafe order:\n%s", strings.Join(calls, "\n"))
	}
}

func TestCloudflareFailedProbeIsNotAnAddressAndStillCanBeRemoved(t *testing.T) {
	h, server, opts := publicationHarness(t)
	h.deps.HTTP = &http.Client{Transport: cloudflareTransport{server: server, status: 200}}
	res, err := h.svc.CloudflarePublish(t.Context(), opts)
	if !errors.Is(err, ErrIncomplete) || len(res.Published) != 0 || len(res.Failed) != 2 || len(server.Records()) != 0 {
		t.Fatalf("result %+v err %v", res, err)
	}
	as := appStatus(t, h, "paperless-ngx")
	if !slices.Equal(as.Addresses, []string{"http://192.168.1.20:9000"}) {
		t.Fatalf("unverified Address in status %v", as.Addresses)
	}
	if err := h.svc.CloudflareRemove(t.Context(), opts); err != nil {
		t.Fatal(err)
	}
	tunnels, policies, apps, idps, records := server.Count()
	if tunnels != 0 || policies != 0 || apps != 0 || idps != 1 || records != 0 {
		t.Fatal("failed publication could not be removed")
	}
}
